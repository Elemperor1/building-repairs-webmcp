import { useState } from "react";
import { api } from "./api";
import { AppHeader } from "./components/AppHeader";
import { CaseWorkspace } from "./components/CaseWorkspace";
import { ErrorBanner, LoadingShell, Notice } from "./components/Feedback";
import { RepairQueue } from "./components/RepairQueue";
import { SmsSimulator } from "./components/SmsSimulator";
import { UtilityNav } from "./components/UtilityNav";
import { useRepairCases } from "./useRepairCases";
import { useRepairWebMcp } from "./webmcp";

export default function App() {
  const repairs = useRepairCases();
  const [smsSimulatorOpen, setSmsSimulatorOpen] = useState(false);
  const toolStatus = useRepairWebMcp({
    cases: repairs.cases,
    onChanged: repairs.replaceCase,
  });

  const sendTenantMessage = async (body: string) => {
    if (!repairs.selected) return;
    await repairs.run(
      "tenant-message",
      () => api.sendTenantMessage(repairs.selected!.id, body),
      `Message sent to ${repairs.selected.tenant.name}.`,
    );
  };

  const sendManagerNote = async (body: string) => {
    if (!repairs.selected) return;
    await repairs.run(
      "manager-note",
      () => api.sendManagerNote(repairs.selected!.id, body),
      "Note sent to the agent.",
    );
  };

  const approveAndBook = async () => {
    if (!repairs.selected) return;
    await repairs.run(
      "approve-book",
      async () => {
        const approved =
          repairs.selected!.status === "approved"
            ? repairs.selected!
            : await api.approve(repairs.selected!.id);
        repairs.replaceCase(approved);
        return api.book(repairs.selected!.id);
      },
      "Visit booked and the tenant has been texted.",
    );
  };

  const requestExternalOptions = async (requiredBy: string) => {
    if (!repairs.selected) return;
    await repairs.run(
      "external-request",
      () =>
        api.requestExternalSearch(
          repairs.selected!.id,
          "Property manager",
          requiredBy,
        ),
      "The agent can now look for external options for this repair.",
    );
  };

  const simulateSms = async (input: Parameters<typeof api.simulateInboundText>[0]) => {
    await repairs.run(
      "simulate-sms",
      () => api.simulateInboundText(input),
      "Incoming text received and added to the repair queue.",
    );
  };

  return (
    <div className="app-shell">
      <AppHeader toolStatus={toolStatus} />
      <UtilityNav />
      <RepairQueue
        cases={repairs.cases}
        selectedId={repairs.selectedId}
        onSelect={repairs.selectCase}
        onOpenSmsSimulator={() => setSmsSimulatorOpen(true)}
      />
      {repairs.loading ? (
        <LoadingShell />
      ) : repairs.selected ? (
        <CaseWorkspace
          repair={repairs.selected}
          busy={repairs.busy}
          onSendTenantMessage={sendTenantMessage}
          onSendManagerNote={sendManagerNote}
          onApproveAndBook={approveAndBook}
          onRequestExternalOptions={requestExternalOptions}
        />
      ) : (
        <main className="empty-workspace">
          <h2>No repairs yet</h2>
          <p>New tenant texts will appear here automatically.</p>
        </main>
      )}

      {repairs.error ? <ErrorBanner message={repairs.error} onClose={repairs.clearError} /> : null}
      {repairs.notice ? <Notice message={repairs.notice} /> : null}
      <SmsSimulator
        open={smsSimulatorOpen}
        onClose={() => setSmsSimulatorOpen(false)}
        onSend={simulateSms}
      />
    </div>
  );
}
