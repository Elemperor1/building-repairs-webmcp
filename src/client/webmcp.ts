import { useEffect, useRef, useState } from "react";
import type { JsonSchemaForInference } from "@mcp-b/webmcp-types";
import type { RepairCase } from "../shared/types";
import { api } from "./api";

type ToolStatus = "connected" | "unavailable" | "error";

interface UseRepairWebMcpInput {
  cases: RepairCase[];
  onChanged: (repair: RepairCase) => void;
}

const toolResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

const emptySchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;

const caseIdSchema = {
  type: "object",
  properties: { caseId: { type: "string", description: "The repair case ID." } },
  required: ["caseId"],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;

const triageSchema = {
  type: "object",
  properties: {
    caseId: { type: "string", description: "The repair case ID." },
    title: { type: "string", description: "A short plain-English description of the problem." },
    summary: { type: "string", description: "What happened, relevant safety facts, and tenant access." },
    severity: {
      type: "string",
      enum: ["routine", "urgent", "emergency"],
      description: "The operational severity based on the available evidence.",
    },
    accessNotes: { type: "string", description: "When and how a contractor can get access." },
  },
  required: ["caseId", "title", "summary", "severity"],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;

const tenantMessageSchema = {
  type: "object",
  properties: {
    caseId: { type: "string", description: "The repair case ID." },
    message: { type: "string", description: "The exact text to send to the tenant." },
  },
  required: ["caseId", "message"],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;

const proposalSchema = {
  type: "object",
  properties: {
    caseId: { type: "string", description: "The repair case ID." },
    contractorName: { type: "string", description: "Contractor or company name." },
    contractorPhone: { type: "string", description: "Contractor contact number." },
    timeWindow: { type: "string", description: "The proposed visit window in local time." },
    costPence: { type: "integer", minimum: 1, description: "Quoted cost in pence." },
    reason: { type: "string", description: "Why this option fits the repair." },
  },
  required: ["caseId", "contractorName", "contractorPhone", "timeWindow", "costPence", "reason"],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;

export function useRepairWebMcp({ cases, onChanged }: UseRepairWebMcpInput): ToolStatus {
  const [status, setStatus] = useState<ToolStatus>("unavailable");
  const casesRef = useRef(cases);
  const onChangedRef = useRef(onChanged);

  casesRef.current = cases;
  onChangedRef.current = onChanged;

  useEffect(() => {
    const modelContext = document.modelContext ?? navigator.modelContext;
    if (!modelContext) {
      setStatus("unavailable");
      return;
    }

    const controller = new AbortController();

    const register = async () => {
      try {
        await Promise.all([
          modelContext.registerTool(
            {
              name: "list_open_repairs",
              description:
                "List active repair cases visible to the property manager. Use this before choosing a repair to inspect or update.",
              inputSchema: emptySchema,
              execute: () =>
                toolResult(
                  casesRef.current
                    .filter((repair) => repair.status !== "closed")
                    .map(({ id, title, status, severity, tenant, updatedAt }) => ({
                      id,
                      title,
                      status,
                      severity,
                      tenant: `${tenant.name}, ${tenant.unit}`,
                      updatedAt,
                    })),
                ),
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: "get_repair_case",
              description:
                "Get the full shared record for one repair, including tenant texts, access notes, proposal, approval, appointment, and activity history.",
              inputSchema: caseIdSchema,
              execute: async ({ caseId }) => toolResult(await api.getCase(caseId)),
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: "triage_repair",
              description:
                "Turn a new tenant text into a clear repair summary. Record the issue, severity, and access details using ordinary English.",
              inputSchema: triageSchema,
              execute: async ({ caseId, ...input }) => {
                const repair = await api.triage(caseId, input);
                onChangedRef.current(repair);
                return toolResult({ ok: true, repair });
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: "send_tenant_message",
              description:
                "Send a text message to the tenant for one repair. Ask only for information needed to assess safety, access, or scheduling.",
              inputSchema: tenantMessageSchema,
              execute: async ({ caseId, message }) => {
                const repair = await api.sendTenantMessage(caseId, message);
                onChangedRef.current(repair);
                return toolResult({ ok: true, sentTo: repair.tenant.name, repair });
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: "propose_contractor_visit",
              description:
                "Add a contractor, price, and available time to a repair for the property manager to review. This does not approve or book the visit.",
              inputSchema: proposalSchema,
              execute: async ({ caseId, ...input }) => {
                const repair = await api.propose(caseId, input);
                onChangedRef.current(repair);
                return toolResult({
                  ok: true,
                  status: "waiting_for_manager_approval",
                  message: "The proposal is visible to the property manager. Do not book it yet.",
                  repair,
                });
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: "book_approved_visit",
              description:
                "Book the contractor visit only after the property manager has approved the current proposal. The server rejects early booking and texts the tenant after success.",
              inputSchema: caseIdSchema,
              execute: async ({ caseId }) => {
                const repair = await api.book(caseId);
                onChangedRef.current(repair);
                return toolResult({ ok: true, appointment: repair.appointment, repair });
              },
            },
            { signal: controller.signal },
          ),
        ]);

        if (!controller.signal.aborted) setStatus("connected");
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("WebMCP tool registration failed", error);
          setStatus("error");
        }
      }
    };

    void register();
    return () => controller.abort();
  }, []);

  return status;
}
