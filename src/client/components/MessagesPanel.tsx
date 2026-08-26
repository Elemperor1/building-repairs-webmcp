import { Send } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { RepairCase } from "../../shared/types";

interface MessagesPanelProps {
  repair: RepairCase;
  busy?: string;
  onSend: (message: string) => Promise<void>;
}

const shortTime = (value: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));

export function MessagesPanel({ repair, busy, onSend }: MessagesPanelProps) {
  const [message, setMessage] = useState("");
  const tenantMessages = repair.messages.filter((item) => item.party !== "manager");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = message.trim();
    if (!body) return;
    await onSend(body);
    setMessage("");
  };

  return (
    <section className="messages-panel" aria-labelledby="messages-heading">
      <h2 id="messages-heading">Messages with {repair.tenant.name}</h2>
      <div className="message-thread" aria-live="polite">
        {tenantMessages.map((item) => (
          <div
            key={item.id}
            className={item.party === "tenant" ? "message message--tenant" : "message message--agent"}
          >
            <p>{item.body}</p>
            <time dateTime={item.sentAt}>
              {shortTime(item.sentAt)}
              {item.party === "agent" ? "  ✓✓" : ""}
            </time>
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
