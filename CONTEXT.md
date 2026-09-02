# Domain context

## Repair case

The shared source of truth for one tenant-reported maintenance problem. It contains the original texts, triage, access information, contractor proposal, manager approval, appointment, and audit trail.

## Tenant

The resident reporting the problem. The tenant participates only by SMS and does not need a web account.

## Repair agent

The always-on service that receives tenant texts, gathers permitted information, updates the repair case, and coordinates contractor booking within explicit human-control boundaries. WebMCP lets a browser agent inspect and direct this same workflow; it is not the only way the repair agent runs.

## Property manager

The staff capability that reviews repair records, receives agent updates, approves cost, and directs the repair agent. A staff user may hold this capability together with organization administration.

## Decision desk

The accepted information hierarchy for the authenticated property-manager dashboard: the prepared contractor action and human decision come first, with photo evidence, tenant conversation, and audit history beside them. It is the manager control plane for a repair case, not a separate source of truth.

## Organization administrator

The staff capability that manages buildings, staff access, contractor agreements, and organization policy. It is a permission set, not a requirement for a separate person from the property manager.

## Staff user

An invited, multi-factor-authenticated member of a property management organization who holds property-manager capabilities, organization-administrator capabilities, or both.

## Tenant directory

The organization's verified mapping of trusted tenant phone numbers to buildings and units. A trusted number routes a report but does not prove who authored each message; an unknown number remains quarantined until staff or a safe intake process resolves it.

## Property management organization

The invited company operating one or more buildings through one or more staff users. Repair cases, buildings, agreements, and staff access belong to exactly one organization.

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

A request sent to the next eligible preferred contractor after the required human approvals exist. It becomes an appointment only when that contractor confirms the offered time.

## Contractor contact route

The ordered means of contacting a preferred contractor: SMS first when supported, a consent-gated and AI-disclosed voice call through an approved telephony path when SMS is unsupported, and documented manual intervention when automation cannot confirm the booking.

## Voice calling consent

The contractor's recorded enrollment permission for operational AI/artificial-voice calls plus the affirmative per-call keypad consent required before audio reaches the AI, transcription, or recording. A trusted phone number is not consent.

## Voice transcript

The post-consent text record of an AI contractor call. Raw audio is not retained by default; withdrawal ends processing, deletes the call transcript, and preserves only the consent-withdrawal audit event.

## Voice call outcome

The auditable result of a contractor call: confirmed, declined, requested change, consent declined, no consent response, unreachable, failed, or needs manual follow-up. A transport-level completed call is not a confirmed appointment.

## Manual contact task

The dashboard task and manager SMS alert created when automated contractor contact cannot lawfully or reliably continue. It records the reason and requires an authenticated staff user to record the eventual outcome.

## Voice agent authority

The terms a consented voice agent may discuss or accept. For an approved contractor, authority is limited to the stored agreement price and manager-approved visit window. For an external contractor, authority is limited to the manager-recorded price ceiling and permitted timing band. Anything outside those bounds, ambiguity, or an unenrolled contractor requires manager review or manual contact.

## Contractor confirmation evidence

The source proving that the current contractor accepted the current proposal and visit window. It is either a matching contractor message or a consented voice-call outcome bound to the approved call; transport completion alone is not confirmation.

## Agent wake event

A verified, deduplicated inbound message or property-manager decision that schedules one serialized repair-agent run for a repair case. The event selects the case; the model never chooses phone numbers or creates its own authority.

## WebMCP

The browser producer API used by the page to expose typed, contextual actions to a browser agent. WebMCP is the dashboard action surface; it is not the persistence layer or the SMS transport.

## Local outbox

The development fallback for outbound SMS. It records exactly what would have been sent without transmitting it to a real phone number.

## Pilot-ready release

A release verified as safe for a small, invite-only United States property-management pilot. It does not imply that a pilot has started, or that the product supports general availability, self-service onboarding, or billing.

## Demo mode

An isolated Devpost-facing mode containing a fully configured synthetic Pennsylvania organization, buildings, staff, contractor agreements, policies, and repair cases. It provides controlled reset and simulation paths, cannot read production data or use production messaging credentials, and never sends a real message or call.

## Controlled live demo

A separate, protected, time-bounded deployment that accepts verified messages only from the allowlisted tenant phone, sends through the configured Twilio number, and may call only the allowlisted contractor phone after call approval. It uses real provider credentials and an always-on worker during the demo window, but it is not a public demo or a pilot-ready release.

## Manager notification

An agent-generated SMS update that replaces the tenant's need to separately chase property management. It summarizes a repair event or requested decision and directs consequential actions to the authenticated dashboard.

## Photo evidence

Tenant-supplied MMS images attached to a repair case for diagnosis and contractor coordination. They can corroborate a report or expose inconsistencies, but they do not by themselves verify identity or prove that a report is genuine.

## Photo sharing authorization

The tenant's service-level permission for relevant repair photos to be shared with the assigned contractor. It is recorded during messaging enrollment, can be withdrawn, and never turns a photo into proof of identity or authority.

## Messaging consent

The recorded permission for the repair service to exchange operational SMS and MMS with a tenant or contractor. Opt-out stops non-emergency automated messaging and creates a manual-contact task for property management.

## Organization readiness

The state reached after an organization has configured its jurisdiction, emergency contacts, safety messages, privacy and retention policy, required notices, staff access, buildings, and contractor agreements, with unresolved legal assumptions recorded. This is a technical readiness gate, not legal certification. Real tenant messaging is disabled until this gate passes.

## Pilot readiness evidence

The retained staging proof that authentication, tenant and contractor messaging, approvals, access authorization, emergency handling, organization isolation, recovery, provider failure, and incident response work without enrolling real tenants.

## Emergency escalation

The safety path for a report of immediate danger, such as fire, gas odor, carbon monoxide, or sparking electricity. It directs the tenant to the appropriate US emergency service, alerts property management, preserves the record, and does not represent the repair agent as emergency dispatch.
