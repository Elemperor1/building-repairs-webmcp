import { CalendarDays, Check, ReceiptText, Wrench } from "lucide-react";
import type { RepairCase } from "../../shared/types";

interface ProposalPanelProps {
  repair: RepairCase;
  busy?: string;
  onApproveAndBook: () => Promise<void>;
  onFocusAgentNote: () => void;
}

const money = (pence: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(
    pence / 100,
  );

export function ProposalPanel({ repair, busy, onApproveAndBook, onFocusAgentNote }: ProposalPanelProps) {
  const proposal = repair.proposal;

  if (!proposal) {
    return (
      <section className="proposal-panel" aria-labelledby="proposal-heading">
        <h2 id="proposal-heading">Proposed repair</h2>
        <div className="empty-proposal">
          <Wrench aria-hidden="true" />
          <h3>No contractor proposed yet</h3>
          <p>The agent can gather options and add a proposal here for approval.</p>
        </div>
        <button className="button button--secondary" type="button" onClick={onFocusAgentNote}>
          Ask the agent for options
        </button>
      </section>
    );
  }

  const isScheduled = repair.status === "scheduled";
  const isApproved = repair.status === "approved";

  return (
    <section className="proposal-panel" aria-labelledby="proposal-heading">
      <h2 id="proposal-heading">Proposed repair</h2>
      <div className="proposal-details">
        <div className="proposal-contractor">
          <span className="proposal-icon" aria-hidden="true">
            <Wrench />
          </span>
          <strong>{proposal.contractorName}</strong>
        </div>
        <p>
          <CalendarDays aria-hidden="true" />
          {proposal.timeWindow}
        </p>
        <p>
          <ReceiptText aria-hidden="true" />
          {money(proposal.costPence)} call-out and first hour
        </p>
        <p className="proposal-reason">{proposal.reason}</p>
      </div>

      {isScheduled ? (
        <div className="booking-confirmed" role="status">
          <Check aria-hidden="true" />
          <span>
            <strong>Visit booked</strong>
            {repair.appointment?.timeWindow}
          </span>
        </div>
      ) : (
        <div className="proposal-actions">
          <button
            className="button button--primary"
            type="button"
            onClick={onApproveAndBook}
            disabled={busy === "approve-book"}
          >
            {busy === "approve-book" ? "Booking…" : isApproved ? "Book approved visit" : "Approve and book"}
          </button>
          <button className="button button--secondary" type="button" onClick={onFocusAgentNote}>
            Ask the agent a question
          </button>
        </div>
      )}

      <div className="what-next">
        <h3>What happens next</h3>
        <p>
          {isScheduled
            ? `${repair.tenant.name} has been texted the confirmed time.`
            : "After approval, the agent will book the visit and text the tenant the confirmed time."}
        </p>
      </div>
    </section>
  );
}
