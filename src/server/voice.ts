import { z } from "zod";
import OpenAI from "openai";
import WebSocket from "ws";
import { controlledLiveVoiceConfig } from "./controlled-live.js";
import { providerKey } from "./controlled-live.js";
import { repairStore } from "./store.js";

const callSidSchema = z.string().regex(/^CA[0-9a-fA-F]{32}$/);
export const controlledCallTimeLimitSeconds = 300;

export class KnownCallStartFailure extends Error {}

export const startControlledContractorCall = async (
  input: { caseId: string; effectKey: string; target: "contractor"; approvalId: string },
  {
    fetch: fetchResponse = globalThis.fetch,
    env = process.env,
  }: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
) => {
  const config = controlledLiveVoiceConfig(env);
  const callbackQuery = `?approval=${encodeURIComponent(input.approvalId)}`;
  const body = new URLSearchParams({
    To: config.contractorPhone,
    From: config.servicePhone,
    Url: `${config.publicBaseUrl}/api/voice/twilio/consent${callbackQuery}`,
    Method: "POST",
    StatusCallback: `${config.publicBaseUrl}/api/voice/twilio/status${callbackQuery}`,
    StatusCallbackMethod: "POST",
    TimeLimit: String(controlledCallTimeLimitSeconds),
  });
  for (const event of ["initiated", "ringing", "answered", "completed"]) {
    body.append("StatusCallbackEvent", event);
  }
  const response = await fetchResponse(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    const message = `Twilio rejected the contractor call (${response.status}).`;
    if (response.status >= 400 && response.status < 500) throw new KnownCallStartFailure(message);
    throw new Error(message);
  }
  const providerId = callSidSchema.parse((await response.json() as { sid?: unknown }).sid);
  return { providerId };
};

const incomingCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("realtime.call.incoming"),
  data: z.object({
    call_id: z.string().min(8),
    sip_headers: z.array(z.object({ name: z.string(), value: z.string() })),
  }),
});

const outcomeSchema = z
  .object({
    outcome: z.enum([
      "confirmed",
      "declined",
      "requested_change",
      "ambiguous",
      "consent_withdrawn",
    ]),
    summary: z.string().min(1).max(500),
    finalTimeWindow: z
      .union([
        z.string(),
        z.object({ start: z.string(), end: z.string() }).transform(({ start, end }) => `${start}/${end}`),
      ])
      .nullable()
      .optional(),
  })
  .strict();

interface VoiceSocket {
  on(event: string, listener: (...args: unknown[]) => unknown): VoiceSocket;
  send(value: string): void;
  close(): void;
}

const socketFactory = (url: string, apiKey: string): VoiceSocket => {
  const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  return {
    on(event, listener) {
      socket.on(event, listener as never);
      return this;
    },
    send: (value) => socket.send(value),
    close: () => socket.close(),
  };
};

export const createOpenAiVoiceHandler = ({
  env = process.env,
  fetch: fetchResponse = globalThis.fetch,
  unwrap,
  createSocket = socketFactory,
  scheduleAgentRun,
}: {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  unwrap?: (body: string, headers: Record<string, unknown>) => Promise<unknown>;
  createSocket?: (url: string, apiKey: string) => VoiceSocket;
  scheduleAgentRun: (caseId: string) => void;
}) => {
  const config = controlledLiveVoiceConfig(env);
  const openai = new OpenAI({
    apiKey: config.openAiApiKey,
    webhookSecret: config.webhookSecret,
    fetch: fetchResponse,
    maxRetries: 0,
    timeout: 30_000,
  });
  const unwrapEvent =
    unwrap ??
    ((body: string, headers: Record<string, unknown>) =>
      openai.webhooks.unwrap(
        body,
        headers as Parameters<typeof openai.webhooks.unwrap>[1],
      ));

  return async (body: string, headers: Record<string, unknown>) => {
    const rawEvent = await unwrapEvent(body, headers);
    const parsed = incomingCallSchema.safeParse(rawEvent);
    if (!parsed.success) return;
    const event = parsed.data;
    const callSid = event.data.sip_headers.find(
      ({ name }) => name.toLowerCase() === "x-fix-this-call-sid",
    )?.value;
    if (callSid && repairStore.wasVoiceCallRetired(callSid)) {
      try {
        await openai.realtime.calls.reject(event.data.call_id);
      } catch {
        // The retired provider leg may already be gone.
      }
      return;
    }
    const eventKey = providerKey(`openai:webhook:${event.id}`, env);
    if (repairStore.wasVoiceCallbackHandled(eventKey)) return;
    if (!callSid) {
      await openai.realtime.calls.reject(event.data.call_id);
      return;
    }
    let claim: ReturnType<typeof repairStore.claimOpenAiVoiceConnection>;
    try {
      claim = repairStore.claimOpenAiVoiceConnection(callSid, eventKey);
    } catch {
      await openai.realtime.calls.reject(event.data.call_id);
      return;
    }
    if (claim.duplicate) return;

    const storedPrice = claim.authority.storedPrice!;
    const formattedPrice = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: storedPrice.currency,
    }).format(storedPrice.costPence / 100);
    const instructions = [
      "You are the automated AI voice assistant for Fix This.",
      "The contractor already heard the fixed AI disclosure and pressed 1 before this session.",
      `Contractor: ${claim.authority.contractorAlias}.`,
      `Stored agreement price: ${formattedPrice} (${storedPrice.priceBasis}).`,
      `Manager timing authority: ${claim.authority.managerTimeWindow}.`,
      `Tenant access authority: ${claim.authority.tenantTimeWindow}.`,
      "Ask for one final visit slot wholly inside both timing windows.",
      "Never negotiate or accept different terms. Report requested_change or ambiguous instead.",
      "A confirmation is not a booking. Report consent_withdrawn immediately if requested.",
      "Call report_call_outcome exactly once.",
    ].join(" ");
    try {
      await openai.realtime.calls.accept(event.data.call_id, {
        type: "realtime",
        model: "gpt-realtime-2.1",
        parallel_tool_calls: false,
        instructions,
        output_modalities: ["audio"],
        audio: {
          input: { transcription: { model: "gpt-live-transcribe", languages: ["en"] } },
          output: { voice: "marin" },
        },
        tools: [
          {
            type: "function",
            name: "report_call_outcome",
            description: "Record the contractor outcome and final slot, or immediate consent withdrawal.",
            parameters: {
              type: "object",
              properties: {
                outcome: {
                  type: "string",
                  enum: [
                    "confirmed",
                    "declined",
                    "requested_change",
                    "ambiguous",
                    "consent_withdrawn",
                  ],
                },
                summary: { type: "string" },
                finalTimeWindow: { type: ["string", "null"] },
              },
              required: ["outcome", "summary", "finalTimeWindow"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: "auto",
      });

      const socket = createSocket(
        `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(event.data.call_id)}`,
        config.openAiApiKey,
      );
      let ended = false;
      const endCall = async () => {
        if (ended) return;
        ended = true;
        socket.close();
        try {
          await openai.realtime.calls.hangup(event.data.call_id);
        } catch {
          // Provider status reconciliation remains authoritative after local close.
        }
      };
      const failAndEnd = async (failureKey: string, reason: string) => {
        if (ended) return;
        try {
          repairStore.recordVoiceFailure(callSid, failureKey, reason);
        } catch {
          // A terminal outcome already owns the case state.
        }
        await endCall();
      };
      socket.on("open", () => {
        try {
          socket.send(
            JSON.stringify({
              type: "response.create",
              response: {
                instructions:
                  "Briefly introduce yourself as an automated AI assistant, then ask whether the contractor confirms the exact approved terms and an in-bounds final slot.",
              },
            }),
          );
        } catch {
          void failAndEnd(
            providerKey(`openai:socket-send:${event.id}`, env),
            "The OpenAI control connection failed before the conversation started.",
          );
        }
      });
      socket.on("message", async (data) => {
        if (ended) return;
        try {
          let realtimeEvent: unknown;
          try {
            realtimeEvent = JSON.parse(String(data));
          } catch {
            return;
          }
          const serverError = z
            .object({
              event_id: z.string().min(1),
              type: z.literal("error"),
              error: z.object({ message: z.string().min(1) }),
            })
            .safeParse(realtimeEvent);
          if (serverError.success) {
            await failAndEnd(
              providerKey(`openai:error:${serverError.data.event_id}`, env),
              "The OpenAI voice session returned an error.",
            );
            return;
          }
          const inputTranscript = z
            .object({
              event_id: z.string().min(1),
              type: z.literal("conversation.item.input_audio_transcription.completed"),
              transcript: z.string().min(1).max(2_000),
            })
            .safeParse(realtimeEvent);
          if (inputTranscript.success) {
            repairStore.appendVoiceTranscript(
              callSid,
              providerKey(`openai:${inputTranscript.data.event_id}`, env),
              "contractor",
              inputTranscript.data.transcript,
            );
            return;
          }
          const outputTranscript = z
            .object({
              event_id: z.string().min(1),
              type: z.literal("response.output_audio_transcript.done"),
              transcript: z.string().min(1).max(2_000),
            })
            .safeParse(realtimeEvent);
          if (outputTranscript.success) {
            repairStore.appendVoiceTranscript(
              callSid,
              providerKey(`openai:${outputTranscript.data.event_id}`, env),
              "agent",
              outputTranscript.data.transcript,
            );
            return;
          }
          const completed = z
            .object({
              event_id: z.string().min(1),
              type: z.literal("response.done"),
              response: z.object({
                status: z
                  .enum(["completed", "cancelled", "failed", "incomplete", "in_progress"])
                  .optional(),
                output: z
                  .array(
                    z.object({
                      type: z.string(),
                      name: z.string().optional(),
                      call_id: z.string().optional(),
                      arguments: z.string().optional(),
                    }),
                  )
                  .optional()
                  .default([]),
              }),
            })
            .safeParse(realtimeEvent);
          if (!completed.success) return;
          const functionCalls = completed.data.response.output.filter(
            (item) => item.type === "function_call",
          );
          const parsedCalls = functionCalls.map((item) => {
            if (
              item.name !== "report_call_outcome" ||
              !item.call_id ||
              !item.arguments
            ) return undefined;
            try {
              const outcome = outcomeSchema.safeParse(JSON.parse(item.arguments));
              return outcome.success ? { item, outcome: outcome.data } : undefined;
            } catch {
              return undefined;
            }
          });
          const withdrawal = parsedCalls.find(
            (item) => item?.outcome.outcome === "consent_withdrawn",
          );
          if (
            !withdrawal &&
            ["failed", "incomplete"].includes(completed.data.response.status ?? "")
          ) {
            await failAndEnd(
              providerKey(`openai:response:${completed.data.event_id}`, env),
              "The OpenAI voice response failed or ended incomplete.",
            );
            return;
          }
          if (!functionCalls.length) return;
          const selected =
            withdrawal ?? (functionCalls.length === 1 ? parsedCalls[0] : undefined);
          if (!selected) throw new Error("The AI returned more than one or an invalid outcome.");
          const result = repairStore.recordVoiceOutcome(
            callSid,
            providerKey(`openai:tool:${selected.item.call_id}`, env),
            {
              outcome: selected.outcome.outcome,
              summary: selected.outcome.summary,
              finalTimeWindow: selected.outcome.finalTimeWindow ?? undefined,
            },
          );
          await endCall();
          if (result.shouldWake) scheduleAgentRun(result.repair.id);
        } catch {
          await failAndEnd(
            providerKey(`openai:invalid-event:${event.id}`, env),
            "The AI returned an invalid or incomplete call outcome.",
          );
        }
      });
      socket.on("error", async () => {
        await failAndEnd(
          providerKey(`openai:socket-error:${event.id}`, env),
          "The OpenAI control connection failed.",
        );
      });
      socket.on("close", async () => {
        await failAndEnd(
          providerKey(`openai:socket-close:${event.id}`, env),
          "The OpenAI control connection closed before a contractor outcome.",
        );
      });
      repairStore.completeOpenAiVoiceConnection(callSid, eventKey);
    } catch (error) {
      repairStore.failOpenAiVoiceConnection(callSid, eventKey);
      try {
        await openai.realtime.calls.hangup(event.data.call_id);
      } catch {
        // The accepted provider leg may already be gone.
      }
      throw error;
    }
  };
};
