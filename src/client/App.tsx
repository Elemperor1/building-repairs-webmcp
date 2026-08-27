import { useState } from "react";
import type { DemoMessageInput, InboundSmsInput } from "../shared/types";
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

  const approveProposal = async () => {
    if (!repairs.selected) return;
    await repairs.run(
      "approve-proposal",
      () =>
        api.approve(
          repairs.selected!.id,
          repairs.demoMode ? "Priya Shah (demo manager)" : "Property manager",
        ),
      "Contractor and price approved.",
    );
  };

  const bookVisit = async () => {
    if (!repairs.selected) return;
    await repairs.run(
      "book-visit",
      () => api.book(repairs.selected!.id),
      "Visit booked and the tenant notification is recorded.",
    );
  };

  const requestExternalOptions = async (requiredBy: string) => {
    if (!repairs.selected) return;
    await repairs.run(
      "external-request",
      () =>
        api.requestExternalSearch(
          repairs.selected!.id,
          repairs.demoMode ? "Priya Shah (demo manager)" : "Property manager",
          requiredBy,
        ),
      "The agent can now look for external options for this repair.",
    );
  };

  const simulateSms = async (input: DemoMessageInput | InboundSmsInput) => {
    await repairs.run(
      "simulate-sms",
      () => ("sender" in input ? api.simulateDemoMessage(input) : api.simulateInboundText(input)),
      "Incoming text received and added to the repair queue.",
    );
  };

  const resetDemo = async () => {
    if (!window.confirm("Reset the shared synthetic demo to a clean repair?")) return;
    await repairs.resetDemo();
  };

  return (
    <div className="app-shell">
      <AppHeader toolStatus={toolStatus} demoMode={repairs.demoMode} />
      <UtilityNav />
      <RepairQueue
        cases={repairs.cases}
        selectedId={repairs.selectedId}
        onSelect={repairs.selectCase}
        onOpenSmsSimulator={() => setSmsSimulatorOpen(true)}
        demoMode={repairs.demoMode}
        resetting={repairs.busy === "demo-reset"}
        onResetDemo={resetDemo}
      />
      {repairs.loading ? (
        <LoadingShell />
      ) : repairs.selected ? (
        <CaseWorkspace
          repair={repairs.selected}
          busy={repairs.busy}
          onSendTenantMessage={sendTenantMessage}
          onSendManagerNote={sendManagerNote}
          onApprove={approveProposal}
          onBook={bookVisit}
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
        demoMode={repairs.demoMode}
      />
    </div>
  );
}
