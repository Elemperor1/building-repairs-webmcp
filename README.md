# Fix This

**Repairs without the runaround.**

Fix This is an SMS-first rental-maintenance coordinator. Tenants report what is broken by text, a browser agent can triage the case and prepare a contractor visit through WebMCP, and the property manager approves the cost and booking from one dashboard.

![Fix This dashboard](docs/design/dashboard-implementation.png)

## What works

- inbound SMS webhook for JSON test messages and Twilio form payloads
- one persistent repair record containing messages, access, proposal, approval, appointment, and activity
- local JSON storage with atomic writes
- real Twilio outbound delivery when credentials are present, with a local outbox fallback for development
- opt-in controlled-live SMS/MMS wake loop with signed/allowlisted inbound messages, private photo validation, durable deduplication, bounded model output, and retry-safe outbound effects
- protected controlled-live Decision desk with manager-authenticated photo delivery, three-second shared-case refresh, and exact one-call approval
- consent-gated contractor voice calling with signed callbacks, fixed disclosure, Press 1 before OpenAI, structured outcomes, bounded automatic booking, and one retry-safe tenant confirmation
- manager approval gate enforced by the server before booking
- building-specific preferred contractor agreements with ordered backups and agreed prices
- auditable contractor-unavailability attempts and server-guarded external fallback
- responsive property-manager dashboard with a development-only SMS simulator
- WebMCP tools for listing, reading, triaging, messaging, proposing, and booking approved repairs

Manager approval is deliberately not a WebMCP tool. The browser agent can prepare a solution, but the human approves the cost in the dashboard before the booking tool can succeed.

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

Demo mode uses a separate disposable store, fixed synthetic Pennsylvania identities, an in-app outbox, and an empty voice-call allowlist. The dashboard can reset the shared fixture; startup fails if Twilio, OpenAI voice, or a voice destination is configured.

Without Twilio credentials, outbound texts are recorded at `GET /api/outbox`. Use “Test an incoming text” in the development dashboard to exercise the same webhook path a phone provider uses.

## Connect Twilio

Use this only in a controlled local test setup. Do not expose the current app with live provider credentials or real tenant data.

Copy `.env.example` values into your runtime environment:

```text
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
```

The controlled-live route additionally requires `CONTROLLED_LIVE_MODE=true`, an HTTPS `PUBLIC_BASE_URL`, exact tenant and contractor phone bindings, a random `CONTROLLED_LIVE_MANAGER_PASSWORD` of at least 32 characters, the stored `CONTROLLED_LIVE_AGREEMENT_PRICE_CENTS`, `CONTROLLED_LIVE_CONTRACTOR_VOICE_ENROLLED_AT`, and the OpenAI values shown in `.env.example`. The Basic-auth username is `manager`. It uses a separate store and acknowledges a verified inbound message before media download or model work. A non-emergency case stays with the tenant until at least one Twilio-hosted JPEG, PNG, or WebP photo (5 MB total per MMS) is privately downloaded and validated. The agent may ask further questions in the same case; only an explicit manager-review decision pauses the loop for the property manager. Emergency reports bypass the photo wait and receive the fixed safety escalation. STOP, START, and HELP are recorded without an application reply; STOP suppresses queued and later automated texts until START.

Configure the Twilio number’s incoming-message webhook as:

```text
POST https://YOUR_HOST/api/sms/inbound
```

The endpoint accepts Twilio’s `application/x-www-form-urlencoded` payload and returns an empty TwiML response. Controlled-live mode verifies Twilio signatures and exact account/sender/destination bindings. Media URLs must name the signed message in the bound Twilio account; the server fetches them with provider authentication, checks MIME type, size, and file signature, stores image bytes outside the case API, and sends them to the vision-capable Responses input. Configure the OpenAI project’s signed webhook as `POST https://YOUR_HOST/api/voice/openai/webhook`; outbound calls receive their Twilio voice and status callback URLs from the server.

The dashboard, case API, WebMCP-backed actions, and private evidence route share the manager-authenticated boundary. The case stores only aliases and masked/keyed provider identities, never raw call audio. Post-consent transcript text is deleted by the authenticated controlled reset or immediately on consent withdrawal; withdrawal remains persistent until the contractor is re-enrolled outside this app. Encrypted ongoing-service storage, rate limiting, protected deployment, and provider-retention configuration remain separate work.

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

The preferred route takes contractor identity and price from the stored agreement. An agent cannot skip the primary agreement, claim a manager requested fallback, or add an external quote before the server authorizes external search.

In controlled-live mode, WebMCP registers only `list_open_repairs`, `get_repair_case`, `get_contractor_path`, `propose_preferred_contractor_visit`, and `record_tenant_access_authorization`. The manager-only call-approval endpoint is deliberately absent from the tool surface.

The implementation feature-detects the current `document.modelContext` API and the deprecated `navigator.modelContext` compatibility surface. If neither is present, the dashboard says “Browser agent tools unavailable.” There is no fake connected state and no production polyfill.

The current product proves the shared case workflow and browser-agent action surface. The controlled-live background loop has local automated proof only, assumes one server worker, and resumes durable failed work on restart or a later wake; it is not deployed, live-message evidence, or pilot readiness.

## Architecture

```text
tenant SMS/MMS ──> /api/sms/inbound ──> repair store ──> manager dashboard
                                         ▲                 │
                                         │                 │ WebMCP tools
                                         └── workflow API <┘
manager approval ──> Twilio disclosure + DTMF ──> OpenAI outcome ──> booking + tenant SMS
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

Booking is a server-side state transition, not a UI convention. Non-emergency controlled-live triage cannot reach manager review without validated photo evidence. The synthetic route still needs exact matching approval, access, and contractor-message evidence. The controlled voice route books only a consented final slot wholly inside both the manager timing band and the bound tenant access window, then journals one tenant confirmation effect.
