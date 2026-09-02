import {
  Bot,
  Camera,
  Check,
  Clock3,
  Eye,
  MessageSquare,
  PhoneCall,
  ShieldCheck,
} from "lucide-react";
import { useRef } from "react";
import type { RepairCase } from "../../shared/types";
import { formatTime, formatTimeWindow } from "../time";

interface ManagerControlPlaneProps {
  repair: RepairCase;
  busy?: string;
  onApproveCall: () => Promise<void>;
  onReconcileEffect: (
    effectKey: string,
    resolution: "absent" | "accepted",
    providerId?: string,
    providerStatus?: NonNullable<RepairCase["voiceCall"]>["transportStatus"],
  ) => Promise<void>;
}

export const formatMoney = (pence: number, currency: "GBP" | "USD") =>
  new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: pence % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(pence / 100);

export const tenantConfirmationStatus = (repair: RepairCase) => {
  const effect = repair.repairAgent?.effects.find(
    (item) => item.type === "tenant_sms" && item.purpose === "booking_confirmation",
  );
  if (repair.appointment?.notificationId || effect?.status === "succeeded") {
    return "Provider accepted";
  }
  if (effect?.status === "unknown") return "Unknown";
  if (effect?.status === "failed") return "Failed";
  return effect && ["planned", "dispatching", "retryable"].includes(effect.status)
    ? "Pending"
    : "Not sent";
};

export function ManagerControlPlane({
  repair,
  busy,
  onApproveCall,
  onReconcileEffect,
}: ManagerControlPlaneProps) {
  const photoDialog = useRef<HTMLDialogElement>(null);
  const evidence = repair.photoEvidence?.find(({ status }) => status === "available");
  const proposal = repair.proposal;
  const access = repair.tenantAccessAuthorization;
  const approval = repair.callApproval;
  const manualTask = repair.manualContactTasks?.find(({ status }) => status === "open");
  const appointment = repair.appointment;
  const unknownCall = repair.repairAgent?.effects.find(
    (effect) => effect.type === "contractor_call" && effect.status === "unknown",
  );
  const unresolvedText = repair.repairAgent?.effects.find(
    (effect) =>
      effect.type === "tenant_sms" &&
      ["planned", "dispatching", "retryable", "unknown", "failed"].includes(effect.status),
  );
  const reconcilableText =
    unresolvedText && ["retryable", "unknown", "failed"].includes(unresolvedText.status)
      ? unresolvedText
      : undefined;
  const ready = Boolean(
    !approval &&
      !appointment &&
      !manualTask &&
      !unknownCall &&
      !unresolvedText &&
      (evidence || repair.severity === "emergency") &&
      repair.repairAgent?.phase === "waiting_for_manager" &&
      proposal?.source === "agreement" &&
      proposal.agreementId &&
      access?.proposalId === proposal.id &&
      repair.repairAgent,
  );
  const evidenceUrl = evidence
    ? `/api/cases/${encodeURIComponent(repair.id)}/evidence/${encodeURIComponent(evidence.id)}`
    : undefined;
  const messages = repair.messages.filter(({ party }) => party !== "manager").slice(-4);
  const activity = repair.activity.slice(-6);

  return (
    <main className="decision-desk">
      <header className="decision-desk__heading">
        <div>
          <span className="decision-desk__eyebrow">Manager control plane</span>
          <h2>{repair.title}</h2>
          <p>
            {repair.tenant.name}, {repair.tenant.unit} · {repair.summary}
          </p>
        </div>
        <div className="decision-desk__live" role="status">
          <Clock3 aria-hidden="true" />
          <span>
            <strong>Shared case is live</strong>
            Checks for SMS and voice updates every 3 seconds
          </span>
        </div>
      </header>

      <section className="decision-panel decision-handoff" aria-labelledby="decision-handoff-title">
        <Bot aria-hidden="true" />
        <div>
          <span className="decision-desk__eyebrow">Prepared through WebMCP</span>
          <h3 id="decision-handoff-title">
            {appointment
              ? "The visit is booked"
              : unknownCall
                ? "Verify the uncertain provider result"
                : unresolvedText
                  ? "Resolve the tenant text before approving a call"
                : manualTask
                ? "Manual contractor follow-up is required"
                : ready
                  ? "One contractor action is ready"
                  : approval
                    ? "The approved contractor call is in progress"
                    : "The agent is preparing one contractor action"}
          </h3>
          <p>
            WebMCP can inspect the safe case and prepare the stored-agreement action. It cannot
            approve a call or expand its authority.
          </p>
        </div>
        <time dateTime={repair.updatedAt}>Case updated {formatTime(repair.updatedAt)}</time>
      </section>

      <div className="decision-desk__grid">
        <div className="decision-desk__column">
          <section className="decision-panel decision-evidence" aria-labelledby="decision-evidence-title">
            <div className="decision-panel__heading">
              <div>
                <span className="decision-desk__eyebrow">Accepted evidence</span>
                <h3 id="decision-evidence-title">Tenant photo</h3>
              </div>
              <span className="decision-safe-label">
                <ShieldCheck aria-hidden="true" /> Manager only
              </span>
            </div>
            {evidence && evidenceUrl ? (
              <>
                <button
                  className="decision-photo"
                  type="button"
                  onClick={() => photoDialog.current?.showModal()}
                >
                  <img src={evidenceUrl} alt="Tenant-supplied photo evidence for this repair" />
                  <span>
                    <Eye aria-hidden="true" /> Open full view
                  </span>
                </button>
                <dl className="decision-facts decision-facts--compact">
                  <div>
                    <dt>Status</dt>
                    <dd>Accepted</dd>
                  </div>
                  <div>
                    <dt>Type</dt>
                    <dd>{evidence.contentType?.replace("image/", "").toUpperCase()}</dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>{Math.ceil((evidence.byteLength ?? 0) / 1024)} KB</dd>
                  </div>
                </dl>
              </>
            ) : (
              <div className="decision-empty">
                <Camera aria-hidden="true" />
                <p>No accepted tenant photo is available yet.</p>
              </div>
            )}
          </section>

          <section className="decision-panel" aria-labelledby="decision-conversation-title">
            <div className="decision-panel__heading">
              <div>
                <span className="decision-desk__eyebrow">Same repair case</span>
                <h3 id="decision-conversation-title">Tenant conversation</h3>
              </div>
              <MessageSquare aria-hidden="true" />
            </div>
            <div className="decision-messages" aria-live="polite">
              {messages.map((message) => (
                <article key={message.id} className={`decision-message decision-message--${message.party}`}>
                  <strong>{message.party === "tenant" ? repair.tenant.name : "Fix This agent"}</strong>
                  <p>{message.body}</p>
                  <time dateTime={message.sentAt}>{formatTime(message.sentAt)}</time>
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="decision-desk__column">
          <section
            className={`decision-panel decision-approval${approval ? " decision-approval--done" : ""}`}
            aria-labelledby="decision-approval-title"
          >
            <span className="decision-desk__eyebrow">Human-only decision</span>
            <h3 id="decision-approval-title">
              {approval?.revokedAt
                ? "Call authority revoked"
                : approval
                  ? "One contractor call approved"
                  : "Review the exact call authority"}
            </h3>
            {proposal ? (
              <dl className="decision-facts">
                <div>
                  <dt>Contractor</dt>
                  <dd>{proposal.contractorName}</dd>
                </div>
                <div>
                  <dt>Stored price</dt>
                  <dd>{formatMoney(proposal.costPence, proposal.currency)} · {proposal.priceBasis}</dd>
                </div>
                <div>
                  <dt>Manager timing band</dt>
                  <dd>{formatTimeWindow(proposal.timeWindow)}</dd>
                </div>
                <div>
                  <dt>Tenant timing band</dt>
                  <dd>{access ? formatTimeWindow(access.timeWindow) : "Not recorded yet"}</dd>
                </div>
                <div>
                  <dt>Permission</dt>
                  <dd>One disclosed AI call</dd>
                </div>
              </dl>
            ) : (
              <p className="decision-muted">Waiting for WebMCP to prepare the stored agreement.</p>
            )}
            <button
              className="decision-approve-button"
              type="button"
              onClick={onApproveCall}
              disabled={!ready || Boolean(approval) || busy === "approve-call"}
            >
              {approval ? <Check aria-hidden="true" /> : <PhoneCall aria-hidden="true" />}
              {approval?.revokedAt
                ? "Approval revoked"
                : approval
                  ? "Approval recorded"
                : busy === "approve-call"
                  ? "Recording approval…"
                  : "Approve this one call"}
            </button>
            {unknownCall ? (
              <>
                <button
                  className="decision-approve-button"
                  type="button"
                  onClick={() => onReconcileEffect(unknownCall.effectKey, "absent")}
                  disabled={busy === "reconcile-effect"}
                >
                  <ShieldCheck aria-hidden="true" />
                  {busy === "reconcile-effect"
                    ? "Recording provider check…"
                    : approval?.revokedAt
                      ? "I verified no call was created — close"
                      : "I verified no call was created — retry"}
                </button>
                <button
                  className="decision-approve-button"
                  type="button"
                  onClick={() => {
                    const providerId = window.prompt("Enter the provider CallSid for the created call:");
                    const providerStatus = window.prompt(
                      "Enter its current Twilio status: queued, initiated, ringing, in-progress, completed, busy, failed, no-answer, or canceled:",
                    );
                    if (providerId && providerStatus) {
                      void onReconcileEffect(
                        unknownCall.effectKey,
                        "accepted",
                        providerId.trim(),
                        providerStatus.trim() as NonNullable<RepairCase["voiceCall"]>["transportStatus"],
                      );
                    }
                  }}
                  disabled={busy === "reconcile-effect"}
                >
                  <PhoneCall aria-hidden="true" />
                  I found the created call — record it
                </button>
              </>
            ) : null}
            {reconcilableText ? (
              <>
                {reconcilableText.status === "unknown" ? (
                  <button
                    className="decision-approve-button"
                    type="button"
                    onClick={() => onReconcileEffect(reconcilableText.effectKey, "accepted")}
                    disabled={busy === "reconcile-effect"}
                  >
                    <Check aria-hidden="true" />
                    Provider shows tenant text accepted
                  </button>
                ) : null}
                <button
                  className="decision-approve-button"
                  type="button"
                  onClick={() => onReconcileEffect(reconcilableText.effectKey, "absent")}
                  disabled={busy === "reconcile-effect"}
                >
                  <ShieldCheck aria-hidden="true" />
                  Provider shows no tenant text — retry
                </button>
              </>
            ) : null}
            <p className="decision-boundary">
              {approval
                ? approval.revokedAt
                  ? "The accepted or uncertain call cannot book or be repeated. Continue through manual follow-up."
                  : "A changed contractor, price, case revision, or timing bound revokes booking authority."
                : "Only this manager control can authorize the call. WebMCP cannot press it."}
            </p>
          </section>

          <section className="decision-panel" aria-labelledby="decision-outcome-title">
            <span className="decision-desk__eyebrow">Contractor outcome</span>
            <h3 id="decision-outcome-title">
              {appointment
                ? "Visit booked automatically"
                : manualTask
                  ? "Manager action needed"
                  : repair.voiceCall?.openAiConnected
                    ? "Consented call connected"
                    : approval
                      ? "Waiting for the contractor"
                      : "No call approved yet"}
            </h3>
            <dl className="decision-facts decision-facts--compact">
              <div>
                <dt>Voice outcome</dt>
                <dd>{repair.voiceCall?.outcome?.replaceAll("_", " ") ?? "Pending"}</dd>
              </div>
              <div>
                <dt>Final visit slot</dt>
                <dd>{appointment ? formatTimeWindow(appointment.timeWindow) : "Not booked"}</dd>
              </div>
              <div>
                <dt>Tenant confirmation</dt>
                <dd>{tenantConfirmationStatus(repair)}</dd>
              </div>
            </dl>
            {manualTask ? <p className="decision-boundary">{manualTask.reason}</p> : null}
          </section>

          <section className="decision-panel decision-audit" aria-labelledby="decision-audit-title">
            <div className="decision-panel__heading">
              <div>
                <span className="decision-desk__eyebrow">Live audit trail</span>
                <h3 id="decision-audit-title">What changed</h3>
              </div>
              <span>{repair.activity.length} events</span>
            </div>
            <ol>
              {activity.map((event) => (
                <li key={event.id}>
                  <Check aria-hidden="true" />
                  <div>
                    <strong>{event.label}</strong>
                    <span>{event.actor === "agent" ? "Fix This agent" : event.actor}</span>
                    {event.detail ? <p>{event.detail}</p> : null}
                  </div>
                  <time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {evidenceUrl ? (
        <dialog
          ref={photoDialog}
          className="decision-photo-dialog"
          aria-label="Tenant photo evidence"
        >
          <form method="dialog">
            <button type="submit">Close</button>
          </form>
          <img src={evidenceUrl} alt="Full tenant-supplied photo evidence for this repair" />
          <p>Private case evidence · manager authenticated</p>
        </dialog>
      ) : null}
    </main>
  );
}
