import { createHmac, timingSafeEqual } from "node:crypto";

export const isControlledLiveMode = (env: NodeJS.ProcessEnv = process.env) =>
  env.CONTROLLED_LIVE_MODE === "true";

const required = (env: NodeJS.ProcessEnv, name: string) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`CONTROLLED_LIVE_MODE requires ${name}.`);
  return value;
};

const positiveInteger = (env: NodeJS.ProcessEnv, name: string) => {
  const value = Number(required(env, name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`CONTROLLED_LIVE_MODE requires a positive integer ${name}.`);
  }
  return value;
};

export const controlledLiveConfig = (env: NodeJS.ProcessEnv = process.env) => {
  const config = {
    publicBaseUrl: required(env, "PUBLIC_BASE_URL"),
    accountSid: required(env, "TWILIO_ACCOUNT_SID"),
    authToken: required(env, "TWILIO_AUTH_TOKEN"),
    servicePhone: required(env, "TWILIO_PHONE_NUMBER"),
    tenantPhone: required(env, "CONTROLLED_LIVE_TENANT_PHONE"),
    contractorPhone: required(env, "CONTROLLED_LIVE_CONTRACTOR_PHONE"),
    managerPassword: required(env, "CONTROLLED_LIVE_MANAGER_PASSWORD"),
    agreementPriceCents: positiveInteger(env, "CONTROLLED_LIVE_AGREEMENT_PRICE_CENTS"),
    openAiApiKey: required(env, "OPENAI_API_KEY"),
    openAiTextModel: required(env, "OPENAI_TEXT_MODEL"),
  };
  if (!config.publicBaseUrl.startsWith("https://")) {
    throw new Error("CONTROLLED_LIVE_MODE requires an HTTPS PUBLIC_BASE_URL.");
  }
  if (new Set([config.servicePhone, config.tenantPhone, config.contractorPhone]).size !== 3) {
    throw new Error("Controlled-live phone bindings must be distinct.");
  }
  if (config.managerPassword.length < 32) {
    throw new Error("CONTROLLED_LIVE_MANAGER_PASSWORD must be at least 32 characters.");
  }
  return config;
};

export const controlledLiveVoiceConfig = (env: NodeJS.ProcessEnv = process.env) => {
  const projectId = required(env, "OPENAI_PROJECT_ID");
  const webhookSecret = required(env, "OPENAI_WEBHOOK_SECRET");
  const enrollmentConsentAt = required(env, "CONTROLLED_LIVE_CONTRACTOR_VOICE_ENROLLED_AT");
  if (!projectId.startsWith("proj_")) {
    throw new Error("CONTROLLED_LIVE_MODE requires an OPENAI_PROJECT_ID beginning with proj_.");
  }
  const enrollmentAt = Date.parse(enrollmentConsentAt);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      enrollmentConsentAt,
    ) ||
    !Number.isFinite(enrollmentAt) ||
    enrollmentAt > Date.now()
  ) {
    throw new Error(
      "CONTROLLED_LIVE_CONTRACTOR_VOICE_ENROLLED_AT must be a past or current offset-bearing ISO 8601 timestamp.",
    );
  }
  return { ...controlledLiveConfig(env), projectId, webhookSecret, enrollmentConsentAt };
};

export const isControlledLiveManager = (
  authorization: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
) => {
  const expected = Buffer.from(
    `Basic ${Buffer.from(`manager:${controlledLiveConfig(env).managerPassword}`).toString("base64")}`,
  );
  const actual = Buffer.from(authorization ?? "");
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
};

export const providerKey = (providerId: string, env: NodeJS.ProcessEnv = process.env) =>
  createHmac("sha256", controlledLiveConfig(env).authToken)
    .update(providerId)
    .digest("hex");
