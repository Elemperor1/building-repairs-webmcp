# Domain docs

## Before exploring

Read `CONTEXT.md` at the repository root and any relevant ADRs in `docs/adr/`. If those files do not exist yet, proceed silently; domain-modeling creates them when decisions are resolved.

## Layout

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Vocabulary

Use the terms defined in `CONTEXT.md` in issues, tests, implementation, and documentation. If a needed concept is missing, reconsider the wording or record the gap for domain modeling.

## ADR conflicts

If proposed work contradicts an ADR, surface the conflict explicitly instead of silently overriding the decision.
