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
    trade: {
      type: "string",
      enum: ["plumbing", "electrical", "heating", "locksmith", "general"],
      description: "The repair trade needed to match the building's approved contractors.",
    },
    accessNotes: { type: "string", description: "When and how a contractor can get access." },
    requiredBy: {
      type: "string",
      description:
        "For urgent or emergency repairs, the latest acceptable response time as an ISO 8601 date-time.",
    },
  },
  required: ["caseId", "title", "summary", "severity", "trade"],
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

const preferredProposalSchema = {
  type: "object",
  properties: {
    caseId: { type: "string", description: "The repair case ID." },
    agreementId: {
      type: "string",
      description: "The approved agreement ID returned by get_contractor_path.",
    },
    timeWindow: { type: "string", description: "The proposed visit window in local time." },
    reason: { type: "string", description: "Why the approved contractor fits this repair." },
  },
  required: ["caseId", "agreementId", "timeWindow", "reason"],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;

const unavailableSchema = {
  type: "object",
  properties: {
    caseId: { type: "string", description: "The repair case ID." },
    agreementId: {
      type: "string",
      description: "The next approved agreement returned by get_contractor_path.",
    },
    reason: { type: "string", description: "Why the contractor cannot meet the response window." },
    earliestAvailableAt: {
      type: "string",
      description: "The contractor's earliest availability as an ISO 8601 date-time.",
    },
  },
  required: ["caseId", "agreementId", "reason", "earliestAvailableAt"],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;

const externalSearchSchema = {
  type: "object",
  properties: {
    caseId: { type: "string", description: "The repair case ID." },
    requiredBy: {
      type: "string",
      description:
        "For urgent or emergency repairs, the latest acceptable response time as an ISO 8601 date-time. Omit it for routine repairs; the server uses the deadline stored with the manager's request.",
    },
  },
  required: ["caseId"],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;

const externalProposalSchema = {
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

const proposalMessageEvidenceSchema = {
  type: "object",
  properties: {
    caseId: { type: "string", description: "The repair case ID." },
    sourceMessageId: {
      type: "string",
      description: "The source tenant or contractor message ID from the repair case.",
    },
    proposalId: { type: "string", description: "The current contractor proposal ID." },
    timeWindow: {
      type: "string",
      description: "The exact visit window on the current contractor proposal.",
    },
  },
  required: ["caseId", "sourceMessageId", "proposalId", "timeWindow"],
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
              annotations: { readOnlyHint: true },
              execute: () =>
                toolResult(
                  casesRef.current
                    .filter((repair) => repair.status !== "closed")
                    .map(({ id, title, status, severity, trade, tenant, updatedAt }) => ({
                      id,
                      title,
                      status,
                      severity,
                      trade,
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
                "Open one repair with its conversation, proposed visit, approvals, confirmations, appointment, tenant updates, and history.",
              inputSchema: caseIdSchema,
              annotations: { readOnlyHint: true },
              execute: async ({ caseId }) => toolResult(await api.getCase(caseId)),
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: "get_contractor_path",
              description:
                "Get the next approved contractor agreement for a repair. Use this before proposing a visit or recording that a contractor is unavailable.",
              inputSchema: caseIdSchema,
              annotations: { readOnlyHint: true },
              execute: async ({ caseId }) => toolResult(await api.getContractorPath(caseId)),
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: "triage_repair",
              description:
                "Turn a new tenant text into a clear repair summary. Record the issue, severity, access details, and the response deadline for urgent or emergency repairs using ordinary English.",
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
              name: "propose_preferred_contractor_visit",
              description:
                "Prepare a visit with the next approved contractor at the price already on file. This puts the option in front of the property manager; it does not approve or book anything.",
              inputSchema: preferredProposalSchema,
              execute: async ({ caseId, ...input }) => {
                const repair = await api.proposePreferred(caseId, input);
                onChangedRef.current(repair);
                return toolResult({
                  ok: true,
                  status: "waiting_for_manager_approval",
                  message: "The agreed-price visit is ready for the property manager to review.",
                  repair,
                });
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: "record_preferred_contractor_unavailable",
              description:
                "Record why the next approved contractor cannot meet the repair's response window, then return the next approved backup if one exists.",
              inputSchema: unavailableSchema,
              execute: async ({ caseId, ...input }) => {
                const result = await api.recordContractorUnavailable(caseId, input);
                onChangedRef.current(result.repair);
                return toolResult({ ok: true, ...result });
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: "start_external_contractor_search",
              description:
                "Look beyond the approved contractor list only when every eligible contractor is unavailable for an urgent repair, or the property manager has asked for other options on a routine repair. This returns a search brief; it does not approve or book anyone.",
              inputSchema: externalSearchSchema,
              execute: async ({ caseId, requiredBy }) => {
                const result = await api.startExternalSearch(caseId, requiredBy);
                onChangedRef.current(result.repair);
                return toolResult({ ok: true, ...result });
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: "propose_external_contractor_visit",
              description:
                "Add an outside quote only after the property manager or repair rules allow a wider search. The property manager still has to review and approve it before booking.",
              inputSchema: externalProposalSchema,
              annotations: { untrustedContentHint: true },
              execute: async ({ caseId, ...input }) => {
                const repair = await api.proposeExternal(caseId, input);
                onChangedRef.current(repair);
                return toolResult({
                  ok: true,
                  status: "waiting_for_manager_approval",
                  message: "The outside quote is ready for the property manager to review. Nothing has been booked.",
                  repair,
                });
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: "record_tenant_access_authorization",
              description:
                "Save the tenant's access confirmation from their own message for this contractor and time. This does not approve or book the visit.",
              inputSchema: proposalMessageEvidenceSchema,
              execute: async ({ caseId, ...input }) => {
                const repair = await api.recordTenantAccessAuthorization(caseId, input);
                onChangedRef.current(repair);
                return toolResult({ ok: true, evidence: repair.tenantAccessAuthorization, repair });
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: "record_contractor_confirmation",
              description:
                "Save the proposed contractor's confirmation from their own message for this exact visit time. This does not approve or book the visit.",
              inputSchema: proposalMessageEvidenceSchema,
              execute: async ({ caseId, ...input }) => {
                const repair = await api.recordContractorConfirmation(caseId, input);
                onChangedRef.current(repair);
                return toolResult({ ok: true, evidence: repair.contractorConfirmation, repair });
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: "book_approved_visit",
              description:
                "Book only when the property manager has approved the contractor and price, the tenant has confirmed access, and the contractor has accepted the same time. The server blocks early booking and queues the tenant update after success.",
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
