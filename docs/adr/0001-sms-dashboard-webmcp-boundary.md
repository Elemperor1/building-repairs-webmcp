# ADR 0001: Keep SMS, dashboard, and WebMCP as separate product boundaries

Status: Accepted

Date: 2026-08-26

## Context

Tenants need a low-friction way to report repairs, property managers need human control over cost and access, and the hackathon requires a meaningful WebMCP surface. Making every participant use the same web interface would add tenant friction and make WebMCP decorative rather than operational.

## Decision

- SMS is the tenant channel and outbound notification transport.
- The repair case is the shared persistent record.
- The web dashboard is the property manager’s review and approval surface.
- WebMCP exposes the dashboard’s real repair actions to a browser agent.
- Manager cost approval is not exposed as an agent tool.
- Booking is rejected by the server until a proposal and explicit approval exist.

## Consequences

The tenant never needs a web account. The property manager can see every message and automated action in one place. The WebMCP demonstration changes real shared state instead of navigating a scripted demo.

A connected WebMCP-capable browser session is currently required for browser-agent action. Background orchestration, identity, Twilio signature verification, production storage, and authentication remain separate production-readiness work.
