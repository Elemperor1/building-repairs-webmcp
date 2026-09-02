import { resolve } from "node:path";
import express, { type ErrorRequestHandler, type Request } from "express";
import twilio from "twilio";
import { z } from "zod";
import {
  controlledLiveConfig,
  controlledLiveVoiceConfig,
  isControlledLiveManager,
  isControlledLiveMode,
  providerKey,
} from "./controlled-live.js";
import { assertRuntimeSafety, DEMO_CASE_ID, isDemoMode } from "./demo.js";
import { RejectedPhotoEvidence, twilioPhotoSources } from "./photo-evidence.js";
import { liveRepairAgent } from "./repair-agent.js";
import { sendText } from "./sms.js";
import { appointmentNotification, repairStore } from "./store.js";
import {
  controlledCallTimeLimitSeconds,
  createOpenAiVoiceHandler,
} from "./voice.js";

const inboundSmsSchema = z.object({
  From: z.string().min(3).optional(),
  Body: z.string().min(1).optional(),
  from: z.string().min(3).optional(),
  body: z.string().min(1).optional(),
  tenantName: z.string().optional(),
  unit: z.string().optional(),
});

const controlledLiveSmsSchema = z
  .object({
    AccountSid: z.string().min(1),
    MessageSid: z.string().min(1),
    From: z.string().min(3),
    To: z.string().min(3),
    Body: z.string().max(1600),
    OptOutType: z.enum(["STOP", "START", "HELP"]).optional(),
  })
  .passthrough();

const controlledLiveVoiceSchema = z
  .object({
    AccountSid: z.string().min(1),
    CallSid: z.string().regex(/^CA[0-9a-fA-F]{32}$/),
    From: z.string().min(3),
    To: z.string().min(3),
  })
  .passthrough();
const controlledLiveVoiceConsentSchema = controlledLiveVoiceSchema.extend({
  Digits: z.string().regex(/^[0-9*#]$/).optional(),
});
const voiceTransportStatusSchema = z.enum([
  "queued",
  "initiated",
  "ringing",
  "in-progress",
  "completed",
  "busy",
  "failed",
  "no-answer",
  "canceled",
]);
const controlledLiveVoiceStatusSchema = controlledLiveVoiceSchema.extend({
  CallStatus: voiceTransportStatusSchema,
  SequenceNumber: z.coerce.number().int().nonnegative().optional(),
});
const controlledLiveVoiceQuerySchema = z.object({ approval: z.string().min(1) });

const voiceDisclosure =
  "This is an automated AI call from Fix This. Press 1 to agree to AI processing and transcription, or press 2 to decline.";
const manualVoiceFallback =
  "No audio was sent to the AI. The property manager will follow up manually.";
const manualPostConsentFallback =
  "The automated confirmation could not be verified. The property manager will follow up manually.";

const stopKeywords = new Set([
  "STOP",
  "UNSUBSCRIBE",
  "END",
  "QUIT",
  "STOPALL",
  "REVOKE",
  "OPTOUT",
  "CANCEL",
]);
const startKeywords = new Set(["START", "UNSTOP"]);
const messagingPreference = (body: string, optOutType?: "STOP" | "START" | "HELP") => {
  if (optOutType) return optOutType;
  const keyword = body.trim().toUpperCase();
  if (stopKeywords.has(keyword)) return "STOP" as const;
  if (startKeywords.has(keyword)) return "START" as const;
  if (keyword === "HELP") return "HELP" as const;
  return undefined;
};

const triageSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(3),
  severity: z.enum(["routine", "urgent", "emergency"]),
  trade: z.enum(["plumbing", "electrical", "heating", "locksmith", "general"]),
  accessNotes: z.string().optional(),
  requiredBy: z.string().datetime().optional(),
});

const proposalSchema = z.object({
  contractorName: z.string().min(2),
  contractorPhone: z.string().min(3),
  timeWindow: z.string().min(3),
  costPence: z.number().int().positive(),
  reason: z.string().min(3),
});

const isoInstantSchema = z.string().datetime({ offset: true });
const timeWindowSchema = z.string().refine((value) => {
  const [start, end, extra] = value.split("/");
  return Boolean(
    !extra &&
      isoInstantSchema.safeParse(start).success &&
      isoInstantSchema.safeParse(end).success &&
      Date.parse(start!) < Date.parse(end!),
  );
}, "Use an ISO 8601 start/end time window.");

const preferredProposalSchema = z.object({
  agreementId: z.string().min(3),
  timeWindow: z.string().min(3),
  reason: z.string().min(3),
});

const contractorUnavailableSchema = z.object({
  agreementId: z.string().min(3),
  reason: z.string().min(3),
  earliestAvailableAt: z.string().datetime(),
});

const externalSearchSchema = z.object({
  requiredBy: z.string().datetime().optional(),
});

const externalSearchRequestSchema = z.object({
  requestedBy: z.string().min(2),
  requiredBy: z.string().datetime(),
});

const messageSchema = z.object({ body: z.string().min(1).max(1000) });

const bookingEvidenceSchema = z.object({
  sourceMessageId: z.string().min(1),
  proposalId: z.string().min(1),
  timeWindow: z.string().min(1),
});
const callApprovalSchema = z
  .object({
    proposalId: z.string().min(1),
    caseRevision: z.number().int().nonnegative(),
    agreementId: z.string().min(1),
    costPence: z.number().int().positive(),
    currency: z.literal("USD"),
    managerTimeWindow: timeWindowSchema,
    tenantAccessSourceMessageId: z.string().min(1),
    tenantTimeWindow: timeWindowSchema,
  })
  .strict();
const controlledResetSchema = z
  .object({ confirmation: z.literal("delete controlled-live case content") })
  .strict();
const effectReconciliationSchema = z.discriminatedUnion("resolution", [
  z
    .object({
      effectKey: z.string().min(1),
      resolution: z.literal("absent"),
      confirmation: z.literal(
        "provider confirms no outbound effect was accepted; reconcile saved record",
      ),
    })
    .strict(),
  z
    .object({
      effectKey: z.string().min(1),
      resolution: z.literal("accepted"),
      confirmation: z.literal("provider confirms outbound effect was accepted"),
      providerId: z.string().regex(/^CA[0-9a-fA-F]{32}$/).optional(),
      providerStatus: voiceTransportStatusSchema.optional(),
    })
    .strict(),
]);
const demoMessageSchema = z
  .object({
    sender: z.enum(["tenant", "contractor"]),
    body: z.string().min(1).max(1000),
    mediaId: z.literal("demo-bathroom-leak").optional(),
  })
  .strict();

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const createApp = ({
  now = () => new Date(),
  scheduleAgentRun = liveRepairAgent.wake,
}: {
  now?: () => Date;
  scheduleAgentRun?: (caseId: string) => void;
} = {}) => {
  const demoMode = isDemoMode();
  const controlledLiveMode = isControlledLiveMode();
  assertRuntimeSafety();
  const app = express();
  if (controlledLiveMode) {
    app.use((request, response, next) => {
      response.set("X-Frame-Options", "DENY");
      response.set("Content-Security-Policy", "frame-ancestors 'none'");
      if (request.path.startsWith("/api")) {
        response.set("Cache-Control", "private, no-store");
      }
      next();
    });
  }
  if (controlledLiveMode) {
    let handleOpenAiVoice: ReturnType<typeof createOpenAiVoiceHandler> | undefined;
    app.post(
      "/api/voice/openai/webhook",
      express.text({ type: "application/json" }),
      async (request, response) => {
        try {
          if (typeof request.body !== "string") throw new Error("Webhook rejected.");
          handleOpenAiVoice ??= createOpenAiVoiceHandler({ scheduleAgentRun });
          await handleOpenAiVoice(request.body, request.headers);
          response.sendStatus(200);
        } catch {
          response.sendStatus(400);
        }
      },
    );
  }
  const verifiedVoiceCallback = (request: Request) => {
    if (!request.is("application/x-www-form-urlencoded")) {
      throw new HttpError(415, "Webhook rejected.");
    }
    const config = controlledLiveVoiceConfig();
    const webhookUrl = new URL(request.originalUrl, `${config.publicBaseUrl}/`).toString();
    if (
      !twilio.validateRequest(
        config.authToken,
        request.header("X-Twilio-Signature") ?? "",
        webhookUrl,
        request.body,
      )
    ) {
      throw new HttpError(403, "Webhook rejected.");
    }
    const input = controlledLiveVoiceSchema.parse(request.body);
    if (
      input.AccountSid !== config.accountSid ||
      input.From !== config.servicePhone ||
      input.To !== config.contractorPhone
    ) {
      throw new HttpError(403, "Webhook rejected.");
    }
    const { approval } = controlledLiveVoiceQuerySchema.parse(request.query);
    return { config, input, approvalId: approval };
  };
  app.use((request, response, next) => {
    const publicRequest =
      (request.method === "GET" && request.path === "/api/health") ||
      (request.method === "POST" &&
        (request.path === "/api/sms/inbound" || request.path.startsWith("/api/voice/")));
    if (
      controlledLiveMode &&
      !publicRequest &&
      !isControlledLiveManager(request.header("Authorization"))
    ) {
      response.set("WWW-Authenticate", 'Basic realm="Fix This controlled live", charset="UTF-8"');
      response.status(401).json({ error: "Manager authentication required." });
      return;
    }
    next();
  });
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use((request, _response, next) => {
    const controlledLiveWrite =
      request.method === "POST" &&
      (request.path === "/api/controlled-live/reset" ||
        /^\/api\/cases\/[^/]+\/(contractor-proposal|access-authorization|call-approval|effect-reconciliation)$/.test(
          request.path,
        ));
    if (controlledLiveMode && controlledLiveWrite && !request.is("application/json")) {
      throw new HttpError(415, "Manager writes require application/json.");
    }
    if (
      controlledLiveMode &&
      request.method !== "GET" &&
      !(
        request.method === "POST" &&
        (request.path === "/api/sms/inbound" || request.path.startsWith("/api/voice/"))
      ) &&
      !controlledLiveWrite
    ) {
      throw new HttpError(409, "Controlled-live manager actions are not enabled yet.");
    }
    next();
  });

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      demoMode,
      smsDelivery: demoMode
        ? "demo_outbox"
        : process.env.TWILIO_ACCOUNT_SID
          ? "twilio"
          : "local_outbox",
      ...(demoMode ? { voiceCallAllowlist: [] } : {}),
    });
  });

  app.get("/api/cases", (_request, response) => {
    response.json({ cases: repairStore.list(), demoMode, controlledLiveMode });
  });

  app.get("/api/cases/:caseId", (request, response) => {
    response.json({ repair: repairStore.get(request.params.caseId) });
  });

  app.get("/api/cases/:caseId/evidence/:evidenceId", (request, response) => {
    const evidence = repairStore.photoEvidence(
      request.params.caseId,
      request.params.evidenceId,
    );
    response
      .set({
        "Cache-Control": "private, no-store",
        "Content-Type": evidence.contentType,
        "X-Content-Type-Options": "nosniff",
      })
      .send(evidence.bytes);
  });

  app.get("/api/cases/:caseId/contractor-path", (request, response) => {
    response.json({ decision: repairStore.contractorPath(request.params.caseId) });
  });

  app.post("/api/cases/:caseId/contractor-proposal", (request, response) => {
    response.json({
      repair: repairStore.proposePreferred(
        request.params.caseId,
        preferredProposalSchema.parse(request.body),
      ),
    });
  });

  app.post("/api/cases/:caseId/contractor-attempts/unavailable", (request, response) => {
    response.json(
      repairStore.recordContractorUnavailable(
        request.params.caseId,
        contractorUnavailableSchema.parse(request.body),
      ),
    );
  });

  app.post("/api/cases/:caseId/external-search", (request, response) => {
    response.json(
      repairStore.startExternalSearch(
        request.params.caseId,
        externalSearchSchema.parse(request.body),
      ),
    );
  });

  app.post("/api/cases/:caseId/external-search/request", (request, response) => {
    response.json({
      repair: repairStore.requestExternalSearch(
        request.params.caseId,
        externalSearchRequestSchema.parse(request.body),
      ),
    });
  });

  if (!demoMode) {
    app.post("/api/sms/inbound", (request, response) => {
      if (controlledLiveMode) {
        if (!request.is("application/x-www-form-urlencoded")) {
          throw new HttpError(415, "Webhook rejected.");
        }
        const config = controlledLiveConfig();
        const signature = request.header("X-Twilio-Signature") ?? "";
        const webhookUrl = new URL(request.originalUrl, `${config.publicBaseUrl}/`).toString();
        if (!twilio.validateRequest(config.authToken, signature, webhookUrl, request.body)) {
          throw new HttpError(403, "Webhook rejected.");
        }
        const input = controlledLiveSmsSchema.parse(request.body);
        if (
          input.AccountSid !== config.accountSid ||
          input.From !== config.tenantPhone ||
          input.To !== config.servicePhone
        ) {
          throw new HttpError(403, "Webhook rejected.");
        }
        const sourceKey = providerKey(input.MessageSid);
        if (repairStore.wasSmsEventHandled(sourceKey)) {
          response.type("text/xml").send("<Response></Response>");
          return;
        }
        const photos = twilioPhotoSources(input, config.accountSid, input.MessageSid);
        if (!input.Body.trim() && !photos.length) throw new HttpError(400, "Webhook rejected.");
        const { repair, duplicate, shouldWake } = repairStore.receiveVerifiedSms({
          sourceKey,
          body: input.Body.trim() || "Photo evidence attached.",
          preference: messagingPreference(input.Body, input.OptOutType),
          photos,
        });
        response.type("text/xml").send("<Response></Response>");
        if (!duplicate && shouldWake) scheduleAgentRun(repair.id);
        return;
      }
      const input = inboundSmsSchema.parse(request.body);
      const repair = repairStore.receiveSms({
        from: input.From ?? input.from ?? "",
        body: input.Body ?? input.body ?? "",
        tenantName: input.tenantName,
        unit: input.unit,
      });

      if (request.is("application/x-www-form-urlencoded")) {
        response.type("text/xml").send("<Response></Response>");
        return;
      }
      response.status(201).json({ repair });
    });
  }

  if (controlledLiveMode) {
    app.post("/api/voice/twilio/consent", (request, response) => {
      const { config, input, approvalId } = verifiedVoiceCallback(request);
      const eventKey = providerKey(`voice:disclosure:${input.CallSid}`);
      if (
        repairStore.wasVoiceCallbackHandled(eventKey) ||
        repairStore.wasVoiceCallRetired(input.CallSid)
      ) {
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.hangup();
        response.type("text/xml").send(twiml.toString());
        return;
      }
      repairStore.bindVoiceCallback(approvalId, input.CallSid);
      repairStore.recordVoiceDisclosure(input.CallSid, eventKey);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml
        .gather({
          action: `${config.publicBaseUrl}/api/voice/twilio/consent-result?approval=${encodeURIComponent(approvalId)}`,
          actionOnEmptyResult: true,
          input: ["dtmf"],
          method: "POST",
          numDigits: 1,
          timeout: 8,
        })
        .say(voiceDisclosure);
      response.type("text/xml").send(twiml.toString());
    });

    app.post("/api/voice/twilio/consent-result", (request, response) => {
      const { config, input, approvalId } = verifiedVoiceCallback(request);
      const { Digits } = controlledLiveVoiceConsentSchema.parse(request.body);
      const consent = Digits === "1" ? "granted" : Digits === "2" ? "declined" : "timed_out";
      const eventKey = providerKey(`voice:consent:${input.CallSid}:${Digits ?? "timeout"}`);
      if (
        repairStore.wasVoiceCallbackHandled(eventKey) ||
        repairStore.wasVoiceCallRetired(input.CallSid)
      ) {
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.hangup();
        response.type("text/xml").send(twiml.toString());
        return;
      }
      repairStore.bindVoiceCallback(approvalId, input.CallSid);
      repairStore.recordVoiceConsent(input.CallSid, eventKey, consent);
      const twiml = new twilio.twiml.VoiceResponse();
      if (consent === "granted" && repairStore.claimVoiceSipBridge(input.CallSid)) {
        twiml
          .dial({
            action: `${config.publicBaseUrl}/api/voice/twilio/sip-complete?approval=${encodeURIComponent(approvalId)}`,
            method: "POST",
            timeLimit: controlledCallTimeLimitSeconds,
          })
          .sip(
            `sip:${config.projectId}@sip.api.openai.com;transport=tls?x-fix-this-call-sid=${encodeURIComponent(input.CallSid)}`,
          );
      } else {
        if (consent === "granted") {
          repairStore.recordVoiceFailure(
            input.CallSid,
            providerKey(`voice:sip-bridge-rejected:${input.CallSid}`),
            "The approved call facts changed before the AI bridge could start.",
          );
        }
        twiml.say(manualVoiceFallback);
        twiml.hangup();
      }
      response.type("text/xml").send(twiml.toString());
    });

    app.post("/api/voice/twilio/sip-complete", (request, response) => {
      const { input, approvalId } = verifiedVoiceCallback(request);
      const eventKey = providerKey(`voice:sip-complete:${input.CallSid}`);
      if (
        repairStore.wasVoiceCallbackHandled(eventKey) ||
        repairStore.wasVoiceCallRetired(input.CallSid)
      ) {
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.hangup();
        response.type("text/xml").send(twiml.toString());
        return;
      }
      repairStore.bindVoiceCallback(approvalId, input.CallSid);
      repairStore.recordVoiceFailure(
        input.CallSid,
        eventKey,
        "The consented call ended without a contractor outcome.",
        true,
      );
      const outcome = repairStore.voiceCallContext(input.CallSid).outcome;
      const twiml = new twilio.twiml.VoiceResponse();
      if (outcome === "confirmed") {
        twiml.say(
          "The approved terms were recorded. The property manager will handle the next step. Goodbye.",
        );
      } else if (outcome !== "consent_withdrawn") {
        twiml.say(manualPostConsentFallback);
      }
      twiml.hangup();
      response.type("text/xml").send(twiml.toString());
    });

    app.post("/api/voice/twilio/status", (request, response) => {
      const { input, approvalId } = verifiedVoiceCallback(request);
      const { CallStatus, SequenceNumber } = controlledLiveVoiceStatusSchema.parse(request.body);
      const eventKey = providerKey(
        `voice:status:${input.CallSid}:${SequenceNumber ?? CallStatus}`,
      );
      if (
        repairStore.wasVoiceCallbackHandled(eventKey) ||
        repairStore.wasVoiceCallRetired(input.CallSid)
      ) {
        response.sendStatus(204);
        return;
      }
      repairStore.bindVoiceCallback(approvalId, input.CallSid);
      repairStore.recordVoiceTransport(
        input.CallSid,
        eventKey,
        CallStatus,
        SequenceNumber,
      );
      response.sendStatus(204);
    });

    app.post("/api/controlled-live/reset", (request, response) => {
      controlledResetSchema.parse(request.body);
      const resetAt = now();
      repairStore.resetControlledLive(resetAt);
      response.json({ resetAt: resetAt.toISOString(), cases: 0 });
    });
  }

  app.post("/api/cases/:caseId/triage", (request, response) => {
    response.json({ repair: repairStore.triage(request.params.caseId, triageSchema.parse(request.body)) });
  });

  app.post("/api/cases/:caseId/messages/tenant", async (request, response) => {
    const { body } = messageSchema.parse(request.body);
    const existing = repairStore.get(request.params.caseId);
    await sendText(existing.tenant.phone, body);
    response.json({ repair: repairStore.addMessage(request.params.caseId, "agent", body) });
  });

  app.post("/api/cases/:caseId/messages/manager", (request, response) => {
    const { body } = messageSchema.parse(request.body);
    response.json({ repair: repairStore.addMessage(request.params.caseId, "manager", body) });
  });

  app.post("/api/cases/:caseId/proposal", (request, response) => {
    response.json({ repair: repairStore.propose(request.params.caseId, proposalSchema.parse(request.body)) });
  });

  app.post("/api/cases/:caseId/approve", (request, response) => {
    const approvedBy = z.object({ approvedBy: z.string().min(2) }).parse(request.body).approvedBy;
    response.json({ repair: repairStore.approve(request.params.caseId, approvedBy) });
  });

  app.post("/api/cases/:caseId/call-approval", (request, response) => {
    const repair = repairStore.approveContractorCall(
      request.params.caseId,
      callApprovalSchema.parse(request.body),
    );
    scheduleAgentRun(repair.id);
    response.json({ repair });
  });

  app.post("/api/cases/:caseId/effect-reconciliation", (request, response) => {
    const reconciliation = effectReconciliationSchema.parse(request.body);
    const repair = repairStore.reconcileOutboundEffect(
      request.params.caseId,
      reconciliation.effectKey,
      reconciliation.resolution,
      "providerId" in reconciliation ? reconciliation.providerId : undefined,
      "providerStatus" in reconciliation ? reconciliation.providerStatus : undefined,
    );
    scheduleAgentRun(repair.id);
    response.json({ repair });
  });

  app.post("/api/cases/:caseId/access-authorization", (request, response) => {
    response.json({
      repair: repairStore.recordTenantAccessAuthorization(
        request.params.caseId,
        bookingEvidenceSchema.parse(request.body),
      ),
    });
  });

  app.post("/api/cases/:caseId/contractor-confirmation", (request, response) => {
    response.json({
      repair: repairStore.recordContractorConfirmation(
        request.params.caseId,
        bookingEvidenceSchema.parse(request.body),
      ),
    });
  });

  app.post("/api/cases/:caseId/book", async (request, response) => {
    let repair = repairStore.book(request.params.caseId);
    if (!demoMode) {
      const { to, body } = appointmentNotification(repair);
      const { message } = await sendText(to, body, repair.id);
      repair = repairStore.recordAppointmentNotification(repair.id, message);
    }
    response.json({ repair });
  });

  app.get("/api/outbox", (_request, response) => {
    response.json({ messages: repairStore.outbox() });
  });

  if (demoMode) {
    app.post("/api/demo/messages", (request, response) => {
      response.status(201).json({ repair: repairStore.receiveDemoMessage(demoMessageSchema.parse(request.body)) });
    });

    app.post("/api/demo/reset", (_request, response) => {
      const resetAt = now();
      repairStore.reset(resetAt);
      response.json({ resetAt: resetAt.toISOString(), caseId: DEMO_CASE_ID });
    });
  } else if (!controlledLiveMode) {
    app.post("/api/dev/reset", (_request, response) => {
      response.json(repairStore.reset());
    });
  }

  const clientPath = resolve(process.cwd(), "dist/client");
  app.use(express.static(clientPath));
  app.get("/{*path}", (_request, response) => response.sendFile(resolve(clientPath, "index.html")));

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof z.ZodError || error instanceof RejectedPhotoEvidence
          ? 400
          : message.includes("not found")
            ? 404
            : 409;
    response.status(status).json({ error: message });
  };
  app.use(errorHandler);

  return app;
};
