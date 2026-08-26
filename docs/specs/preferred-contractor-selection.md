# Preferred contractor selection

Status: Accepted

Date: 2026-08-26

## Product rule

The agent starts with the building's approved contractor agreements. External contractor search is an auditable exception, not the normal proposal route.

## Confirmed test seams

- The contractor-selection module's public interface is the domain test seam.
- The HTTP repair workflow is the integration test seam.
- WebMCP is a thin adapter over those interfaces and is verified by type-checking and browser registration checks rather than implementation-coupled unit tests.

## Requirements

1. Agreements are scoped by building and trade and ordered by priority.
2. An agreement records contractor identity, covered work, price basis, coverage hours, response commitment, and effective dates.
3. The first eligible approved contractor is the default selection.
4. Preferred proposals take contractor identity and price from the stored agreement; callers cannot substitute them.
5. Recording unavailability stores the contractor, reason, timestamp, and earliest availability, then advances to the next eligible agreement.
6. Routine repairs cannot start external search unless the property manager explicitly requests it.
7. Urgent and emergency repairs can start external search only after every eligible approved contractor is recorded unable to meet the required response time.
8. Starting external search records the reason and returns a search brief; it does not create a proposal, approve cost, or book a visit.
9. External proposals are rejected until external search has been authorized for that repair.
10. Preferred and external proposals both retain the existing manager approval and booking gate.
11. The dashboard shows whether a proposal uses an agreement or an external quote, including the price basis.
12. Activity history explains contractor unavailability and why external fallback began.

Eligibility means the agreement matches the building, trade, covered severity, effective dates, and current coverage window, and its response commitment can meet the requested deadline. For routine fallback, the search deadline is the one stored with the manager's request; an agent-supplied replacement is ignored.

## Out of scope

- A marketplace or search-provider integration
- Automatically approving an external contractor
- Automatically booking under a pre-authorized spend threshold
- Contract lifecycle management or invoicing
