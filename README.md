# FPL Intelligence

A full-stack, dark-mode Fantasy Premier League analytics website. Uses the **current FPL season from the public API**, an original responsive design, and a data-grounded personal assistant. It is independent of the Premier League.

## Features included

- **AI Assistant** — personalised question-answering using your public squad and official FPL metrics. Optional OpenAI key enables free-form grounded analysis; otherwise a deterministic coach provides captain, team, bench, fixture and transfer advice.
- **My FPL Team** — enter your public manager ID; see its latest published 15-player snapshot, pitch, substitutes, formation-aware suggested XI and captain / vice. Current unpublished/private transfers **cannot** be verified.
- **Rankings** — search/filter player statistics and modelled points with indicative ranges for 1/3/5/8 gameweeks.
- **Club form** — all 20 clubs, results and a transparent team-strength formula, plus an interactive Recharts plot.
- **Fixtures** — home/away, official fixture difficulty, blank and double gameweeks correctly grouped by GW.
- **Transfers** — same-position recommendations within a provisional published budget, max-three-per-club constraints, price and estimated 5GW gains. Uses published selling price when supplied in the public picks record.
- **News** — BBC Sport and Guardian RSS links, publication dates, possible associations to your squad, manual refresh. Headlines are not treated as confirmed injury reports.
- **Predictions** — deterministic, explainable estimate using FPL form, observed points per game, minutes, availability and opponent strength. Intervals are **uncalibrated heuristics**, not confidence levels.
- **Optional database and ingestion** — PostgreSQL via Prisma, plus token-protected `/api/cron` to ingest fresh accessible RSS articles. Schedule externally every 15–30 minutes where your hosting permits.

## Requirements

Node.js 20.9+ (22 LTS recommended), npm, a working internet connection for dependencies and live FPL data. Optional: PostgreSQL and an OpenAI API key.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The public FPL features work without an API key. For LLM-powered chat, add `OPENAI_API_KEY` to `.env.local`. No FPL login or password is needed or requested. The user's numeric team ID is saved **only** in their browser's `localStorage` for convenient reloads.

### Database / automatic ingestion (optional)

Set `DATABASE_URL` to a PostgreSQL connection string and `CRON_SECRET` to a long random secret in `.env.local`. Then:

```bash
npm run db:push
curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron
```

Use an external scheduler (or a supported hosting cron) to invoke that endpoint roughly every 30 minutes. Without `DATABASE_URL`, the core UI still loads but persistent ingestion explicitly returns 503. News remains accessible via a live server-side RSS request. Without RSS access, the news panel shows an error rather than fake articles.

## Validation and deployment

```bash
npm run typecheck
npm test
npm run build
npm run start
```

Deploy to Vercel or a Node-compatible host, set environment variables server-side, and provision PostgreSQL only if persistent news ingestion is needed. Ensure your hosting can call `fantasy.premierleague.com` and both RSS feed providers. Add HTTPS/rate limits appropriate to your production infrastructure and check external data-provider licences.

## Accuracy / limitations

Official FPL public endpoints, as observed in October 2026:

- `bootstrap-static/`, `fixtures/`, `entry/{id}/`, `entry/{id}/event/{gw}/picks/`, `element-summary/{id}/` are read-only public endpoints.
- Public picks may not reflect private changes since the last published gameweek. Current private `my-team` requires authentication and is **not** used.
- Bank values and selling prices may describe historical picks; unused free transfers and unused chips are not reliably public.
- Player expected goals, proprietary injury data, predicted lineups and paid football-data APIs are **not** fabricated; they are absent until verified provider access is configured.
- Predictions are a transparent prototype with no backtesting/calibration claim. The UI always labels modelled returns as estimates.
- RSS feeds, the Premier League's unofficial API surface and hosting rate limits may change at any time.

## Structure

`app/page.tsx` contains the responsive dashboard. `lib/fpl.ts` is the pure FPL scoring/validation layer and public API client. `lib/team.ts` fetches latest publicly accessible picks. `lib/news.ts` ingests permitted RSS. `app/api` contains HTTP routes. `prisma/schema.prisma` defines optional persistent news storage. `tests/logic.test.mjs` tests domain calculations with real executable assertions.

### Project status

The source has executable unit tests; final production build requires downloading dependencies. A full production integration test also requires network access to the live FPL API and RSS providers. Do not deploy without running the commands above in an internet-enabled environment.