# Player explorer — interaction revision

## Input and scope

- User: make the player profile visually engaging and genuinely interactive; prior v11 felt like a static report.
- Audience: the existing internal LoL participants, reading on desktop and mobile.
- Scope: the existing personal-statistics page body, with existing roster, source selectors, dates, permissions, and demo isolation preserved.
- Source checkpoint: `f58ca55a6a0caba00d8bb3268bb917d28894a86f` (published v11).
- Design reference actually read: `CHR_Web_Harness_r6.zip`, HARNESS.md, docs/DESIGN.md, docs/DIAGRAMS.md, docs/INTAKE.md, docs/QA.md.
- This applies the harness's design and review principles to the existing application. It does not run its document-site generator or copy the ISF banner, brand, page count, or assets.

## Visual plan

| Area | Purpose | Expression and interaction | Source |
| --- | --- | --- | --- |
| Player identity | Recognize the player and whole-date record immediately | Short navy profile, win/loss ring, unfiltered summary | Existing `selectPlayer` profile and totals |
| Exploration filters | Ask where and with whom this player performs | Rift position map and champion selectors, visible filter chips, reset | Actual game positions and champions |
| Scope summary | Explain what the selected condition changes | Selected games, win rate, KDA, CS/min with explicit whole-date comparison | Existing aggregation utilities over filtered source rows |
| Game timeline | Inspect one game in context | Direct tap/drag, keyboard slider, previous/next, stable game identity | Source game rows; numeric KDA/CS/min/damage only |
| Highlights | Open the evidence behind a number | Click factual maximum kill/assist or a deathless game to select it | Only complete collected K/D/A rows |
| Secondary views | Keep details available without a long repeated stack | Explore / match list / detailed stats controls | Same selected scope and source rows |

## Design rules carried into this app

- Retain actual Paperlogy font assets, navy/blue/white and clear thin boundaries.
- Prefer one connected workspace to repeated decorative cards. Increase visible control and supporting-text sizes.
- Show source-derived measures, with units and sample sizes. Null remains missing; Perfect is outside the numeric KDA axis; gaps are not interpolated.
- Keep cumulative and selected-scope totals visibly different. Do not introduce scores, MMR, medals, or fabricated performance labels.
- Every visible selection has a consequence. Use short feedback motion, explicit off and OS reduced-motion support, no autoplay.
- Maintain 44px touch targets, wrapping labels and controls, keyboard alternatives, and focus after rendering.
- Existing demo stays browser-only, explicitly labelled, separate from actual records and teammate identities.

## Review and verification

An independent read-only critic identified the long vertical report, inert graph surface, isolated map selection, inert highlights/champion cards, and undersized labels before implementation. Automated checks validate source computations, scope intersections, game identity across refresh/deletion, gestures/keyboard event handling, demo isolation and prior identity/permission regressions.

Browser rendering is unavailable in this managed Sites environment because the supported browser-control capability is absent. 320/390/1024/1440 layout rules are inspected in source, not claimed as rendered-device QA. The harness explicitly distinguishes structural checks from actual visual checks; actual mobile and 200% zoom checks remain unverified.

Final validation: 103 tests passed across the fixture, pure graph model/controller, page DOM adapter, visuals, statistics, JSON/profile integration and nickname integration. After the final load-more focus change, its two affected real/demo scenarios also passed. Independent review found and verified fixes for the highlight attribute escaping, drag-release window shift, hidden mobile control focus and cumulative-versus-filtered series labels. No production match records or permissions were edited.
