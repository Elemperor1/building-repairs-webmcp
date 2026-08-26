import { resolve } from "node:path";
import express, { type ErrorRequestHandler } from "express";
import { z } from "zod";
import { sendText } from "./sms.js";
import { repairStore } from "./store.js";

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
  accessNotes: z.string().optional(),
});

const proposalSchema = z.object({
  contractorName: z.string().min(2),
  contractorPhone: z.string().min(3),
  timeWindow: z.string().min(3),
  costPence: z.number().int().positive(),
  reason: z.string().min(3),
});

const messageSchema = z.object({ body: z.string().min(1).max(1000) });

export const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, smsDelivery: process.env.TWILIO_ACCOUNT_SID ? "twilio" : "local_outbox" });
  });

  app.get("/api/cases", (_request, response) => {
    response.json({ cases: repairStore.list() });
  });

  app.get("/api/cases/:caseId", (request, response) => {
    response.json({ repair: repairStore.get(request.params.caseId) });
  });

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

  app.post("/api/cases/:caseId/book", async (request, response) => {
    const repair = repairStore.book(request.params.caseId);
    await sendText(
      repair.tenant.phone,
      `Your repair visit is booked with ${repair.appointment?.contractorName} for ${repair.appointment?.timeWindow}.`,
    );
    response.json({ repair });
  });

  app.get("/api/outbox", (_request, response) => {
    response.json({ messages: repairStore.outbox() });
  });

  app.post("/api/dev/reset", (_request, response) => {
    response.json(repairStore.reset());
  });

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
