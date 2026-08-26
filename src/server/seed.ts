import type { AppStore } from "../shared/types.js";

const createdAt = "2026-08-26T11:42:00.000Z";

export const seedStore: AppStore = {
  cases: [
    {
      id: "repair-1001",
      buildingId: "18-hawthorn-court",
      title: "Water leaking through bathroom ceiling",
      summary:
        "Maya reported water dripping near the bathroom light. She has turned off the bathroom light and can let a contractor in after 3:00 pm.",
      severity: "urgent",
      status: "waiting_for_approval",
      tenant: {
        name: "Maya",
        unit: "Flat 3B",
        phone: "+447700900123",
      },
      accessNotes: "Tenant can provide access after 3:00 pm.",
      createdAt,
      updatedAt: "2026-08-26T11:52:00.000Z",
      messages: [
        {
          id: "message-1001",
          party: "tenant",
          body: "Hi, there’s water dripping from the ceiling near the bathroom light.",
          sentAt: createdAt,
          channel: "sms",
        },
        {
          id: "message-1002",
          party: "agent",
          body: "Thanks Maya. Is the bathroom light working, and is the water pooling anywhere on the floor?",
          sentAt: "2026-08-26T11:43:00.000Z",
          channel: "sms",
        },
        {
          id: "message-1003",
          party: "tenant",
          body: "I turned the light off at the switch. No pooling, just dripping.",
          sentAt: "2026-08-26T11:44:00.000Z",
          channel: "sms",
        },
        {
          id: "message-1004",
          party: "agent",
          body: "Thanks. Are you able to let a contractor in after 3:00 pm today?",
          sentAt: "2026-08-26T11:44:30.000Z",
          channel: "sms",
        },
        {
          id: "message-1005",
          party: "tenant",
          body: "Yes, after 3:00 pm is perfect.",
          sentAt: "2026-08-26T11:45:00.000Z",
          channel: "sms",
        },
      ],
      activity: [
        {
          id: "activity-1001",
          label: "Maya reported the leak",
          actor: "tenant",
          occurredAt: createdAt,
        },
        {
          id: "activity-1002",
          label: "Agent asked two safety questions",
          actor: "agent",
          occurredAt: "2026-08-26T11:43:00.000Z",
        },
        {
          id: "activity-1003",
          label: "Maya confirmed access after 3:00 pm",
          actor: "tenant",
          occurredAt: "2026-08-26T11:45:00.000Z",
        },
        {
          id: "activity-1004",
          label: "ClearFlow Plumbing offered a time",
          actor: "contractor",
          occurredAt: "2026-08-26T11:52:00.000Z",
        },
        {
          id: "activity-1005",
          label: "Waiting for your approval",
          actor: "system",
          occurredAt: "2026-08-26T11:52:00.000Z",
        },
      ],
      proposal: {
        id: "proposal-1001",
        contractorName: "ClearFlow Plumbing",
        contractorPhone: "020 7946 0123",
        timeWindow: "Today, 3:30–4:30 pm",
        costPence: 16500,
        currency: "GBP",
        reason: "Available today and rated for emergency plumbing work.",
        status: "proposed",
      },
    },
  ],
  outbox: [],
};
