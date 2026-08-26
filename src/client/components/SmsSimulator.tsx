import { X } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { InboundSmsInput } from "../../shared/types";

interface SmsSimulatorProps {
  open: boolean;
  onClose: () => void;
  onSend: (input: InboundSmsInput) => Promise<void>;
}

export function SmsSimulator({ open, onClose, onSend }: SmsSimulatorProps) {
  const [tenantName, setTenantName] = useState("Jordan");
  const [unit, setUnit] = useState("Flat 5A");
  const [from, setFrom] = useState("+447700900999");
  const [body, setBody] = useState("The kitchen tap will not stop running.");
  const [sending, setSending] = useState(false);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    try {
      await onSend({ tenantName, unit, from, body });
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="sms-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sms-simulator-heading"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="sms-simulator-heading">Test an incoming text</h2>
            <p>This sends a Twilio-shaped message through the real SMS webhook.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </header>
        <form onSubmit={submit}>
          <label>
            Tenant name
            <input value={tenantName} onChange={(event) => setTenantName(event.target.value)} required />
          </label>
          <label>
            Flat or unit
            <input value={unit} onChange={(event) => setUnit(event.target.value)} required />
          </label>
          <label>
            Phone number
            <input value={from} onChange={(event) => setFrom(event.target.value)} required />
          </label>
          <label>
            Text message
            <textarea value={body} onChange={(event) => setBody(event.target.value)} required />
          </label>
          <button className="button button--primary" type="submit" disabled={sending}>
            {sending ? "Sending…" : "Send incoming text"}
          </button>
        </form>
      </section>
    </div>
  );
}
