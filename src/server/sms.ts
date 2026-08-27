import { isDemoMode } from "./demo.js";
import { repairStore } from "./store.js";

const twilioConfigured = () =>
  Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER,
  );

export const sendText = async (to: string, body: string, caseId?: string) => {
  const existing = caseId ? repairStore.findOutbox(caseId, body) : undefined;
  if (existing) return { delivery: existing.delivery, message: existing };

  if (isDemoMode()) {
    const message = repairStore.addOutbox(to, body, "demo_outbox", caseId);
    return { delivery: "demo_outbox" as const, message };
  }

  if (!twilioConfigured()) {
    const message = repairStore.addOutbox(to, body, "local_outbox", caseId);
    return { delivery: "local_outbox" as const, message };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID as string;
  const authToken = process.env.TWILIO_AUTH_TOKEN as string;
  const from = process.env.TWILIO_PHONE_NUMBER as string;
  const payload = new URLSearchParams({ To: to, From: from, Body: body });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload,
    },
  );

  if (!response.ok) {
    throw new Error(`Twilio rejected the message (${response.status}).`);
  }

  const message = repairStore.addOutbox(to, body, "twilio", caseId);
  return { delivery: "twilio" as const, message };
};
