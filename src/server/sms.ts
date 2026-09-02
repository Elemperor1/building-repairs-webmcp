import { randomUUID } from "node:crypto";
import { isDemoMode } from "./demo.js";
import { repairStore } from "./store.js";

const twilioConfigured = () =>
  Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER,
  );

export class KnownTextDeliveryFailure extends Error {}

export const deliverText = async (to: string, body: string) => {
  if (isDemoMode()) {
    return { delivery: "demo_outbox" as const, providerId: `demo:${randomUUID()}` };
  }

  if (!twilioConfigured()) {
    return { delivery: "local_outbox" as const, providerId: `local:${randomUUID()}` };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID as string;
  const authToken = process.env.TWILIO_AUTH_TOKEN as string;
  const from = process.env.TWILIO_PHONE_NUMBER as string;
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    },
  );

  if (!response.ok) {
    const error = `Twilio rejected the message (${response.status}).`;
    if (response.status < 500) throw new KnownTextDeliveryFailure(error);
    throw new Error(error);
  }
  const result = (await response.json()) as { sid?: string };
  if (!result.sid) throw new Error("Twilio accepted the request without a message identifier.");
  return { delivery: "twilio" as const, providerId: result.sid };
};

export const sendText = async (to: string, body: string, caseId?: string) => {
  const existing = caseId ? repairStore.findOutbox(caseId, body) : undefined;
  if (existing) return { delivery: existing.delivery, message: existing };

  const { delivery } = await deliverText(to, body);
  const message = repairStore.addOutbox(to, body, delivery, caseId);
  return { delivery, message };
};
