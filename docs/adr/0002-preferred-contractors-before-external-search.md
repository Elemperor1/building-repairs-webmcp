# ADR 0002: Prefer building agreements before external contractor search

Status: Accepted

Date: 2026-08-26

## Context

Building managers often have established contractors, fixed pricing, coverage terms, and response commitments. Searching the market for every repair would ignore those agreements, add cost uncertainty, and weaken trust in the agent.

## Decision

One contractor-selection module owns agreement eligibility, priority ordering, attempts, and external-search authorization. Its interface returns the next approved agreement or an explicit fallback decision. The repair store persists the result; HTTP and WebMCP remain adapters at the module's seam.

External search is allowed only after eligible agreements are exhausted for an urgent or emergency repair, or after explicit manager instruction for a routine repair. External search produces a brief and audit entry, never an approval or booking.

## Consequences

Policy remains local and testable through one interface. Preferred proposals cannot drift from stored agreement terms. External fallback is explainable and server-enforced. A future search provider can consume the authorized search brief without changing the selection rules.
