import { Send } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { RepairCase } from "../../shared/types";
import { formatTime } from "../time";

interface MessagesPanelProps {
  repair: RepairCase;
  busy?: string;
  onSend: (message: string) => Promise<void>;
}

export function MessagesPanel({ repair, busy, onSend }: MessagesPanelProps) {
  const [message, setMessage] = useState("");
  const visibleMessages = repair.messages.filter((item) => item.party !== "manager");
  const timeZone = repair.demoFixture?.organization.timeZone;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = message.trim();
    if (!body) return;
    await onSend(body);
    setMessage("");
  };

  return (
    <section className="messages-panel" aria-labelledby="messages-heading">
      <h2 id="messages-heading">Conversation</h2>
      <div className="message-thread" aria-live="polite">
        {visibleMessages.map((item) => (
          <div
            key={item.id}
            className={`message message--${item.party}`}
          >
            <span className="message__sender">
              {item.party === "tenant"
                ? repair.tenant.name
                : item.party === "contractor"
                  ? "Contractor"
                  : "Fix This"}
            </span>
            <p>{item.body}</p>
            {item.mediaId === "demo-bathroom-leak" ? (
              <figure className="message-media">
                <img
                  src="/demo-bathroom-leak.svg"
                  alt="Demo illustration of water leaking near a bathroom light"
                />
                <figcaption>Demo photo</figcaption>
              </figure>
            ) : null}
            <time dateTime={item.sentAt}>{formatTime(item.sentAt, timeZone)}</time>
          </div>
        ))}
      </div>
      <form className="message-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="tenant-message">
          Send {repair.tenant.name} a message
        </label>
        <input
          id="tenant-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={`Send ${repair.tenant.name} a message`}
          disabled={busy === "tenant-message"}
        />
        <button
          className="send-button"
          type="submit"
          aria-label={`Send message to ${repair.tenant.name}`}
          disabled={!message.trim() || busy === "tenant-message"}
        >
          <Send aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}
