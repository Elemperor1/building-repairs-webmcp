# Contractor selection policy research

Date: 2026-08-26

## Scope and interpretation

This note informs product behaviour; it is **not legal advice** and the cited
public-procurement sources do not themselves govern private rental managers.
They are useful primary-source models for expressing agreed scope, price,
availability, measurable response requirements, and exceptional emergency
procurement with an auditable rationale.

## Source-backed findings

1. An approved/prequalified repair pool can be defined before an incident. New
   York City's current Emergency Repair Program solicitation uses prequalified
   lists for residential/commercial repair and maintenance, includes required
   licensing/certification, and permits vendors to opt into 24-hour emergency
   service. New Jersey's facilities-maintenance award explicitly defines one
   primary plus two ordered backups by region for maintenance and emergency
   repairs.
   [NYC Emergency Repair Program notice](https://a856-cityrecord.nyc.gov/RequestDetail/20250728024)
   [New Jersey T2192 Notice of Award](https://www.nj.gov/treasury/purchase/noa/attachments/t2192-noa.pdf)

2. A service agreement can be operational rather than a supplier name alone.
   The Federal Acquisition Regulation (FAR) says performance-based service
   contracts include a performance work statement plus measurable standards
   for quality, timeliness, and quantity, and a way to assess performance.
   Its work-statement guidance calls out the scope, period and place of
   performance, required results, and operating constraints.
   [FAR 37.601--37.603](https://www.acquisition.gov/far/part-37)

3. A maintenance agreement can state the contracted price, normal coverage
   period, on-call rates, when the response clock begins, and the response
   deadline. A published acquisition maintenance clause provides each of
   these as explicit terms, and also records the notification/arrival times,
   work performed, parts, and additional charges in the completion report.
   [Maintenance clause example](https://www.acquisition.gov/reg-change-notice/96-252)

4. A maintenance agreement can also state 24/7 availability, immediate
   telephone acknowledgement, on-site response target, emergency contacts, and
   a fallback mitigation if repair cannot be completed. Delaware's generator
   maintenance RFP requires those elements, including an on-site target of four
   hours or less and alternative power where the emergency repair cannot be
   completed.
   [Delaware DOT generator maintenance RFP](https://bidcondocs.delaware.gov/DOT/DOT_1213GenerMaint_RFP.pdf)

5. Urgency is an exception that needs a bounded, documented reason; it is not
   a standing reason to bypass the usual supplier workflow. FEMA's official
   emergency-procurement guidance requires written justification even where
   emergency/exigency permits noncompetitive procurement. It also identifies
   procurement-method rationale, contractor selection or rejection, and the
   basis for price as records to retain.
   [FEMA emergency/exigency fact sheet](https://www.fema.gov/sites/default/files/2020-07/fema_exigent-emergency-procurment-PA-fact-sheet_1-18-2018.pdf)
   [FEMA procurement compliance roadmap](https://www.fema.gov/sites/default/files/documents/fema_roadmap_procurement_compliance_checklist.pdf)

6. An emergency does not remove the need for cost control. FEMA states that
   fair-and-reasonable cost/price analysis and selection of a responsible
   contractor still apply under its emergency exception. It limits
   time-and-material arrangements to cases with no suitable alternative,
   requires a ceiling price, and calls for high oversight. Its current grants
   guide advises moving from emergency time-and-material work to a detailed,
   competitively awarded or firm-fixed-price arrangement once the emergency
   ends.
   [FEMA emergency/exigency fact sheet](https://www.fema.gov/sites/default/files/2020-07/fema_exigent-emergency-procurment-PA-fact-sheet_1-18-2018.pdf)
   [FEMA Procurement Under Grants Policy Guide (FY 2025)](https://www.fema.gov/sites/default/files/documents/fena_gpd_procurement-under-grants-policy-guide_fiscal-year-2025.pdf)

7. Chrome documents WebMCP tools as named, schema-constrained actions
   registered through `document.modelContext.registerTool`. The imperative API
   supports a state-changing `execute` handler and cancellation signal. Chrome
   security guidance says a tool that returns externally sourced content
   should be marked with `untrustedContentHint`; write-capable tools should be
   available only to trusted cross-origin consumers. WebMCP remains under
   active discussion, so feature detection and a small tool interface remain
   appropriate.
   [Chrome Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
   [Chrome WebMCP best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices)
   [Chrome WebMCP tool security](https://developer.chrome.com/docs/ai/webmcp/secure-tools)

## Product policy derived from the findings

### Default selection order

For a triaged repair, select only from the building's approved agreement roster
for the required trade, in ascending `priority` order. The roster entry should
contain the agreement's scope, fixed price or schedule/call-out rate, coverage
hours, promised response window, effective dates, and any pre-authorised spend
limit. This makes the selection decision explainable from the agreement rather
than from an ad-hoc market search.

Try the primary contractor, then the configured backup(s), only while each can
meet the applicable availability and response commitment. Record every failed
attempt with the contractor, timestamp, stated/observed availability, and the
reason it could not meet the repair's required response time.

### External search is a guarded exception

Do not register or invoke external search as the normal proposal route. Permit
it only when either:

- the repair is classified urgent/emergency **and** every eligible approved
  contractor was recorded unavailable or unable to meet the required response
  window; or
- a property manager has explicitly requested external options for a
  non-urgent repair.

The external-search command must require a repair identifier, urgency level,
required-by time, and (for emergency fallback) the recorded unavailability
attempts. The server, not the browser tool description, must validate the
guard. It should produce proposals for review, never a booking. Search results
are externally sourced material and should be returned/labelled as untrusted;
the manager's existing cost-approval and booking gate still applies.

### Audit and approval rules

Add an activity entry that explains the path, for example: "Primary plumber
unavailable until 09:00; backup cannot meet a two-hour response; external
search started for active leak." Persist the price basis (fixed agreement rate,
approved rate schedule, or external quote), selected/rejected contractors,
and the manager approval decision. A pre-authorised spend limit may allow an
approved contractor's booking when the stored agreement rate is within the
limit; it must not authorise an external contractor.

## Implementation consequences

Keep this policy behind one server-side contractor-selection module with a
small interface: given a repair and its urgency/required-by constraint, return
an approved selection, an auditable list of unavailable contractors, or an
explicit external-search eligibility result. This keeps priority ordering,
agreement eligibility, and emergency gating local rather than duplicating them
between the dashboard and WebMCP handlers.

The WebMCP surface can then remain narrow: expose a read-only roster/selection
inspection action, an action that records contractor unavailability, and a
state-changing `search_external_contractors` action only when the server says
the case is eligible. Neither the tool's JSON schema nor client-side checks are
an authorisation boundary.
