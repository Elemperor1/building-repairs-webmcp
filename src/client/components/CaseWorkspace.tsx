import { AlertTriangle, Clock3 } from "lucide-react";
import { useState } from "react";
import type { RepairCase } from "../../shared/types";
import { ActivityRail } from "./ActivityRail";
import { MessagesPanel } from "./MessagesPanel";
import { ProposalPanel } from "./ProposalPanel";

interface CaseWorkspaceProps {
  repair: RepairCase;
  busy?: string;
  onSendTenantMessage: (message: string) => Promise<void>;
  onSendManagerNote: (note: string) => Promise<void>;
  onApprove: () => Promise<void>;
  onBook: () => Promise<void>;
  onRequestExternalOptions: (requiredBy: string) => Promise<void>;
}

const statusCopy: Record<RepairCase["status"], string> = {
  new: "New repair",
  waiting_for_approval: "Waiting for your approval",
  approved: "Manager approved",
  scheduled: "Visit scheduled",
  closed: "Repair closed",
};

export function CaseWorkspace({
  repair,
  busy,
  onSendTenantMessage,
  onSendManagerNote,
  onApprove,
  onBook,
  onRequestExternalOptions,
}: CaseWorkspaceProps) {
  const [noteFocusToken, setNoteFocusToken] = useState(0);
  const urgent = repair.severity === "emergency";

  return (
    <main className="case-layout">
      <div className="case-workspace">
        <header className="case-heading">
          <h2>{repair.title}</h2>
          <p className="case-meta">
            {repair.tenant.name}, {repair.tenant.unit}
          </p>
          <p className="case-summary">{repair.summary}</p>
          <div className={urgent ? "case-status case-status--danger" : "case-status"}>
            {urgent ? <AlertTriangle aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
            {statusCopy[repair.status]}
          </div>
        </header>

        <div className="case-columns">
          <MessagesPanel repair={repair} busy={busy} onSend={onSendTenantMessage} />
          <ProposalPanel
            repair={repair}
            busy={busy}
            onApprove={onApprove}
            onBook={onBook}
            onRequestExternalOptions={onRequestExternalOptions}
            onFocusAgentNote={() => setNoteFocusToken((value) => value + 1)}
          />
        </div>
      </div>

      <ActivityRail
        repair={repair}
        busy={busy}
        noteFocusToken={noteFocusToken}
        onSendNote={onSendManagerNote}
      />
    </main>
  );
}
