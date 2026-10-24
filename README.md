# Lifelong

A private dashboard for **your whole Garmin history**, focused on running a faster half marathon.

- **Lifelong progress**: predicted half-marathon time month by month since your first run, with your actual half-marathon efforts overlaid. Also yearly training hours by sport, monthly running volume, aerobic efficiency (easy-run pace), fitness (training load), VO₂max, resting HR, HRV, sleep, weight and steps.
- **Race predictions** for 5K, 10K, half marathon and marathon, with a likely range, a confidence level and the effort each one is based on. It also lists your personal bests and works out what a goal half-marathon time would require.
- **Next week's training plan**: a 7-day plan with paces, built around half-marathon performance. It adapts to your recent volume, recovery signals (resting HR, HRV, sleep, form) and your goal race date and time.

Run it on your own computer, where your data goes from Garmin into a local SQLite file (`data/lifelong.db`) and the server only listens on `localhost`. Or host it on Vercel (see below).

## Setup

Requires Node.js ≥ 22.13.

```bash
npm install
cp .env.example .env      # then paste your key into .env
npm run sync              # first sync pulls your whole history (can take a while)
npm run dev               # http://localhost:5173
```

**Getting a key:** Garmin Connect (web) → Account settings → **Personal API Key** → create it. It is shown only once and expires after the period you choose (30 days to 1 year). Garmin emails you before it expires. Put it in `.env` as `GARMIN_API_KEY=…`. Never commit `.env`; it's gitignored.

**No key yet?** Run `npm run demo` to explore with 13 years of synthetic data. It uses a separate `data/demo.db`.

| Command | What it does |
| --- | --- |
| `npm run dev` | App + API with hot reload |
| `npm run sync` | Incremental sync (only new data). You can also use the **Sync** page. |
| `npm run sync -- --full` | Download everything again |
| `npm run build && npm start` | Production build served by the same server |
| `npm run demo` | Seed demo data and start the app on it |
| `npm test` | Unit tests for the prediction and planning logic |

## Hosted on Vercel: anyone can use it with their own Garmin

The same app runs on Vercel for any number of people, with no accounts or passwords. Each person opens the site, pastes **their own** Garmin Personal API key, and their data downloads to their own device (IndexedDB). Everything is computed in their browser. It re-syncs automatically when the data is more than 3 hours old, and goal and schedule settings are saved per device.

The only server code is `api/garmin.ts`, a relay. Browsers can't call Garmin directly, so it forwards each request using the key or 24-hour token the browser sends. It stores nothing and never uses a server-side key, so no one can see anyone else's data. **Don't set `GARMIN_API_KEY` in Vercel**; it's ignored there anyway.

Garmin allows about 100 requests a minute per person. A first sync of several years needs about 15 requests per year of history plus one per 100 activities, so it usually finishes in seconds. If Garmin asks for a pause, the app waits and continues.

No environment variables are needed. `vercel.json` builds with `npm run build:vercel` (cloud mode).

## How the numbers are made

**Race predictions** (`server/analytics/predict.ts`)

1. Every outdoor run produces *efforts*. These are the run as a whole plus Garmin's fastest 5K/10K/HM/M splits inside it. Treadmill, virtual and trail runs are excluded because their pace isn't comparable.
2. Each effort becomes a **VDOT** (Jack Daniels' model). Efforts older than 4 weeks are discounted by 0.3 %/week for detraining. Only the last 12 months count.
3. A heart-rate-based estimate (pace vs. % of heart-rate reserve on steady runs) does two jobs. It filters GPS glitches: an effort far above what your HR says is possible gets ignored. It also keeps the number current when your best effort is old.
4. VDOT is converted to equivalent race times. For the half and the marathon, an **endurance penalty** is added when your recent weekly km and longest run don't yet support the distance. VDOT assumes you trained for the distance, and predictions from short races are famously optimistic for the marathon.
5. Garmin's own VO₂max is shown as a cross-check only. Watch VO₂max tends to be optimistic compared with real races.

**Weekly plan** (`server/analytics/plan.ts`)

- **Volume:** builds about 8 % on your last-3-week average, capped at 10 % above your biggest recent week. After three rising weeks you get a down week (~80 %). It holds steady when readiness is mixed and cuts back (~70 %, no hard intervals) when it's poor.
- **Phases** count back from your goal race: base → build (threshold + VO₂max intervals) → race-specific (threshold + half-marathon-pace reps) → taper → race week.
- **Paces:** threshold, interval and easy paces come from current fitness. Half-marathon-pace work uses your goal pace when you set one.
- **Schedule:** the long run goes on your chosen day, with quality sessions about 2 and 4 days after it. Rest days follow your preferences. Until you save your own settings, these come from the training-day preferences in your Garmin profile.

This is a heuristic coach, not a medical tool. Listen to your body.

## Data sources (Garmin Connect Personal API)

`activitylist-service` (all activities, paged), `usersummary-service/v2/dailysummaries` (1-year chunks), `sleep-service` (31-day chunks), `hrv-service`, `weight-service`, `userprofile-service`. Daily data is pulled back to your first activity, or to `GARMIN_HISTORY_START` if you set it in `.env`.

## Project layout

```
server/
  index.ts            Express server (+ Vite middleware in dev), binds to localhost
  api.ts              JSON endpoints used by the UI
  db.ts               SQLite schema (node:sqlite) and queries
  garmin/             Personal API client, DTO mapping, incremental sync
  cli/                sync and demo-data commands
shared/               types, VDOT model, analytics (predictions, load, readiness, plan) and
                      compute.ts: every view, used by the local server and the hosted app
api/garmin.ts         Vercel function for the hosted version
src/                  React UI (pages: Overview, Progress, Races, Plan, Activities, Sync)
```
