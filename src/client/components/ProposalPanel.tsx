import { CalendarDays, Check, ReceiptText, Wrench } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { RepairCase } from "../../shared/types";
import { formatTimeWindow } from "../time";

interface ProposalPanelProps {
  repair: RepairCase;
  busy?: string;
  onApprove: () => Promise<void>;
  onBook: () => Promise<void>;
  onRequestExternalOptions: (requiredBy: string) => Promise<void>;
  onFocusAgentNote: () => void;
}

const money = (pence: number, currency: "GBP" | "USD") =>
  new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(
    pence / 100,
  );

export const bookingStatus = (repair: RepairCase) => {
  const proposal = repair.proposal;
  const matchesProposal = (fact: { proposalId: string; timeWindow: string } | undefined) =>
    Boolean(proposal && fact?.proposalId === proposal.id && fact.timeWindow === proposal.timeWindow);
  const managerApproved = matchesProposal(repair.approval);
  const tenantAuthorized = matchesProposal(repair.tenantAccessAuthorization);
  const contractorConfirmed = matchesProposal(repair.contractorConfirmation);
  const notification = repair.notifications?.find(({ id }) => id === repair.appointment?.notificationId);

  return {
    managerApproved,
    tenantAuthorized,
    contractorConfirmed,
    notification,
    action:
      repair.status === "scheduled"
        ? notification
          ? ("complete" as const)
          : ("retry" as const)
        : !managerApproved
          ? ("approve" as const)
          : tenantAuthorized && contractorConfirmed
            ? ("book" as const)
            : ("wait" as const),
  };
};

export function ProposalPanel({
  repair,
  busy,
  onApprove,
  onBook,
  onRequestExternalOptions,
  onFocusAgentNote,
}: ProposalPanelProps) {
  const [requiredBy, setRequiredBy] = useState("");
  const proposal = repair.proposal;
  const timeZone = repair.demoFixture?.organization.timeZone;

  if (!proposal) {
    const requestOptions = async (event: FormEvent) => {
      event.preventDefault();
      if (!requiredBy) return;
      await onRequestExternalOptions(new Date(requiredBy).toISOString());
    };

    return (
      <section className="proposal-panel" aria-labelledby="proposal-heading">
        <h2 id="proposal-heading">Proposed repair</h2>
        <div className="empty-proposal">
          <Wrench aria-hidden="true" />
          <h3>No contractor proposed yet</h3>
          <p>The agent will check this building's approved contractors first.</p>
        </div>
        <button className="button button--secondary" type="button" onClick={onFocusAgentNote}>
          Ask the agent about the next contractor
        </button>
        {repair.externalSearchRequest ? (
          <div className="external-requested" role="status">
            <strong>External options requested</strong>
            <span>The agent may search outside the approved roster for this routine repair.</span>
          </div>
        ) : repair.severity === "routine" ? (
          <form className="external-request-form" onSubmit={requestOptions}>
            <label htmlFor="external-required-by">Need external options by</label>
            <input
              id="external-required-by"
              type="datetime-local"
              value={requiredBy}
              onInput={(event) => setRequiredBy(event.currentTarget.value)}
              required
            />
            <button
              className="button button--secondary"
              type="submit"
              disabled={!requiredBy || busy === "external-request"}
            >
              {busy === "external-request" ? "Requesting…" : "Request external options"}
            </button>
          </form>
        ) : null}
      </section>
    );
  }

  const isScheduled = repair.status === "scheduled";
  const { action, managerApproved, tenantAuthorized, contractorConfirmed, notification } =
    bookingStatus(repair);

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
        <span className={`proposal-source proposal-source--${proposal.source}`}>
          {proposal.source === "agreement" ? (
            <Check aria-hidden="true" />
          ) : (
            <ReceiptText aria-hidden="true" />
          )}
          {proposal.source === "agreement" ? "Approved agreement" : "External quote"}
        </span>
        <p>
          <CalendarDays aria-hidden="true" />
          {formatTimeWindow(proposal.timeWindow, timeZone)}
        </p>
        <p>
          <ReceiptText aria-hidden="true" />
          {money(proposal.costPence, proposal.currency)} · {proposal.priceBasis}
        </p>
        <p className="proposal-reason">{proposal.reason}</p>
      </div>

      {!isScheduled ? (
        <div className="booking-gates">
          <h3>Booking checks</h3>
          <ul>
            <li>{managerApproved ? "✓" : "○"} Manager approved contractor and price</li>
            <li>{tenantAuthorized ? "✓" : "○"} Tenant authorized this visit window</li>
            <li>{contractorConfirmed ? "✓" : "○"} Contractor confirmed this visit window</li>
          </ul>
        </div>
      ) : null}

      {isScheduled ? (
        <>
          <div className="booking-confirmed" role="status">
            <Check aria-hidden="true" />
            <span>
              <strong>Visit booked</strong>
              {repair.appointment
                ? formatTimeWindow(repair.appointment.timeWindow, timeZone)
                : null}
              <small>{notification ? "Tenant notification recorded" : "Tenant notification pending"}</small>
            </span>
          </div>
          {action === "retry" ? (
            <button
              className="button button--primary"
              type="button"
              onClick={onBook}
              disabled={busy === "book-visit"}
            >
              {busy === "book-visit" ? "Retrying…" : "Retry tenant notification"}
            </button>
          ) : null}
        </>
      ) : (
        <div className="proposal-actions">
          <button
            className="button button--primary"
            type="button"
            onClick={managerApproved ? onBook : onApprove}
            disabled={busy === "approve-proposal" || busy === "book-visit" || action === "wait"}
          >
            {busy === "approve-proposal"
              ? "Approving…"
              : busy === "book-visit"
                ? "Booking…"
                : managerApproved
                  ? "Book confirmed visit"
                  : "Approve contractor and price"}
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
            ? notification
              ? `A tenant notification for ${repair.tenant.name} is recorded.`
              : "The visit is booked; the tenant notification is pending retry."
            : !managerApproved
              ? "Approve the current contractor and price. Access and contractor confirmation remain separate checks."
              : !tenantAuthorized
                ? "Waiting for tenant access authorization for this visit window."
                : !contractorConfirmed
                  ? "Waiting for the contractor to confirm this visit window."
                  : "All three checks match. The confirmed visit can now be booked."}
        </p>
      </div>
    </section>
  );
}
