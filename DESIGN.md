---
name: Fix This
description: Repairs without the runaround.
colors:
  background: "oklch(0.985 0 0)"
  surface: "oklch(1 0 0)"
  surface-subtle: "oklch(0.97 0.006 150)"
  ink: "oklch(0.21 0.018 150)"
  muted: "oklch(0.43 0.018 150)"
  faint: "oklch(0.57 0.012 150)"
  border: "oklch(0.88 0.01 150)"
  border-strong: "oklch(0.75 0.025 150)"
  dispatch-green: "oklch(0.4 0.106 150)"
  dispatch-green-hover: "oklch(0.35 0.106 150)"
  dispatch-green-pale: "oklch(0.94 0.035 150)"
  dispatch-green-soft: "oklch(0.9 0.045 150)"
  attention: "oklch(0.67 0.13 78)"
  attention-pale: "oklch(0.97 0.035 78)"
  danger: "oklch(0.52 0.18 30)"
  danger-pale: "oklch(0.96 0.03 30)"
  approval-ink: "oklch(0.37 0.08 70)"
typography:
  headline:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.82rem"
    fontWeight: 760
    lineHeight: 1.12
    letterSpacing: "-0.028em"
  title:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1rem"
    fontWeight: 740
    lineHeight: 1.25
    letterSpacing: "-0.008em"
  body:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.98rem"
    fontWeight: 400
    lineHeight: 1.62
  label:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.82rem"
    fontWeight: 680
    lineHeight: 1.35
  app-title:
    fontSize: "1.35rem"
  empty-title:
    fontSize: "1.4rem"
  sheet-title:
    fontSize: "1.3rem"
  mobile-headline:
    fontSize: "1.55rem"
  mobile-app-title:
    fontSize: "1.08rem"
  metadata-large:
    fontSize: "0.93rem"
  queue-title:
    fontSize: "0.91rem"
  action:
    fontSize: "0.9rem"
  message:
    fontSize: "0.88rem"
  status:
    fontSize: "0.86rem"
  compact-action:
    fontSize: "0.85rem"
  section-label:
    fontSize: "0.84rem"
  queue-meta:
    fontSize: "0.82rem"
  time-large:
    fontSize: "0.75rem"
  time:
    fontSize: "0.74rem"
  time-small:
    fontSize: "0.7rem"
  badge-small:
    fontSize: "0.68rem"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
  4xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.dispatch-green}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 20px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.dispatch-green}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 20px"
    height: "48px"
  repair-card-selected:
    backgroundColor: "{colors.dispatch-green-pale}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px"
  message-tenant:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
  message-agent:
    backgroundColor: "{colors.dispatch-green-pale}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
  status-attention:
    backgroundColor: "{colors.attention-pale}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
---

# Design System: Fix This

## Overview

**Creative North Star: “The Calm Dispatch Desk”**

Fix This should feel like a calm, well-run maintenance desk. A manager should see what happened, what needs a decision, and what happens next without digging.

The repair stays at the center of the screen, not the automation. Keep its messages, proposed visit, approval, and activity visible together.

This is a working dashboard, not a staged AI demo. Do not add fake metrics, guided scenarios, decorative filler, or controls that only look functional.

**Key Characteristics:**

- clear priorities
- plain language
- one decision at a time
- messages that read like a real conversation
- quiet, immediate feedback

## Colors

Near-white surfaces and deep green keep the dashboard calm and easy to scan. Pale green marks the current selection and completed work; amber calls for attention or approval; red is reserved for errors and immediate danger.

### Primary

- **Dispatch Green** (`oklch(0.4 0.106 150)`): primary actions, the utility rail, connected state, current progress, and confirmed success.
- **Deep Dispatch Green** (`oklch(0.35 0.106 150)`): hover state for the primary action only.
- **Paper Green** (`oklch(0.94 0.035 150)`): selected repair, outgoing message, icon well, and completed-state surface.

### Neutral

- **Work Surface** (`oklch(0.985 0 0)`): application background.
- **Clear Sheet** (`oklch(1 0 0)`): panels, messages, fields, and cards.
- **Quiet Bay** (`oklch(0.97 0.006 150)`): activity rail and low-emphasis hover surface.
- **Operational Ink** (`oklch(0.21 0.018 150)`): primary text.
- **Supporting Ink** (`oklch(0.43 0.018 150)`): summaries and metadata.
- **Working Line** (`oklch(0.88 0.01 150)`): dividers and default borders.

### State colors

- **Approval Amber** (`oklch(0.67 0.13 78)`): pending approval and attention states.
- **Immediate Red** (`oklch(0.52 0.18 30)`): errors and explicit danger only.

**The Restrained Green Rule.** Dispatch Green appears only on current selection, primary action, focus, connected state, and confirmed success. Its rarity gives it authority.

**The State Has Meaning Rule.** Never use green, amber, or red as decoration. Every semantic color must communicate a state or action.

## Typography

**Display Font:** System humanist sans (`ui-sans-serif`, San Francisco on Apple devices, Segoe UI on Windows)

**Body Font:** The same system humanist sans

**Label Font:** The same system humanist sans

**Character:** Familiar, highly legible, and calm. Hierarchy comes from weight, size, leading, and spacing—not from mixing typefaces or using display typography in controls.

### Hierarchy

- **Headline** (760, `1.82rem`, 1.12): the repair title; maximum width `36ch`.
- **Title** (740, `1rem`, 1.25): panel and section headings.
- **Body** (400, `0.98rem`, 1.62): case summaries; maximum width `68ch`.
- **Message** (400, `0.88rem`, 1.5): SMS conversation text.
- **Label** (680, `0.82rem`, 1.35): field names, actor names, and compact metadata.

**The Ordinary English Rule.** Labels name the person's action or the next state: “Approve contractor and price,” “Ask for a change,” “Waiting for your approval,” and, only after every check passes, “Book confirmed visit.” Keep internal terms such as authorization and workflow out of interface copy.

## Elevation

The product is flat by default. Structure comes from alignment, surface shifts, one-pixel dividers, and carefully bounded containers. Ordinary panels have no shadow. A compact ambient shadow (`0 4px 8px color-mix(in oklch, var(--color-ink) 20%, transparent)`) is permitted only on temporary feedback such as notices and error banners.

**The Flat-by-Default Rule.** Static work surfaces never float. Use tonal layering and borders for permanent structure; reserve shadow for temporary UI that must sit above the workspace.

**The No Decorative Glass Rule.** Translucency may clarify the sticky app header, but glass effects never decorate ordinary panels.

## Components

### Buttons

- **Shape:** compact rectangle with `8px` corners and `48px` minimum height.
- **Primary:** Dispatch Green background, white text, and `0 20px` padding.
- **Secondary:** white surface, one-pixel Dispatch Green border, and green text.
- **Hover / Focus:** hover deepens or softly tints within 160 ms; focus uses a three-pixel mixed-green outline; pointer-down scales to `0.97` for 120 ms.
- **Language:** name the real result. Use “Approve contractor and price” for approval and “Book confirmed visit” only after access and contractor confirmation are recorded. Never combine them into “Approve and book.”

### Status indicators

- **Style:** compact `8px`-radius label with icon, one-pixel semantic border, and pale semantic background.
- **State:** amber means a decision is required; green means complete or connected; red means an error or immediate risk.
- **Proposal source:** use a compact green “Contract rate” label for stored terms and an amber “Outside quote” label for fallback pricing.

### Cards and containers

- **Corner style:** `12px` for bounded case, proposal, and activity containers.
- **Background:** white on the neutral work surface; the activity rail uses Quiet Bay.
- **Shadow strategy:** none at rest.
- **Border:** one-pixel Working Line; stronger borders only for inputs and increased-contrast mode.
- **Internal padding:** usually `16px` or `20px`; do not wrap every text group in another card.

### Inputs and fields

- **Style:** white background, one-pixel strong neutral border, `8px` corners, and at least `48px` interactive height for single-line fields.
- **Focus:** three-pixel mixed Dispatch Green outline with a two-pixel offset.
- **Disabled:** preserve the control’s shape while reducing opacity to `0.52`; never hide why an action is unavailable.

### Navigation

- **Utility rail:** solid Dispatch Green, white line icons, `48px` targets, and a restrained translucent active state.
- **Repair queue:** white surface with plain category counts. The current repair uses Paper Green plus a green-mixed border.
- **Responsive treatment:** the utility rail disappears below `62rem`; below `46rem` the queue becomes a horizontally scrollable strip above the case instead of a hidden drawer.

### Message thread

- **Tenant messages:** white surface, left aligned, with a slightly tighter top-left corner.
- **Agent messages:** Paper Green, right aligned, with a slightly tighter top-right corner.
- **Behavior:** familiar conversation rhythm, natural timestamps, and no decorative avatars or bubble tails.

### Repair activity

- **Structure:** quiet vertical timeline with compact markers and ordinary-English event names.
- **Auditability:** every automated or human action names its actor, result, and time. Waiting steps remain visually distinct from completed steps.

### Motion

- **Feedback:** state transitions run for `100–220ms` with strong ease-out curves; sheets may use `260ms` and `cubic-bezier(0.32, 0.72, 0, 1)`.
- **Behavior:** no routine bounce, drifting decoration, or animated navigation. Reduced-motion mode collapses transitions to an immediate state change.

## Do's and Don'ts

### Do:

- **Do** make the active repair and required approval obvious without making the rest of the case disappear.
- **Do** place controls beside the content they affect and respond on pointer-down.
- **Do** use the exact OKLCH palette and the `8px`, `12px`, `16px` radius scale.
- **Do** use `100–220ms` state transitions, strong ease-out curves, and critically damped motion with no routine bounce.
- **Do** keep messages readable and familiar, with clear sender distinction and natural timestamps.
- **Do** replace positional motion with immediate state changes when reduced motion is requested.

### Don't:

- **Don't** make this look or behave like a generic SaaS demo.
- **Don't** add guided scenarios, fake metrics, marketing language, decorative dashboard filler, or controls that only simulate a workflow.
- **Don't** turn the product into a futuristic AI console or make the agent the visual protagonist.
- **Don't** use vague labels such as “Proceed,” “Execute,” or “Resolve” when the real action can be named.
- **Don't** animate routine navigation, keyboard actions, or frequently repeated list selection.
- **Don't** use gradients, excessive pills, glassmorphism, oversized hero type, or shadows on static panels.
