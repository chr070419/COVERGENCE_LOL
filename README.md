# 융합본부 LoL 내전

Adapted from the sports-day team draw, commit 879f780bd38f2bde6f25b81fb90a54706b7f69e1. Retains Paperlogy fonts, Jininfra navy/blue branding, cryptographic Fisher–Yates shuffle, the original shuffle and export workflow. New independent Site identity; no source-site runtime records or roster are carried over.

## Behavior
- The ten supplied participants and ordered lane preferences are preloaded.
- Jongwon and Minjae remain on their respective teams; each lineup contains all five lanes exactly once.
- Balance uses relative tier weights and lane costs, with hard exclusions enforced. These are organizational heuristics, not predicted win rates.
- Best-of 1/3/5/7; game outcomes stop at clinch. Undo, reset, manual swaps and profile edits preserve a coherent match state.
- Match state and all history are shared in D1. The UI refreshes every 15 seconds while visible; concurrent edits use revision checks.
- Only authenticated admins can edit. The Site owner is bound once from trusted sign-in identity using the runtime OWNER_EMAIL setting, then authorized by stable Site user ID. Only the owner may grant/revoke other admins. New users are viewers.
- The existing Site audience is preserved; app roles do not change hosting access. An added admin must also be admitted through Site sharing.
- Every write enforces current server-side role, same-origin JSON and size/schema validation. Role revocation is checked atomically with state writes.
- Browser-local legacy records remain untouched and can be explicitly imported by an admin. JSON backup/restore and text sharing remain available.

## Validation
`node --test tests/*.cjs tests/*.mjs`

Automated tests cover roster fidelity, role allocation, exclusions, ordered preferences, match rules, state integrity, confirmation/cancellation, reset/restore and profile/manual lineup changes. UI tests use a lightweight DOM adapter; real-browser layout, clipboard, dialogs and downloads have not been verified because managed browser QA is unavailable in this environment.

## Header
The company logo and image favicon were removed at the owner’s request. The header shows the division name as text.

## Daily match records
`history.html` shows match archives with a date filter, set-level results, team totals and frozen lineups including tiers and preferences. Admins can edit or restore archived records. `players.html` is a separate read-only page for overall individual records and per-player detailed performance, with its own date and player selection. Completion automatically archives the current series; undo corrects that same record. Starting another series, changing teams/roster/rules, or finishing the day first archives any scored unfinished match as stopped (game results count, no series winner).

The existing browser-storage key is preserved without any automatic cloud upload. Admins can explicitly migrate legacy state; identical scored legacy backups receive deterministic IDs. Import merges archives instead of discarding existing history. Full JSON backups contain current state and all records. Dates are Korean calendar days. Record timestamps show when they were archived. Invalid stored bytes are not overwritten automatically.

Validation added archive/undo identity, legacy deduplication, immutable player snapshots, partial day-end, repeated restoration, backup merges and corruption preservation. History page received independent DOM checks for rendering, filters, escaped input, full backup and read-only behavior. Real-browser layout verification remains unavailable.

## Runtime
Vinext starter with Sites integration; `public/` holds client pages. Canonical rules are in `domain/` and copied for the browser before builds. `drizzle/` contains schema-only D1 migrations. Native environment configuration supplies secret OWNER_EMAIL; it is not committed in source. Stored match/history JSON is limited to 1.5 MiB, and an oversized update is rejected without changing saved data.

## Per-set match records and operations
- Canonical `games` freezes every played lineup and optional champion/KDA/damage/CS/gold/vision values. Legacy results synthesize their known lineup; unknown details remain null.
- Mid-series player/role swaps change only the next set. Completed-set buttons display the lineup actually used; undo restores a coherent playable lineup.
- Draft previews support captain-lock toggle, up to 10 separate-player pairs, teammate-repeat reduction, and up to 3 distinct team memberships before application. Preferences and excluded roles remain enforced.
- JSON registration (`import.html`) accepts strict versioned external-agent output. The copyable prompt includes the selected series/set roster mapping and null/uncertainty rules. Pasted text or JSON files are validated, manually matched, previewed, confirmed, and saved through current admin authorization and CAS. This site does not upload/analyze photos.
- Recorded sets can be enriched after a later series begins. Archived-series imports can update existing sets but cannot append new ones. Different-series JSON and duplicate external IDs are rejected.
- Admin archive editing covers date, rule, per-set lineup, winner, duration, notes, champions and numeric stats. A preview and reason are required. Actual recorded captain/separation changes are called out; excluded-role constraints stay enforced.
- Server-generated `record_audit` entries capture trusted actor/time/reason and full before/after records for every archive difference, including backup imports. State CAS and audit insertion use a single transactional D1 batch. Viewing audit and restoring prior snapshots are admin-only; restorations are audited too.
- The dedicated personal-performance page (`players.html`) uses each played set's team and role. Switched-team series are marked mixed rather than assigning a fabricated series winner. Null KDA/champion values are excluded from relevant aggregates.
- Share cards use exact-data canvas PNG rendering, frozen per-set lineups, and optional user-triggered native file sharing. No company logo is included.

Validation includes domain, SQL authorization/transaction rollback, import schema/context, UI role/conflict/event flows, and canvas content/bounds mocks. Real browser visual verification remains unavailable in this environment.

## Player profiles and derived statistics

`players.html` is the player directory; `players.html?player=<playerId>` is a stable individual profile. Identity is the existing immutable roster ID. Current roster details take precedence over historical names/tiers; historical-only participants remain reachable. The match centre links player names to these profiles while keeping admin profile editing as a separate action.

`domain/player-stats.cjs` exposes `LoLPlayerStats` in the browser and CommonJS in tests. `selectPlayers(state, {date})`, `selectPlayer(state, playerId, {date})`, and `selectGames(state, {date})` are read-only projections of the existing shared state. Finished individual sets in the current series are included immediately; a matching archived/current series is counted once. No totals, ratings, or standings are persisted. `LoLHistory.playerDetails` remains a compatibility projection through this same calculation layer.

- A game means one played set, not an entire best-of series. Actual frozen set positions and teams determine personal results; profile preferences never stand in for played positions.
- Win rate uses played wins / played games. Empty samples return `null`. Display precision is one decimal for win rate and CS/min, two for KDA, and one for per-game averages.
- KDA uses sums from sets with all three K/D/A values known. Known zero deaths produce Perfect KDA; missing deaths do not. Per-field averages have independent known-value sample counts.
- CS/min is total known CS divided by total minutes from the same eligible sets. Missing/non-positive duration or missing CS excludes that set from this metric only. A known CS of zero is included.
- Recent form and streaks use individual set outcomes. Date, series timestamp/ID, then set number establish a deterministic newest-first order. Position/champion statistics reuse the same aggregation functions as overall totals.
- Uncollected legacy optional fields canonicalize to `null` (notes to an empty string), while malformed values, missing identities, duplicates, and invalid lineups are rejected. Cancelled/invalid markers are excluded by statistical selectors and cannot be silently imported as scored persisted records.
- JSON registration resolves a missing ID only through a unique exact normalized real name, current nickname, or confirmed alias. Similar names are suggestions; ambiguous names, unknown IDs, and conflicting identities require a deliberate existing-player selection. No player is created from input.
- Archive deletion requires admin authorization, confirmation, a reason, and the pinned shared-state revision. Deleting the active archive also detaches its mirrored current results. Deletion/restore uses the existing transactional audit log; restored records and all statistics are derived again. Other open pages refresh on visibility/manual refresh and every 15 seconds while visible.

### Real names, game nicknames and renames

The stable player ID remains the only statistical identity. Roster records add optional `currentNickname: string | null` and `nicknameAliases: string[]`; each saved game participant adds `nicknameAtMatch: string | null`. Old backups load with null/empty defaults. No nickname is inferred from a real name, champion, screenshot order, or current profile. No database migration, duplicate statistics, Riot API lookup, or automatic account ownership assertion is introduced.

Admins use the separate **닉네임 관리** action in the match centre. Changing the current nickname automatically keeps the previous one as an alias; aliases can also be removed explicitly. This metadata-only save preserves the active series ID, teams, scores, statistics and archived snapshots. It uses the existing server-side role checks and revision CAS. Viewers see identity details without edit controls. Duplicate names across players require an explicit warning acknowledgment; imports still require human disambiguation.

`normalizeNickname` uses NFKC, case folding and whitespace normalization while retaining the entire Riot tag. No prefix, fuzzy, or tag-stripped automatic match is allowed. A confirmed ID and a nickname pointing to someone else require manual correction; an unknown ID never falls back silently. The import prompt includes real names, current nicknames and aliases. It instructs an external image agent to return null identities when nicknames are absent. The import preview offers a default-off checkbox to remember verified raw nicknames as aliases; this never changes the current nickname. The original observed value is retained as `nicknameAtMatch` even after a later rename.

For archived imports, the current registry is authoritative for existing player IDs. Removed aliases cannot reappear from old frozen rosters; archived-only IDs fall back to their saved identity. History editing and audit restoration preserve the latest current registry and each game's observed nickname. The directory searches real/current/previous names; profiles display current identities while recent games and archive lineups show their saved at-match identities. To correct an erroneous past identity, admins edit that game's recorded nickname through the existing audited record editor.

Nickname regression tests cover rename/import/statistics continuity, null screenshot identities, manual resolution, exact tagged matching, collisions, opt-in remembering, old backup identity hashes, immutable archives, corrections/restoration, permission revocation and stale revisions. Browser modules remain generated by `scripts/sync-rules.mjs` from canonical domain modules.

### Visual player profiles

Personal profiles use a navy player banner, an exact win/loss ring, a recent-result ribbon, an interactive position map and a most-played champion showcase. The full numeric breakdown and match links remain available. Position and champion graphics describe played-game frequency, not inferred skill, MMR, rank, or performance scores. Uncollected data remains unknown, including the empty win-rate ring for a player with no games.

`public/player-visuals.js` renders the existing `player-stats` selector results without changing the source state or persisting derived data. Its companion stylesheet supplies original vector geometry and finite entry animations; no external player/champion images or chart library are required. The player page controls selection, motion preference and existing date/navigation behavior. Motion respects the operating system's reduced-motion setting and can be disabled on the page. Polling, expanding older matches and inspecting a position do not replay entry effects.

The graphics include visible values and text labels, keyboard-operable position buttons, win/loss labels in addition to color, and narrow-screen layouts. Automated checks cover the existing statistical projections, visual empty/missing-value states, safe escaping, navigation, position selection, motion controls and read-only behavior. Supported real-browser visual QA is unavailable in the managed environment, so actual device rendering remains unverified.

### Haeram sample profile and performance exploration

`players.html?player=haeram&demo=1` opens an explicitly labelled, browser-only sample profile for 최해람. `public/player-demo.js` builds deterministic canonical match records, and the existing statistics selectors derive their totals. Sample records never merge into the live state, enter backups or update shared storage. The sample includes 24 played games with varied champions and MID/TOP roles, wins and losses, one zero-death game, and deliberate missing measurements. Other participants are labelled as fictional demo participants rather than attributing synthetic performances to coworkers. Leaving demo mode returns to the actual profile and its original data source.

`public/player-insights.js` projects a chronological window of up to 12 games for a KDA / CS per minute / champion damage explorer. Graph-wide touch/drag and keyboard controls update the selected game immediately; a full-history timeline, previous/next controls and clickable highlights also reach older games. Stable source game keys and the visible window survive metric changes and refresh. The chart separates missing measurements and Perfect KDA from numeric values. Factual highlights describe recorded kills, assists and zero-death games; they are not a rating or MMR. This layer stays read-only and uses the existing statistics utilities. Its visual companion is `public/player-insights.css`.

The profile's connected workspace uses actual-position and champion filters to update its statistics, chart, match list and detailed tables together. The unfiltered date-wide hero remains explicitly separate. Three views (explore, match list, detailed statistics) replace the old repeated vertical stack. Mobile uses compact role buttons, desktop uses the position map; both control the same scope. `public/player-explorer.css` owns the profile-specific composition. `docs/player-explorer-design.md` records the actual CHR Web Harness r6 reference, design decisions and verification limits.

The sample can be viewed without loading live match data, and sample-game details open locally instead of linking to nonexistent production archives. Tests cover deterministic source records, independent statistical totals, demo/live separation, navigation and loading races, trend gaps/Perfect handling, safe text rendering and keyboard/motion behavior. No production data is seeded by this feature.

### Future ratings and extra measurements

The saved schema retains the existing optional `gold`, `damage`, and `vision` measurements. It does not invent `performanceScore`, `internalMMR`, `mvp`, `ace`, `damageTaken`, ward data, or `objectiveDamage`, and the UI has no zero-valued placeholder rating panels. Introducing new measurements requires an explicit extension to `history-core` validation/cloning, the versioned import schema and prompt, and `player-stats` measurement/sample definitions. Keep any mapping from `damage`/`vision` to future named metrics explicit rather than silently changing their meaning.

A future rating service should consume `selectPlayer`/`selectGames`, calculate a versioned score with declared minimum sample sizes, and expose its result to a profile section. Shuffle logic in `domain/core.cjs` is unchanged and does not consume personal statistics. Connect a future balance adapter only after its formula and use of statistics are approved; do not insert rating calculations into the existing tier weights.

### Profile implementation file inventory

- Calculation and canonical records: `domain/player-stats.cjs` (new), `domain/history-core.cjs`, `domain/import-core.cjs`.
- Profile screen: `public/players.html`, `public/players-page.js`, `public/players.css` (new).
- Entry points, import and record operations: `public/app.js`, `public/styles.css`, `public/import-page.js`, `public/history.html`, `public/history-page.js`, `public/history.css`.
- Generated browser modules: `public/player-stats.js` (new), `public/history-core.js`, `public/import-core.js`; generated by `scripts/sync-rules.mjs`.
- Validation: `tests/player-stats.test.cjs` (new), `tests/players-page.test.cjs` (new), `tests/profile-integration.test.cjs` (new), `tests/feature-model.test.cjs`, `tests/import.test.cjs`, `tests/history-features.test.cjs`.
- Documentation: this `README.md`. No database migration, authorization policy, dependency, or shuffle-score change is required.

Test fixtures independently check a 10-game 6-win/4-loss player, a one-game player, a zero-game player, at least three champions and two played positions, Perfect KDA, missing CS/time/KDA, known zero, recent sorting/form, canceled/invalid records, duplicate participants, JSON identity resolution, modification/deletion/restoration, current/archive deduplication, and existing permissions/shuffle flows. Profile UI event checks include direct links/back navigation, 25-game pagination, stale data refresh and escaped long names. Responsive styles were inspected at mobile and tablet breakpoints; actual device/browser rendering remains unverified because the managed environment lacks the supported browser QA capability.
