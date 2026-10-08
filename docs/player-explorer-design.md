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

# v13 — "재밌어야 함" play layer

## Input

- User feedback on v12: the personal-stats page still does not feel interactive or animated; it is not "fun at first glance".
- Diagnosis from a real-browser render of v12 (Playwright/Chromium, 1440 and 390 px): every filter change replaced the profile with no transition, champion and game pickers were flat grey boxes, and on a phone the first screen showed only page chrome (title, demo banner, access strip, selects) — the player card started below the fold.

## What changed

| Area | Change | Consequence of interacting |
| --- | --- | --- |
| Player card (hero) | Count-up win rate / W-L, entrance light sweep, main-lane watermark, flame streak badge | — |
| Recent 5 cards | W/L cards dealt in on entrance | Click selects that exact game in the chart (widens scope if the game is outside the current filter) |
| Signature facts | 주 무대 (most-played actual lane), 최다 픽 (most-played champion), 한 판 최다 킬 | Click applies that lane/champion filter, or selects the record game |
| Scope stats | Numbers glide from the previous scope; up/down flash; win-share bar | Every lane/champion pick visibly moves the numbers |
| Champion pool | Text champion marks (2 letters, stable colour family — not official icons), win-share meter, pointer tilt | Selected card gets gold ring and pop |
| Lane map | Selected lane path flows; selected role pings twice; zero-game roles dimmed | — |
| Chart | Markers are HTML (round dots and a square Perfect diamond at any width — fixes v12's stretched diamond on mobile), selected point halo (3 pulses), dashed cursor | Metric switch morphs the curve; window shifts slide; mouse hover previews the nearest game; plot click/drag selects |
| Selected game | Post-game card: VICTORY/DEFEAT watermark, champion mark, fact badges (최다 킬 / 최다 어시스트 / 무데스 within the current scope) | Slides in on change |
| Replay | User-started button walks every game in scope oldest → newest (~9 s max), sliding the window | Stops on any other click, route change, hidden tab, or motion off |
| Highlights | Trophy icons, shimmer on hover | Click selects the game, scrolls its card into view and bursts |
| Mobile | In a profile, the page title, demo-banner copy, filter summary and duplicate access strip are hidden; facts become a swipe row | Player card appears on the first phone screen |

New files: `public/player-motion.js` (count-up, bar tween, tilt, burst, ripple — every helper is a no-op when motion is off or an API is missing, and always ends on the exact rendered text), `public/player-arena.css` (loaded last).

## CHR_Web Harness r6 alignment (r2 of this revision)

The first v13 pass was built without the harness package. After the full `CHR_Web_Harness_r6.zip` was provided, `HARNESS.md`, `docs/DESIGN.md`, `docs/QA.md`, `docs/DIAGRAMS.md`, `docs/DECISIONS.md`, `docs/INTAKE.md`, `docs/HANDOFF.md` and `runtime/design-tokens.json` were read and the play layer was restyled; interactions are unchanged.

| Harness rule | First pass | Now |
| --- | --- | --- |
| Brand palette only (navy, blue, slate, auxiliary, inactive, tint/surface/content tint); no added themes | Gold accents, orange flame, eight multi-hue champion gradients, glow | Palette tokens only (plus white and the v12 loss colour); six champion fills from the palette; enforced by a test |
| Angular faces and thin lines; no repeated decorative cards | 10–12px radii, pill buttons, gloss and drop shadows | 0–2px corners, flat fills, 1px borders; no glow/gloss |
| No gradient/shadow behind headline text | Text glow on the player name, sweeping light band, radial hero gradient | Removed; v12 solid navy stage kept |
| Readable sizes, no forced small text | 7–10px labels (LATEST tag, kickers) | All labels ≥ 11px (test); LATEST tag replaced by a white top rule |
| Short feedback motion, no autoplay | Infinite flame flicker and lane flow | Finite iterations everywhere (test); text in the selected-game card no longer fades or moves |
| Print and reduced-motion paths | Not covered by the new layer | Print disables animation and hides replay/watermarks; reduced motion and the toggle remove all motion |
| QA at 1440/1024/390/320 and 200% zoom, recorded separately from device QA | 200% zoom not checked | Checked (see below) |

Process note: the harness treats a broad redesign as a representative draft that needs explicit user approval before publishing. This revision is therefore a draft on the branch; nothing was published to the Site.

## Rules kept

- Statistics still come only from match records through the existing selectors. Facts and badges are maxima/counts of recorded values; no score, MMR, MVP or ACE is shown or implied.
- Null stays `—`, Perfect stays outside the numeric axis, no count-up runs for `—` or Perfect.
- Motion off (toggle) and OS reduced motion remove all animation, hover movement, tilt, burst and ripple, and hide Replay. Ambient loops (flame flicker, lane flow) run only while motion is on; one-shot pulses (halo, ping) stop after 2–3 iterations.
- Demo remains browser-only and separate from real records.

## Verification (this revision)

- `node --test tests/*.cjs tests/*.mjs`: 267 passed (254 existing, 1 existing assertion updated for count-up markup, 13 new: harness token guard, hero facts and jumps, out-of-scope recent card, replay, view marker, token, markers, badges, replay/morph no-op, motion module).
- Real Chromium via Playwright against a local static server with a mock read-only `/api` (demo state): 1440 / 1024 / 430 / 390 / 375 / 320 px renders with no horizontal overflow and no console errors; 200% zoom emulated as 720×450 (desktop) and 195 CSS px (390 phone) at device scale 2 with no overflow or clipped labels; print media emulated (animations off, replay/watermarks hidden) and an A4 PDF produced; scripted checks of entrance count-up (12.1% → 62.5%), fact → filter, map + champion intersection, reset, hover preview, plot click and drag, metric morph, replay 1 → 24, highlight burst + scroll, hero card selection, view switch, explicit motion off and emulated OS reduced motion.
- Not verified: real phones/tablets, touch feel, Safari/WebKit, KakaoTalk webview, real browser text-zoom settings (only emulated), screen readers, the printed PDF on paper, the real Sites runtime and D1 data, and whether the user now finds it fun.

## Round 3 — "더 재미있게, 전력을 다해서"

User feedback after the harness-aligned pass: still not fun enough. The palette, shapes and motion rules above stay; this round adds game-like layers, every one derived from recorded games only.

| Feature | What it does | Source |
| --- | --- | --- |
| Season recap story (`▶ 시즌 리캡 보기`) | Full-screen story slides: intro with every game as a W/L ribbon, first game, record, main lane, most-picked champion (and most-won if different), best day, longest win streak (flags if still running), career highs, best duo (real records only), achievements and next goal, call to action. Progress bars, tap/arrow navigation, pause; auto-advance only while motion is on. White slides carry the CHR_Web corner polygons from `design-tokens.json`. | `player-recap.js` `recap()` / `renderStory()` |
| Achievement wall | 12 milestones with their rule written on the tile (첫 승리, 10/30경기, 3/5연승, 한 판 10킬, 한 판 20어시스트, 무데스, 챔피언 5종, 한 챔피언 5경기, 하루 3승, 세 라인). Unlocked tiles open the exact first game that met the rule; locked tiles show progress and what is left ("다음 경기를 이기면 달성"). K/D/A milestones read "K/D/A 미수집" when no complete K/D/A game exists. | `achievements()` walks games oldest → newest |
| Season ribbon | Every game in scope as a W/L segment under the timeline scrubber; the 12-game window and the selected game are marked and follow drags. | `renderRibbon()` in `player-insights.js` |
| Streak celebration | A live win streak of 3+ gets a short burst on arrival. | `form.streak` |

Milestone thresholds are fixed, documented counts — not ratings. They are computed for the current date scope, not the lane/champion filter.

Verification for this round: 274 Node tests passed (7 new: recap/achievement module ×5, page wall + dialog, motion-off recap and empty profile). Chromium via Playwright: 1440/1024/430/390/375/320 px with no overflow or console errors; 200% zoom emulation and print emulation unchanged; recap driven slide by slide at 1440, 390 and 320 px (10 slides, arrows, Esc focus return, auto-advance, pause, CTA closes and scrolls to the explorer). Two bugs found and fixed during that run: the left tap zone covered the last slide's buttons, and focus was lost when "next" disabled on the last slide. Real devices remain unverified.
