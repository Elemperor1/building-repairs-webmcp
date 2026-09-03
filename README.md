# Fix This

**Repairs without the runaround.**

Tenants text Fix This when something breaks. Fix This gathers the details, lines up the right contractor, and gives the property manager a clear plan to approve.

Nothing is booked until the tenant confirms access and the contractor accepts the time.

![Fix This dashboard showing a repair waiting for manager approval](docs/design/dashboard-implementation.png)

## What works

- tenant repair reports by text, through either Twilio or the built-in test path
- one repair record for every message, decision, proposed visit, and appointment
- local JSON storage with atomic writes
- real Twilio outbound delivery when credentials are present, with a local outbox fallback for development
- preferred contractors checked in order, using the building's agreed prices
- server-enforced checks for manager approval, tenant access, and contractor confirmation
- a responsive property-manager dashboard with a development-only text-message simulator
- WebMCP tools that let a browser agent work with the same repairs shown in the dashboard

WebMCP can prepare the visit, but it cannot approve spending. That decision stays with the property manager.

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm ci
npm run dev
```

The dashboard is served by Vite (normally `http://localhost:5173`) and the API runs at `http://localhost:8787`. If the Vite port is occupied, use the alternate URL printed in the terminal.

Useful checks:

```bash
npm test
npm run build
```

Start the isolated judge demo with provider credentials unset:

```bash
DEMO_MODE=true npm run dev
```

Demo mode uses separate sample data and never contacts a real phone. It includes fictional Pennsylvania tenants, buildings, and contractors, and keeps outgoing messages in an in-app outbox. You can reset it from the dashboard. The app refuses to start the demo when live Twilio, OpenAI voice, or voice-destination settings are present.

Without Twilio credentials, outbound texts are recorded at `GET /api/outbox`. Use “Test an incoming text” in the development dashboard to exercise the same webhook path a phone provider uses.

## Connect Twilio

Use this only in a controlled local test setup. Do not expose the current app with live provider credentials or real tenant data.

Copy `.env.example` values into your runtime environment:

```text
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
```

Configure the Twilio number’s incoming-message webhook as:

```text
POST https://YOUR_HOST/api/sms/inbound
```

The endpoint accepts Twilio’s `application/x-www-form-urlencoded` payload and returns an empty TwiML response. Signature verification, dashboard authentication, encrypted production storage, rate limiting, and a non-development outbox policy must be added before handling real tenant data.

## WebMCP surface

The dashboard registers these tools when the browser exposes the WebMCP producer API:

- `list_open_repairs`
- `get_repair_case`
- `get_contractor_path`
- `triage_repair`
- `send_tenant_message`
- `propose_preferred_contractor_visit`
- `record_preferred_contractor_unavailable`
- `start_external_contractor_search`
- `propose_external_contractor_visit`
- `record_tenant_access_authorization`
- `record_contractor_confirmation`
- `book_approved_visit`

Fix This checks a building's preferred contractors in order and uses their agreed prices. The agent cannot skip the first eligible contractor or add an outside quote until the server allows an outside search.

The implementation feature-detects the current `document.modelContext` API and the deprecated `navigator.modelContext` compatibility surface. If neither is present, the dashboard reports that WebMCP is unavailable. It never shows a fake connection or ships a production polyfill.

In this build, browser-agent actions require an open, WebMCP-enabled dashboard. Automatic background handling for every new tenant text is not part of this build.

## Architecture

```text
tenant SMS ──> /api/sms/inbound ──> repair store ──> manager dashboard
                                         ▲                 │
                                         │                 │ WebMCP tools
                                         └── workflow API <┘
                                                │
                                                └──> Twilio or local outbox
```

- `src/server`: webhook, workflow API, persistence, and SMS delivery
- `src/server/contractor-selection.ts`: agreement priority, attempts, and external-search policy behind one domain interface
- `src/client`: React dashboard and WebMCP registration
- `src/shared`: repair-domain types
- `PRODUCT.md`: product boundaries
- `DESIGN.md`: Impeccable design system and UI guardrails
- `docs/adr`: architectural decisions

## Safety invariant

Booking is a server-side state transition, not a UI convention. The current proposal and visit window need matching property-manager approval, tenant access authorization, and contractor confirmation before `book` succeeds. Tests cover the blocked and successful paths.
