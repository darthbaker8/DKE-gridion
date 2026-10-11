# DKE Gridiron v11

## Automatic + Historical Trend Collection

Trend snapshots are stored in Vercel Blob by NFL season and scoring week:

- `trend/2026/week-1.json`
- `trend/2026/week-2.json`
- etc.

The Trend tab now has Season and Week selectors. It can replay any week that has stored snapshots, while **Current week** jumps back to the live scoring period. Team names are stored inside every snapshot so historical weeks render independently of the current roster.

### One-time Vercel setup
1. Connect a Vercel Blob store to this project.
2. Redeploy.
3. The included cron calls `/api/snapshot` every 15 minutes and writes only on Thu/Sun/Mon ET when ESPN reports active players.
4. Optional: configure `CRON_SECRET`.

### Plan note
A 15-minute Vercel Cron requires a plan that supports that cadence. Otherwise an external scheduler can call `/api/snapshot` every 15 minutes.

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
