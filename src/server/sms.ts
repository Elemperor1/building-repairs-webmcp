import { repairStore } from "./store.js";

const twilioConfigured = () =>
  Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER,
  );

export const sendText = async (to: string, body: string) => {
  if (!twilioConfigured()) {
    repairStore.addOutbox(to, body, "local_outbox");
    return { delivery: "local_outbox" as const };
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

  repairStore.addOutbox(to, body, "twilio");
  return { delivery: "twilio" as const };
};
