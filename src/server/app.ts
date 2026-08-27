import { resolve } from "node:path";
import express, { type ErrorRequestHandler } from "express";
import { z } from "zod";
import { assertDemoSafety, DEMO_CASE_ID, isDemoMode } from "./demo.js";
import { sendText } from "./sms.js";
import { appointmentNotification, repairStore } from "./store.js";

const inboundSmsSchema = z.object({
  From: z.string().min(3).optional(),
  Body: z.string().min(1).optional(),
  from: z.string().min(3).optional(),
  body: z.string().min(1).optional(),
  tenantName: z.string().optional(),
  unit: z.string().optional(),
});

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
const demoMessageSchema = z
  .object({
    sender: z.enum(["tenant", "contractor"]),
    body: z.string().min(1).max(1000),
    mediaId: z.literal("demo-bathroom-leak").optional(),
  })
  .strict();

export const createApp = ({ now = () => new Date() }: { now?: () => Date } = {}) => {
  const demoMode = isDemoMode();
  assertDemoSafety();
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

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
    response.json({ cases: repairStore.list(), demoMode });
  });

  app.get("/api/cases/:caseId", (request, response) => {
    response.json({ repair: repairStore.get(request.params.caseId) });
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
  } else {
    app.post("/api/dev/reset", (_request, response) => {
      response.json(repairStore.reset());
    });
  }

  const clientPath = resolve(process.cwd(), "dist/client");
  app.use(express.static(clientPath));
  app.get("/{*path}", (_request, response) => response.sendFile(resolve(clientPath, "index.html")));

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const status = error instanceof z.ZodError ? 400 : message.includes("not found") ? 404 : 409;
    response.status(status).json({ error: message });
  };
  app.use(errorHandler);

  return app;
};
