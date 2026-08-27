import { X } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { DemoMessageInput, InboundSmsInput } from "../../shared/types";

interface SmsSimulatorProps {
  open: boolean;
  onClose: () => void;
  onSend: (input: DemoMessageInput | InboundSmsInput) => Promise<void>;
  demoMode: boolean;
}

export function SmsSimulator({ open, onClose, onSend, demoMode }: SmsSimulatorProps) {
  const [sender, setSender] = useState<DemoMessageInput["sender"]>("tenant");
  const [includeMedia, setIncludeMedia] = useState(false);
  const [tenantName, setTenantName] = useState("Jordan");
  const [unit, setUnit] = useState("Flat 5A");
  const [from, setFrom] = useState("+447700900999");
  const [body, setBody] = useState("The light is off and there is no pooling.");
  const [sending, setSending] = useState(false);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    try {
      await onSend(
        demoMode
          ? { sender, body, ...(includeMedia ? { mediaId: "demo-bathroom-leak" as const } : {}) }
          : { tenantName, unit, from, body },
      );
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
            <h2 id="sms-simulator-heading">
              {demoMode ? "Simulate a synthetic message" : "Test an incoming text"}
            </h2>
            <p>
              {demoMode
                ? "Fixed demo identities update the real shared repair without contacting anyone."
                : "This sends a Twilio-shaped message through the real SMS webhook."}
            </p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </header>
        <form onSubmit={submit}>
          {demoMode ? (
            <>
              <label>
                Synthetic sender
                <select
                  name="demo-sender"
                  value={sender}
                  onChange={(event) => setSender(event.target.value as DemoMessageInput["sender"])}
                >
                  <option value="tenant">Maya Chen (demo tenant)</option>
                  <option value="contractor">Three Rivers Demo Plumbing</option>
                </select>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="demo-media"
                  checked={includeMedia}
                  onChange={(event) => setIncludeMedia(event.target.checked)}
                />
                Attach bundled synthetic bathroom-leak image
              </label>
            </>
          ) : (
            <>
              <label>
                Tenant name
                <input
                  name="tenant-name"
                  value={tenantName}
                  onChange={(event) => setTenantName(event.target.value)}
                  required
                />
              </label>
              <label>
                Flat or unit
                <input name="unit" value={unit} onChange={(event) => setUnit(event.target.value)} required />
              </label>
              <label>
                Phone number
                <input name="from" value={from} onChange={(event) => setFrom(event.target.value)} required />
              </label>
            </>
          )}
          <label>
            Text message
            <textarea
              name="message"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              required
            />
          </label>
          <button className="button button--primary" type="submit" disabled={sending}>
            {sending ? "Sending…" : demoMode ? "Add simulated message" : "Send incoming text"}
          </button>
        </form>
      </section>
    </div>
  );
}
