import { Check, Clock3, Phone } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import type { RepairCase } from "../../shared/types";
import { formatTime, formatTimeWindow } from "../time";

interface ActivityRailProps {
  repair: RepairCase;
  busy?: string;
  noteFocusToken: number;
  onSendNote: (note: string) => Promise<void>;
}

export function ActivityRail({ repair, busy, noteFocusToken, onSendNote }: ActivityRailProps) {
  const [note, setNote] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastToken = useRef(noteFocusToken);
  const timeZone = repair.demoFixture?.organization.timeZone;

  if (lastToken.current !== noteFocusToken) {
    lastToken.current = noteFocusToken;
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = note.trim();
    if (!body) return;
    await onSendNote(body);
    setNote("");
  };

  return (
    <aside className="activity-rail" aria-label="Repair updates and notes">
      <section className="rail-section activity-section">
        <h2>Updates</h2>
        <ol className="activity-list">
          {repair.activity.map((event, index) => {
            const waiting = event.label.toLowerCase().includes("waiting");
            return (
              <li key={event.id} className={waiting ? "activity-item activity-item--waiting" : "activity-item"}>
                <span className="activity-marker" aria-hidden="true">
                  {waiting ? <Clock3 /> : <Check />}
                </span>
                <div>
                  <strong>{event.label}</strong>
                  {event.detail ? <span>{formatTimeWindow(event.detail, timeZone)}</span> : null}
                </div>
                <time dateTime={event.occurredAt}>{formatTime(event.occurredAt, timeZone)}</time>
                {index < repair.activity.length - 1 ? <span className="activity-line" aria-hidden="true" /> : null}
              </li>
            );
          })}
        </ol>
      </section>

      {repair.proposal ? (
        <section className="rail-section contractor-section">
          <h2>Contractor</h2>
          <div className="contractor-row">
            <Phone aria-hidden="true" />
            <div>
              <strong>{repair.proposal.contractorName}</strong>
              <span>{repair.proposal.contractorPhone}</span>
            </div>
            <span className={`quote-status quote-status--${repair.proposal.source}`}>
              {repair.proposal.source === "agreement" ? (
                <Check aria-hidden="true" />
              ) : (
                <Clock3 aria-hidden="true" />
              )}
              {repair.proposal.source === "agreement" ? "Contract rate" : "Outside quote"}
            </span>
          </div>
        </section>
      ) : null}

      <section className="rail-section agent-note-section">
        <h2>Note to Fix This</h2>
        <p>Share extra context or ask us to try another contractor.</p>
        <form onSubmit={submit}>
          <label className="sr-only" htmlFor="agent-note">
            Note to Fix This
          </label>
          <textarea
            ref={inputRef}
            id="agent-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Write a note…"
            disabled={busy === "manager-note"}
          />
          <button
            className="button button--primary"
            type="submit"
            disabled={!note.trim() || busy === "manager-note"}
          >
            {busy === "manager-note" ? "Sending…" : "Send note"}
          </button>
        </form>
      </section>
    </aside>
  );
}
