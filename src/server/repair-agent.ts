import type { Severity, Trade } from "../shared/types.js";
import { z } from "zod";
import { controlledLiveConfig } from "./controlled-live.js";
import {
  createTwilioPhotoDownloader,
  RejectedPhotoEvidence,
  type DownloadedPhotoEvidence,
  type TwilioPhotoSource,
} from "./photo-evidence.js";
import { deliverText, KnownTextDeliveryFailure } from "./sms.js";
import { repairStore } from "./store.js";
import { KnownCallStartFailure, startControlledContractorCall } from "./voice.js";

export { KnownTextDeliveryFailure } from "./sms.js";
export { KnownCallStartFailure } from "./voice.js";

export interface RepairAgentDecision {
  nextStep: "ask_tenant" | "manager_review";
  title: string;
  summary: string;
  severity: Severity;
  trade: Trade;
  tenantReply: string;
  managerReason: string;
}

const repairAgentDecisionSchema = z.object({
  nextStep: z.enum(["ask_tenant", "manager_review"]),
  title: z.string().min(3).max(120),
  summary: z.string().min(3).max(800),
  severity: z.enum(["routine", "urgent", "emergency"]),
  trade: z.enum(["plumbing", "electrical", "heating", "locksmith", "general"]),
  tenantReply: z.string().min(1).max(220),
  managerReason: z.string().min(3).max(500),
});

const immediateDanger =
  /\b(fire|flames?|gas (?:smell|odor|leak)|smell(?:s|ing)? (?:of )?gas|carbon monoxide|co alarm|sparks?|sparking)\b/i;

const enforceEmergencySafety = (decision: RepairAgentDecision) => {
  if (decision.severity !== "emergency") return decision;
  return {
    ...decision,
    nextStep: "manager_review" as const,
    severity: "emergency" as const,
    tenantReply:
      "If there is immediate danger, leave the area and call 911. Fix This is not emergency dispatch. I flagged this for the property manager now.",
    managerReason:
      "Emergency report: alert property management now and keep the case out of normal automated booking.",
  };
};

const pendingImmediateDanger = (caseId: string) => {
  const repair = repairStore.get(caseId);
  const pendingMessageIds = new Set(
    repair.repairAgent?.events
      .filter(({ status }) => status === "pending")
      .map(({ messageId }) => messageId),
  );
  return repair.messages.find(
    ({ id, party, body }) =>
      party === "tenant" && pendingMessageIds.has(id) && immediateDanger.test(body),
  )?.body;
};

export interface RepairAgentInput {
  caseId: string;
  messages: Array<{ party: string; body: string }>;
  photos: DownloadedPhotoEvidence[];
}

interface TextDeliveryResult {
  delivery: "demo_outbox" | "local_outbox" | "twilio";
  providerId: string;
}

export const createRepairAgent = ({
  downloadPhotoEvidence,
  prepareManagerReview,
  sendTenantText,
  startContractorCall,
  waitBeforeRetry = () => new Promise((resolve) => setTimeout(resolve, 1_000)),
}: {
  downloadPhotoEvidence?: (source: TwilioPhotoSource) => Promise<DownloadedPhotoEvidence>;
  prepareManagerReview: (input: RepairAgentInput) => Promise<RepairAgentDecision>;
  sendTenantText: (body: string) => Promise<TextDeliveryResult>;
  startContractorCall?: (input: {
    caseId: string;
    effectKey: string;
    target: "contractor";
    approvalId: string;
  }) => Promise<{ providerId: string }>;
  waitBeforeRetry?: () => Promise<void>;
}) => {
  // ponytail: one protected worker owns the JSON store; use atomic shared claims before scaling out.
  let photoDownloader = downloadPhotoEvidence;
  const chains = new Map<string, Promise<void>>();
  const active = new Set<Promise<void>>();

  const dispatchEffect = async (caseId: string) => {
    const effect = repairStore.claimAgentEffect(caseId);
    if (!effect) return false;
    try {
      if (effect.type === "contractor_call") {
        if (!startContractorCall) throw new Error("Contractor call provider is unavailable.");
        const result = await startContractorCall({
          caseId,
          effectKey: effect.effectKey,
          target: effect.target,
          approvalId: effect.approvalId,
        });
        repairStore.completeContractorCallEffect(caseId, effect.effectKey, result.providerId);
      } else {
        const result = await sendTenantText(effect.body);
        repairStore.completeAgentEffect(caseId, effect.effectKey, result);
      }
    } catch (error) {
      const knownFailure =
        error instanceof KnownTextDeliveryFailure || error instanceof KnownCallStartFailure;
      const retryBooking =
        knownFailure &&
        effect.type === "tenant_sms" &&
        effect.purpose === "booking_confirmation" &&
        effect.attempts < 3;
      const failedBooking =
        knownFailure &&
        effect.type === "tenant_sms" &&
        effect.purpose === "booking_confirmation" &&
        effect.attempts >= 3;
      repairStore.failAgentEffect(
        caseId,
        effect.effectKey,
        failedBooking ? "failed" : knownFailure ? "retryable" : "unknown",
      );
      if (retryBooking) {
        await waitBeforeRetry();
        return dispatchEffect(caseId);
      }
    }
    return true;
  };

  const processCase = async (caseId: string) => {
    let attemptedEffect = false;
    while (true) {
      const dangerReport = pendingImmediateDanger(caseId);
      if (dangerReport) {
        const run = repairStore.startAgentRun(caseId);
        if (run) {
          const committed = repairStore.commitAgentDecision(
            caseId,
            run.runId,
            enforceEmergencySafety({
              nextStep: "manager_review",
              title: "Emergency repair report",
              summary: dangerReport,
              severity: "emergency",
              trade: "general",
              tenantReply: "Emergency safety reply",
              managerReason: "Emergency report",
            }),
          );
          if (committed) attemptedEffect = await dispatchEffect(caseId);
          continue;
        }
      }
      const photoJob = repairStore.claimPhotoEvidenceJob(caseId);
      if (photoJob) {
        try {
          repairStore.completePhotoEvidenceJob(
            caseId,
            photoJob.jobId,
            await (photoDownloader ??= createTwilioPhotoDownloader())(photoJob),
          );
        } catch (error) {
          const rejected = error instanceof RejectedPhotoEvidence;
          repairStore.failPhotoEvidenceJob(
            caseId,
            photoJob.jobId,
            !rejected,
            rejected ? error.message : "The photo could not be downloaded yet.",
          );
          if (!rejected) return;
        }
        continue;
      }
      const run = repairStore.startAgentRun(caseId);
      if (!run) break;
      try {
        const review = enforceEmergencySafety(
          repairAgentDecisionSchema.parse(await prepareManagerReview(run)),
        );
        const committed = repairStore.commitAgentDecision(caseId, run.runId, review);
        if (committed) attemptedEffect = await dispatchEffect(caseId);
      } catch (error) {
        repairStore.failAgentRun(caseId, run.runId, "Repair agent model failed.");
        return;
      }
    }
    if (!attemptedEffect) await dispatchEffect(caseId);
  };

  const wake = (caseId: string) => {
    const previous = chains.get(caseId) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(() => processCase(caseId))
      .catch(() => console.error("Repair agent wake failed."));
    chains.set(caseId, task);
    active.add(task);
    void task.finally(() => {
      active.delete(task);
      if (chains.get(caseId) === task) chains.delete(caseId);
    });
  };

  const idle = async () => {
    while (active.size) await Promise.all([...active]);
  };

  const resume = () => repairStore.recoverAgentWork().forEach(wake);

  return { wake, idle, resume };
};

export const createOpenAIRepairAgentModel = ({
  fetch: fetchResponse = globalThis.fetch,
  env = process.env,
}: {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
} = {}) => {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_TEXT_MODEL?.trim();
  if (!apiKey || !model) {
    throw new Error("The repair agent requires OPENAI_API_KEY and OPENAI_TEXT_MODEL.");
  }

  return async (input: RepairAgentInput): Promise<RepairAgentDecision> => {
    const { photos, ...caseInput } = input;
    const response = await fetchResponse("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model,
        store: false,
        parallel_tool_calls: false,
        instructions:
          "You triage one controlled rental-repair case. Use role labels only. Ask one concise tenant question when more facts are needed. When no photo is supplied, choose ask_tenant and use tenantReply for any other needed question; the server adds the photo request. Choose manager_review only when the report and supplied photo evidence are sufficient. Never treat a photo as identity or consent, approve cost, choose a phone number, contact a contractor, or book a visit.",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: JSON.stringify(caseInput) },
              ...photos.map(({ contentType, dataBase64 }) => ({
                type: "input_image",
                image_url: `data:${contentType};base64,${dataBase64}`,
              })),
            ],
          },
        ],
        tools: [
          {
            type: "function",
            name: "continue_repair_case",
            description:
              "Record bounded repair triage, one tenant reply, and whether to ask the tenant another question or pause for property-manager review.",
            strict: true,
            parameters: {
              type: "object",
              properties: {
                nextStep: {
                  type: "string",
                  enum: ["ask_tenant", "manager_review"],
                },
                title: { type: "string", minLength: 3, maxLength: 120 },
                summary: { type: "string", minLength: 3, maxLength: 800 },
                severity: {
                  type: "string",
                  enum: ["routine", "urgent", "emergency"],
                },
                trade: {
                  type: "string",
                  enum: ["plumbing", "electrical", "heating", "locksmith", "general"],
                },
                tenantReply: { type: "string", minLength: 1, maxLength: 220 },
                managerReason: { type: "string", minLength: 3, maxLength: 500 },
              },
              required: [
                "nextStep",
                "title",
                "summary",
                "severity",
                "trade",
                "tenantReply",
                "managerReason",
              ],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "function", name: "continue_repair_case" },
        max_output_tokens: 800,
      }),
    });
    const body = (await response.json()) as {
      error?: { message?: string };
      output?: Array<{ type?: string; name?: string; arguments?: string }>;
    };
    if (!response.ok) {
      throw new Error(body.error?.message ?? `OpenAI rejected the repair-agent run (${response.status}).`);
    }
    const call = body.output?.find(
      (item) => item.type === "function_call" && item.name === "continue_repair_case",
    );
    if (!call?.arguments) throw new Error("The repair agent did not choose the next case step.");
    return repairAgentDecisionSchema.parse(JSON.parse(call.arguments));
  };
};

let defaultAgent: ReturnType<typeof createRepairAgent> | undefined;

const getDefaultAgent = () =>
  (defaultAgent ??= createRepairAgent({
    prepareManagerReview: createOpenAIRepairAgentModel(),
    sendTenantText: (body) => deliverText(controlledLiveConfig().tenantPhone, body),
    startContractorCall: startControlledContractorCall,
  }));

export const liveRepairAgent = {
  wake: (caseId: string) => getDefaultAgent().wake(caseId),
  idle: () => getDefaultAgent().idle(),
  resume: () => getDefaultAgent().resume(),
};
