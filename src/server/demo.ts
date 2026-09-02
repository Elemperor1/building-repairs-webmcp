import type { AppStore, ContractorAgreement } from "../shared/types.js";
import { controlledLiveVoiceConfig, isControlledLiveMode } from "./controlled-live.js";

export const DEMO_CASE_ID = "demo-repair-leak";

export const isDemoMode = (env: NodeJS.ProcessEnv = process.env) => env.DEMO_MODE === "true";

const forbiddenDemoEnvironment = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "VOICE_ALLOWED_TO",
  "VOICE_CONTROL_TOKEN",
  "VOICE_MANAGER_NUMBER",
  "OPENAI_API_KEY",
  "OPENAI_PROJECT_ID",
  "OPENAI_WEBHOOK_SECRET",
  "CONTROLLED_LIVE_TENANT_PHONE",
  "CONTROLLED_LIVE_CONTRACTOR_PHONE",
  "CONTROLLED_LIVE_CONTRACTOR_VOICE_ENROLLED_AT",
  "OPENAI_TEXT_MODEL",
] as const;

export const assertDemoSafety = (env: NodeJS.ProcessEnv = process.env) => {
  if (!isDemoMode(env)) return;
  const unsafe = isControlledLiveMode(env)
    ? "CONTROLLED_LIVE_MODE"
    : forbiddenDemoEnvironment.find((name) => env[name]?.trim());
  if (unsafe) throw new Error(`DEMO_MODE cannot start with ${unsafe} set.`);
};

export const assertRuntimeSafety = (env: NodeJS.ProcessEnv = process.env) => {
  assertDemoSafety(env);
  if (isControlledLiveMode(env)) controlledLiveVoiceConfig(env);
};

const addHours = (value: Date, hours: number) =>
  new Date(value.getTime() + hours * 60 * 60 * 1000).toISOString();

export const createDemoStore = (resetAt: Date): AppStore => {
  const createdAt = resetAt.toISOString();
  const effectiveFrom = addHours(resetAt, -24).slice(0, 10);
  const effectiveTo = addHours(resetAt, 24 * 365).slice(0, 10);
  const agreement = (
    id: string,
    contractorName: string,
    contractorPhone: string,
    priority: number,
    amountPence: number,
    urgentResponseMinutes: number,
  ): ContractorAgreement => ({
    id,
    buildingId: "demo-pa-building",
    trade: "plumbing",
    contractorName,
    contractorPhone,
    priority,
    coveredWork: "Synthetic plumbing call-out and first hour",
    coveredSeverities: ["routine", "urgent", "emergency"],
    pricing: {
      basis: "fixed",
      amountPence,
      currency: "USD",
      description: `Fixed demo call-out and first hour ($${amountPence / 100} USD)`,
    },
    coverageHours: {
      description: "Every day, all day",
      timeZone: "America/New_York",
      days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      startsAt: "00:00",
      endsAt: "23:59",
    },
    responseMinutes: { routine: 1440, urgent: urgentResponseMinutes, emergency: 30 },
    effectiveFrom,
    effectiveTo,
  });

  return {
    cases: [
      {
        id: DEMO_CASE_ID,
        buildingId: "demo-pa-building",
        title: "Water dripping near the bathroom light",
        summary: "Maya reported water dripping from the bathroom ceiling near the light.",
        severity: "urgent",
        trade: "plumbing",
        status: "new",
        tenant: {
          name: "Maya Chen (demo tenant)",
          unit: "Unit 3B",
          phone: "+14125550101",
        },
        accessNotes: `Proposed access window: ${addHours(resetAt, 2)} to ${addHours(resetAt, 6)}.`,
        requiredBy: addHours(resetAt, 6),
        createdAt,
        updatedAt: createdAt,
        messages: [
          {
            id: "demo-message-initial",
            party: "tenant",
            body: "Water is dripping from the bathroom ceiling near the light.",
            sentAt: createdAt,
            channel: "sms",
            from: "+14125550101",
          },
        ],
        activity: [
          {
            id: "demo-activity-initial",
            label: "Maya Chen (demo tenant) reported the leak",
            actor: "tenant",
            occurredAt: createdAt,
          },
        ],
        contractorAttempts: [],
        demoFixture: {
          organization: {
            id: "demo-pa-org",
            name: "Fix This Demo Property Management",
            jurisdiction: "US-PA",
            timeZone: "America/New_York",
          },
          building: {
            id: "demo-pa-building",
            name: "Hawthorn Court Demo Apartments",
            address: "100 Demo Way, Pittsburgh, PA 15222",
          },
          manager: { id: "demo-manager-priya", name: "Priya Shah (demo manager)" },
          tenantId: "demo-tenant-maya",
          mediaId: "demo-bathroom-leak",
          resetAt: createdAt,
          primaryAgreementId: "demo-pa-plumbing-primary",
          backupAgreementId: "demo-pa-plumbing-backup",
          accessWindow: `${addHours(resetAt, 2)}/${addHours(resetAt, 6)}`,
          primaryEarliestAvailableAt: addHours(resetAt, 24),
          backupVisitWindow: `${addHours(resetAt, 3)}/${addHours(resetAt, 4)}`,
        },
      },
    ],
    contractorAgreements: [
      agreement(
        "demo-pa-plumbing-primary",
        "Hawthorn Demo Building Services",
        "+14125550110",
        1,
        14500,
        60,
      ),
      agreement(
        "demo-pa-plumbing-backup",
        "Three Rivers Demo Plumbing",
        "+14125550111",
        2,
        16000,
        120,
      ),
    ],
    outbox: [],
  };
};
