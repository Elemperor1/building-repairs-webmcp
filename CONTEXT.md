# Domain context

## Repair case

The shared source of truth for one tenant-reported maintenance problem. It contains the original texts, triage, access information, contractor proposal, manager approval, appointment, and audit trail.

## Tenant

The resident reporting the problem. The tenant participates only by SMS and does not need a web account.

## Repair agent

Fix This receives tenant texts, asks permitted follow-up questions, updates the repair, and coordinates the contractor visit within the manager's rules. In this repository, a browser agent performs those actions through WebMCP while an enabled dashboard is open. The controlled live demo adds the separate worker defined below.

## Property manager

A staff role that reviews repairs, receives updates, approves costs, and gives Fix This instructions. The same person may also be an organization administrator.

## Organization administrator

A staff role that manages buildings, staff access, contractor agreements, and organization policy. It may belong to the same person as the property-manager role.

## Staff user

An invited, multi-factor-authenticated member of a property management organization who holds property-manager capabilities, organization-administrator capabilities, or both.

## Demo operator

The single authenticated person controlling a controlled live demo. A demo operator is not a staff user and does not imply pilot-ready identity or access management.

## Tenant directory

The organization's verified mapping of trusted tenant phone numbers to buildings and units. A trusted number routes a report but does not prove who authored each message; an unknown number remains quarantined until staff or a safe intake process resolves it.

## Phone binding

A secret-configured association between a fixed communication role and its provider address. The full address is neither repair-case data nor operator-visible identity, and the binding does not authenticate the human using that phone.

## Property management organization

A company that uses Fix This to manage one or more buildings. Its repairs, buildings, contractor agreements, and staff access belong to that organization alone.

## Contractor proposal

A named contractor, phone number, price, time window, and reason prepared for manager review. A proposal is not a booking.

## Contractor agreement

A building-specific agreement with an approved contractor for a particular trade. It records priority, covered work, agreed pricing, coverage hours, and response commitments. The agreement—not an ad-hoc market search—is the default source for a contractor proposal.

## Contractor attempt

An auditable record that an approved contractor could not meet a repair's required response time. Attempts are ordered and must exhaust eligible agreements before urgent external fallback is allowed.

## External contractor fallback

An exception path used after every eligible approved contractor is recorded unavailable for an urgent or emergency repair, or after explicit property-manager instruction for a routine repair. Starting fallback does not approve a quote or book a visit.

## Approval

An explicit property-manager decision recorded with actor and time. The server rejects booking when approval is absent.

## Call approval

An explicit property-manager decision authorizing one outbound call to the named, allowlisted contractor under the current proposal's price and timing authority. It does not authorize different terms or create an appointment.

## Appointment

The contractor-confirmed visit time created only after manager approval and tenant access authorization. An offered or requested time is not an appointment.

## Access authorization

The tenant's explicit confirmation of an access window and permission for the contractor to enter. Booking is rejected when access authorization is absent or no longer matches the proposed visit.

## Booking request

A request sent to the next eligible preferred contractor after the property manager approves the contractor and price. It becomes an appointment only when the tenant confirms access and the contractor accepts the offered time.

## Contractor contact route

The ordered means of contacting a preferred contractor: SMS first when supported, a consent-gated and AI-disclosed voice call through an approved telephony path when SMS is unsupported, and documented manual intervention when automation cannot confirm the booking.

## Voice calling consent

The contractor's recorded enrollment permission for operational AI/artificial-voice calls plus the affirmative per-call keypad consent required before audio reaches the AI, transcription, or recording. A per-call refusal applies to that call; withdrawal revokes enrollment for future calls.

## Voice transcript

The post-consent text record of an AI contractor call, retained only until withdrawal, controlled live reset, or the live-demo retention ceiling. Raw audio is never retained.

## Voice call outcome

The auditable result of a contractor call: confirmed, declined, requested change, consent declined, no consent response, unreachable, failed, or needs manual follow-up. A transport-level completed call is not a confirmed appointment.

## Manual contact task

The dashboard task created when automated contractor contact cannot lawfully or reliably continue. It records the reason and requires an authenticated operator to record the eventual outcome; organization policy may add an alert outside the controlled live demo.

## Voice agent authority

The terms a consented voice agent may discuss or accept. For an approved contractor, authority is limited to the stored agreement price and manager-approved visit window. For an external contractor, authority is limited to the manager-recorded price ceiling and permitted timing band. Anything outside those bounds, ambiguity, or an unenrolled contractor requires manager review or manual contact.

## Contractor confirmation evidence

The source proving that the current contractor accepted the current proposal and visit window. It is either a matching contractor message or a structured consented voice-call outcome bound to the approved call; transport completion alone is not confirmation, and the transcript need not survive once the outcome is recorded.

## Agent wake event

A verified, deduplicated inbound message or property-manager decision that schedules one serialized repair-agent run for a repair case. The event selects the case; the model never chooses phone numbers or creates its own authority.

## WebMCP

The browser producer API used by the page to expose typed, contextual actions to a browser agent. WebMCP is the dashboard action surface; it is not the persistence layer or the SMS transport.

## Local outbox

The development fallback for outbound SMS. It records exactly what would have been sent without transmitting it to a real phone number.

## Pilot-ready release

A release verified as safe for a small, invite-only United States property-management pilot. It does not imply that a pilot has started, or that the product supports general availability, self-service onboarding, or billing.

## Demo mode

An isolated mode for Devpost judges, preloaded with a fictional Pennsylvania organization, buildings, staff, contractor agreements, policies, and repairs. It can be reset at any time. It cannot read production data, load production messaging credentials, or contact a real person.

## Controlled live demo

A separate, protected deployment that runs for a limited time under one demo operator. It uses real provider credentials, an always-on worker, and exactly three phone bindings: tenant, messaging service, and contractor. Manager updates stay in the dashboard. This is neither a public demo nor a pilot-ready release.

## Controlled live reset

The demo-operator action that deletes controlled-live case content and starts a fresh journey only when no call, job, or outbound effect is active. It preserves phone bindings, opt-out and withdrawal state, and content-free replay protection until the deployment is destroyed.

## Manager notification

An update from Fix This shown to the property manager in the dashboard. Outside the controlled live demo, organization policy may also send it by SMS.

## Photo evidence

Tenant-supplied MMS images attached to a repair case for diagnosis and contractor coordination. They can corroborate a report or expose inconsistencies, but they do not by themselves verify identity or prove that a report is genuine.

## Photo sharing authorization

The tenant's service-level permission for relevant repair photos to be shared with the assigned contractor. It is recorded during messaging enrollment, can be withdrawn, and never turns a photo into proof of identity or authority.

## Messaging consent

The recorded permission for the repair service to exchange operational SMS and MMS with a tenant or contractor. Opt-out survives demo reset, stops non-emergency automated messaging, and can be cleared only by a verified opt-in from that phone binding.

## Organization readiness

The state reached after an organization has configured its jurisdiction, emergency contacts, safety messages, privacy and retention policy, required notices, staff access, buildings, and contractor agreements, with unresolved legal assumptions recorded. This is a technical readiness gate, not legal certification. Real tenant messaging is disabled until this gate passes.

## Pilot readiness evidence

The retained staging proof that authentication, tenant and contractor messaging, approvals, access authorization, emergency handling, organization isolation, recovery, provider failure, and incident response work without enrolling real tenants.

## Emergency escalation

The safety path for a report of immediate danger, such as fire, gas odor, carbon monoxide, or sparking electricity. It directs the tenant to the appropriate US emergency service, alerts property management, preserves the record, and does not represent the repair agent as emergency dispatch.
