# DKE Gridiron v16 — Playoff Race

## Automatic + Historical Trend Collection

Trend snapshots are stored in Vercel Blob by NFL season and scoring week:

- `trend/2026/week-1.json`
- `trend/2026/week-2.json`
- etc.

The Trend tab now has Season and Week selectors. It can replay any week that has stored snapshots, while **Current week** jumps back to the live scoring period. Team names are stored inside every snapshot so historical weeks render independently of the current roster.

### One-time Vercel setup
1. Connect a Vercel Blob store to this project.
2. Redeploy.
3. The included cron calls `/api/snapshot` every 3 minutes and writes only on Thu/Sun/Mon ET when ESPN reports active players.
4. Optional: configure `CRON_SECRET`.

### Plan note
A 3-minute Vercel Cron requires a plan that supports that cadence. Otherwise an external scheduler can call `/api/snapshot` every 3 minutes.

### Endpoints
- `/api/leaderboard` — live ESPN data
- `/api/snapshot` — automatic collector
- `/api/trend?season=2026&week=N` — one stored week
- `/api/trend-weeks` — list all stored season/week files
- `/api/history` — historical standings/recalc

## v12 trend snapshot fix

`/api/snapshot` now calls the shared leaderboard data loader directly instead of HTTP-fetching `/api/leaderboard` through the incoming request host. Vercel Cron invokes functions on a deployment-specific hostname, which can be protected and caused the internal fetch to return 401. This change avoids that self-request, so scheduled snapshot collection can write to Blob normally.

## Flat GitHub upload layout
This package is intentionally flattened for iPad/GitHub web uploads. All files belong at the repository root. `vercel.json` maps the public `/api/*` routes to the root-level Node functions, so no `api/` folder is required.


### Snapshot cadence
Vercel cron calls `/api/snapshot` every 3 minutes (`*/3 * * * *`).


## v13
- 3-minute snapshot buckets (fixes 3-minute cron overwriting a 15-minute bucket).
- Trend header shows snapshot count, cadence, and latest snapshot time.
- Trend P75 toggle overlays dotted best-case forecast lines.
- Snapshots now store players-left/live counts so P75 tightens as games complete.


## v14
- Team detail / roster drill-down: tap any team in Live, Quick, or P25–P75.
- Shows current, ESPN projected, P75, live/later starters, and player-level projected/current points.
- Keeps 3-minute trend snapshots and P75 trend overlay from v13.

## v15 — DKE branding + interactive trend replay
- Blue, gold, and crimson theme with a ΔΚΕ monogram (not a reproduction of the official badge) and fraternity motto.
- Hover or drag on the trend chart to select a stored snapshot; use the range slider on touch devices or with arrow keys.
- Timestamp, team names, exact projected scores, and optional P75 values update together. No interpolation between snapshots.
- Tap a snapshot score to highlight a team; tap again to clear the highlight.
- Retains v14 roster details, 3-minute cron and storage buckets, P75 overlay, and historical views.
- All 10 files stay at ZIP root for GitHub web upload.

## Manual deployment (no GitHub required)
Unzip this package. All 11 files are at the ZIP root (no `api/` subfolder). In your existing
`dke-gridiron-vercel-v11` Vercel project, upload/deploy the complete extracted folder as a new
deployment. Do not create a new project; keep the existing Vercel Blob connection and environment
variables. `vercel.json` routes the root files to `/api/*`.

## v16 — Week-by-week Playoff Race
- Adds **Playoff Race** as a sixth navigation tab. The week slider runs from Week 1 to the latest
  completed regular-season week of 2026, so new completed weeks appear automatically.
- Ranking rows #1–#10 are re-ranked separately for every season and every week (wins first,
  cumulative fantasy points as tiebreaker). Columns are 2026 back through 2021, newest first.
- **As played** (default): prior seasons use original head-to-head weekly wins; 2026 uses the
  top-five scoring rule. At the latest completed week, fully applied commissioner-adjusted
  ESPN W/L records replace the 2026 reconstruction. This honors manual adjustments.
- **Top 5 for all years**: retrospective application of the current scoring rule to prior years,
  allowing an apples-to-apples comparison of how quickly the league splits.
- View the top-to-bottom win spread, top-half/bottom-half average win gap, and the count of teams
  at least two wins behind the current playoff cutoff. Playoff berth count defaults to the ESPN
  season setting, with 4-team and 6-team overrides.
- The cutoff metric is descriptive — **not a mathematical elimination or probability model**.
- New endpoint: `/api/race` fetches completed-week historical ESPN box scores for 2021–2026.
  Current 2026 data may depend on how quickly the commissioner updates adjusted ESPN records.
- No new environment variables, Blob schemas, or other services are required.

## Validation and live-data caveat
The route handler and frontend were tested against synthetic 10-team, nine-week ESPN-format
fixtures. Browser tests passed at desktop and mobile sizes, including slider interaction and
scoring mode changes. Live ESPN 2026 responses could not be fetched from the development
environment, so **verify the first deployment's records with ESPN** (especially the commissioner-
adjusted 2026 standings). If ESPN returns incomplete or inaccessible seasons, the UI displays
unavailable values instead of inventing wins.


## v17 — Playoff chance heatmap
- Adds red → yellow → green shading to every available Playoff Race season/week cell,
  with an estimated playoff chance label rounded to the nearest 5%.
- Odds update when you drag the week slider, switch scoring modes, or change the
  playoff berth count. Colors retain the v16 chronological comparison layout.
- Uses 900 deterministic Monte Carlo simulated finishes per season and selected week.
  Only the **current week's** cumulative standings and points are used to estimate
  future weekly fantasy points; small samples are shrunk toward league average.
  For historical H2H scoring, it also uses known future opponent pairings
  (not future results); for top-five scoring it awards five wins per simulated week.
- Adds a legend plus a 2026 count of teams with less than 20% modeled chances.
  These are **heuristic estimates**, not official ESPN probabilities or a
  mathematically rigorous elimination model. Actual odds depend on roster moves,
  injuries, trades, keeper rules, and future commissioner adjustments.
- `race.js` now returns each year's matchup *pairings only* for the remaining
  regular-season schedule to simulate historical H2H games without future-score leakage.
- No new services, credentials, packages, or Vercel configuration changes.

## v18 — Zero-chance dead zone
- Adds a distinct deep burgundy **Dead · 0% modeled** color to the Playoff Race heatmap and legend.
- Only exactly zero simulated playoff probability receives the dark shade. Nonzero results retain the red → yellow → green scale.
- Very small nonzero estimates now show `<5%` rather than rounding down to `0%`, so the dark shade and 0% label consistently identify zero simulations making the playoffs.
- A model result of 0% does **not** necessarily mean mathematically eliminated; for weeks with no games remaining, it reflects the final ranking.
- Same 11-file flat manual-upload layout; no changes to API, dependencies, or Vercel settings.
