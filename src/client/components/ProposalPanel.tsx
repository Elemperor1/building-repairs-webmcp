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
        <h2 id="proposal-heading">Contractor and visit</h2>
        <div className="empty-proposal">
          <Wrench aria-hidden="true" />
          <h3>No contractor lined up yet</h3>
          <p>We'll check this building's approved contractors first.</p>
        </div>
        <button className="button button--secondary" type="button" onClick={onFocusAgentNote}>
          Ask about another contractor
        </button>
        {repair.externalSearchRequest ? (
          <div className="external-requested" role="status">
            <strong>Looking beyond your approved list</strong>
            <span>Fix This can now look for other contractors for this repair.</span>
          </div>
        ) : repair.severity === "routine" ? (
          <form className="external-request-form" onSubmit={requestOptions}>
            <label htmlFor="external-required-by">When do you need options?</label>
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
              {busy === "external-request" ? "Saving…" : "Ask Fix This to look elsewhere"}
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
      <h2 id="proposal-heading">Contractor and visit</h2>
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
          {proposal.source === "agreement" ? "Contract rate" : "Outside quote"}
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
          <h3>Before you book</h3>
          <ul>
            <li>
              {managerApproved ? "✓" : "○"}{" "}
              {managerApproved ? "You approved the contractor and price" : "Approve the contractor and price"}
            </li>
            <li>
              {tenantAuthorized ? "✓" : "○"} {repair.tenant.name}{" "}
              {tenantAuthorized ? "confirmed access" : "still needs to confirm access"}
            </li>
            <li>
              {contractorConfirmed ? "✓" : "○"} {proposal.contractorName}{" "}
              {contractorConfirmed ? "confirmed the time" : "still needs to confirm the time"}
            </li>
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
              <small>
                {notification
                  ? `Message queued for ${repair.tenant.name}`
                  : `Message to ${repair.tenant.name} still needs sending`}
              </small>
            </span>
          </div>
          {action === "retry" ? (
            <button
              className="button button--primary"
              type="button"
              onClick={onBook}
              disabled={busy === "book-visit"}
            >
              {busy === "book-visit" ? "Trying again…" : "Try sending the message again"}
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
                  ? "Book this visit"
                  : "Approve contractor and price"}
          </button>
          <button className="button button--secondary" type="button" onClick={onFocusAgentNote}>
            Ask a question
          </button>
        </div>
      )}

      <div className="what-next">
        <h3>What happens next</h3>
        <p>
          {isScheduled
            ? notification
              ? `The visit details for ${repair.tenant.name} are queued.`
              : `The visit is booked. The message to ${repair.tenant.name} still needs to be sent.`
            : !managerApproved
              ? `Approve the contractor and price. We won't book until ${repair.tenant.name} and ${proposal.contractorName} confirm the same time.`
              : !tenantAuthorized
                ? `Waiting for ${repair.tenant.name} to confirm access for this time.`
                : !contractorConfirmed
                  ? `Waiting for ${proposal.contractorName} to confirm the time.`
                  : "Everyone confirmed the same time. You can book the visit."}
        </p>
      </div>
    </section>
  );
}
