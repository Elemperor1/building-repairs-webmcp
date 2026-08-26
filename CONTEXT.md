# Domain context

## Repair case

The shared source of truth for one tenant-reported maintenance problem. It contains the original texts, triage, access information, contractor proposal, manager approval, appointment, and audit trail.

## Tenant

The resident reporting the problem. The tenant participates only by SMS and does not need a web account.

## Repair agent

The browser agent that uses the dashboard’s WebMCP tools to read a repair, ask the tenant focused questions, record triage, and prepare or book an approved contractor visit.

## Property manager

The dashboard user. The property manager reviews the shared record, approves cost, and can give the repair agent instructions. Approval is the human-control boundary.

## Contractor proposal

A named contractor, phone number, price, time window, and reason prepared for manager review. A proposal is not a booking.

## Approval

An explicit property-manager decision recorded with actor and time. The server rejects booking when approval is absent.

## Appointment

The contractor and confirmed time created after approval. Successful booking also creates an outbound tenant confirmation.

## WebMCP

The browser producer API used by the page to expose typed, contextual actions to a browser agent. WebMCP is the dashboard action surface; it is not the persistence layer or the SMS transport.

## Local outbox

The development fallback for outbound SMS. It records exactly what would have been sent without transmitting it to a real phone number.
