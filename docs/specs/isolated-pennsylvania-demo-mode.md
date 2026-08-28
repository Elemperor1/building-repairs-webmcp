# Isolated Pennsylvania demo mode

Status: Accepted

Date: 2026-08-27

## Purpose

Provide one public, resettable, entirely synthetic Pennsylvania repair workflow for judges. It uses the real dashboard, store, workflow API, and WebMCP tools, but it cannot contact real people or read production data.

## Activation and access

- `DEMO_MODE=true` is the explicit deployment boundary.
- The judge URL has no application login. The dashboard opens as the preconfigured synthetic property manager, **Priya Shah (demo manager)**.
- Every page shows **Synthetic Pennsylvania demo — no real messages or calls**.
- The deployment runs one shared disposable demo store. Per-visitor stores are out of scope unless concurrent judging proves they are necessary.
- The UI reports WebMCP as connected, unavailable, or failed from the browser API result. It never presents a simulated connected state.

## Fixture manifest

All names, addresses, phone numbers, messages, and images below are synthetic and visibly labelled as such.

| Kind | Stable ID | Fixture |
| --- | --- | --- |
| Organization | `demo-pa-org` | **Fix This Demo Property Management**, jurisdiction `US-PA`, time zone `America/New_York` |
| Building | `demo-pa-building` | **Hawthorn Court Demo Apartments**, 100 Demo Way, Pittsburgh, PA 15222 |
| Staff | `demo-manager-priya` | **Priya Shah (demo manager)**, property-manager capability |
| Tenant | `demo-tenant-maya` | **Maya Chen (demo tenant)**, Unit 3B, `+1 412-555-0101` |
| Primary agreement | `demo-pa-plumbing-primary` | **Hawthorn Demo Building Services**, `+1 412-555-0110`, all-day coverage, urgent response within 60 minutes, fixed call-out and first hour **$145 USD** |
| Backup agreement | `demo-pa-plumbing-backup` | **Three Rivers Demo Plumbing**, `+1 412-555-0111`, all-day coverage, urgent response within 120 minutes, fixed call-out and first hour **$160 USD** |
| Repair | `demo-repair-leak` | New repair report: water dripping from the bathroom ceiling near the light |
| MMS asset | `demo-bathroom-leak` | Bundled synthetic bathroom-leak image; no upload, remote URL, or personal metadata |

The phone numbers use the reserved `555-01xx` fictional range. Currency shown to judges is USD and monetary amounts are stored as cents.

## Reset-relative state

Let `T0` be the server time when the judge resets the demo.

- The repair and its initial tenant SMS are created at `T0`.
- The urgent response deadline is `T0 + 6 hours`.
- Maya's authorized access window is `T0 + 2 hours` through `T0 + 6 hours`.
- The primary contractor's simulated earliest availability is `T0 + 24 hours`, so it cannot meet the deadline.
- The backup contractor's proposed and confirmed visit is `T0 + 3 hours` through `T0 + 4 hours`.
- Agreement effective dates and coverage are generated so both agreements are eligible at `T0`; the primary is tried before the backup.
- Stored timestamps are ISO 8601 instants. The dashboard formats them in `America/New_York` and does not use words such as “today” in persisted state.

Reset keeps the stable IDs above, replaces the demo store atomically, clears the simulated outbox and message state, and regenerates every time-relative value from the new `T0`.

## Safe message simulation

- Demo mode exposes one clearly labelled synthetic SMS/MMS simulator over the same inbound-message application path used by provider adapters.
- Senders are selected from the fixed tenant and contractor fixtures; the judge cannot enter an arbitrary phone number or recipient.
- The simulator accepts text and the bundled `demo-bathroom-leak` asset only. It does not fetch remote media or upload personal files.
- Outbound tenant and manager messages go only to an in-app demo outbox and are marked `demo_outbox`.
- Twilio-shaped public webhooks and every real SMS, MMS, or voice delivery path are disabled in demo mode, even if a credential is accidentally present.
- The public call allowlist is empty. The consent-gated voice prototype is not mounted in the public app and has no public call button. Completed controlled-call evidence may be linked read-only.

Startup must fail closed when `DEMO_MODE=true` and live messaging or voice credentials are present. This is defense in depth; the demo transport still never performs a provider network request.

## Golden repair journey

1. The judge resets the demo and sees the synthetic banner, the WebMCP status, and `demo-repair-leak` with Maya's initial text.
2. The browser agent lists and opens the real shared case, triages it as urgent plumbing, and sends a safety/access question to the demo outbox.
3. The judge uses the simulator as Maya to send the safety reply, the reset-relative access window, and the bundled MMS fixture.
4. The agent reads the contractor path, records the primary contractor's simulated unavailability, and receives the approved backup as the next eligible agreement.
5. The agent proposes the backup using the stored agreement identity and $160 price. The proposal remains unapproved.
6. The browser agent uses `record_tenant_access_authorization` to bind Maya's earlier access reply to that exact proposal and visit window.
7. Priya explicitly approves that contractor and price in the dashboard. Manager approval is not exposed as a WebMCP tool.
8. The judge uses the simulator as Three Rivers Demo Plumbing to confirm the exact proposed visit window; the agent uses `record_contractor_confirmation` to record that confirmation with the contractor message as evidence.
9. `book_approved_visit` succeeds only now. The appointment and demo-outbox notification become visible in the same case.

The judge prompt is:

> Coordinate the newest urgent repair. Use the building's approved contractors in order, keep the property manager in control of cost, and do not book until tenant access and contractor confirmation are recorded.

## Server-enforced booking contract

Booking requires all three independent facts to reference the current proposal and visit window:

1. property-manager approval of the contractor and price;
2. tenant access authorization for the visit window, backed by a tenant message; and
3. contractor confirmation of that visit window, backed by a contractor message.

Changing the proposal or visit window invalidates all three facts. Missing, stale, or mismatched evidence produces a clear conflict response and no appointment or outbound message.

## Judge-visible reset

- `POST /api/demo/reset` exists only in demo mode and is also available through a **Reset synthetic demo** button.
- Reset needs a confirmation because it replaces the shared synthetic state, but it needs no secret or account.
- The response includes `resetAt` and `caseId: "demo-repair-leak"` so the UI can reopen the golden case.
- `/api/dev/reset` is not exposed by the public deployment.

## Acceptance checks

- A clean reset produces only the fixture IDs above, USD values, reserved fictional phone numbers, and reset-relative timestamps.
- The simulator rejects arbitrary identities, remote media, and non-fixture recipients.
- Demo mode makes zero Twilio or voice-provider network calls and refuses to start with live provider credentials.
- Booking fails separately without manager approval, without matching tenant access authorization, and without matching contractor confirmation.
- Changing the proposal or visit window invalidates prior approval and confirmations.
- The complete golden journey succeeds twice after two separate resets.
- WebMCP mutations and dashboard actions update the same repair record and audit trail.
- WebMCP unavailability is shown truthfully and never replaced by a fake success state.

## Deferred

- Authentication, organization isolation beyond this disposable store, real provider webhooks, production storage, and pilot controls
- Per-visitor demo state, automated reset schedules, analytics, and abuse controls
- A live voice action in the public judge application
