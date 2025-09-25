# Crypto Research Check-In

Accountability app for Shamil and Halit to log daily crypto research. The project uses Node.js, Express, EJS templates, and SQLite (better-sqlite3).

## Quick start

```bash
npm install
npm run dev
```

The development server runs with `nodemon` on [http://localhost:3000](http://localhost:3000).

## Login

Only the names **Shamil** and **Halit** (case-insensitive) are accepted. Sessions are stored using encrypted cookies.

## Features

- Daily check-in with optional note (one per UTC day).
- Research entry logging with title, summary, tickers, links, confidence, and minutes spent.
- Public dashboard showing streaks, completion rates, heatmaps, and latest research.
- Individual public profile pages with 90-day streak data and research history.
- Audit logging for all check-in and research mutations.
- `/api/stats` endpoint returning JSON streak and completion metrics for both users.

## Database

SQLite database lives at `./data/data.db`. Tables are created automatically at startup. To ensure the user rows exist you can run:

```bash
npm run seed
```

## Project structure

```
/package.json
/server.js
/db.js
/utils/
  date.js
  sanitize.js
/public/js/main.js
/views/
  layout.ejs
  login.ejs
  public.ejs
  user.ejs
  dashboard.ejs
  /partials
    flash.ejs
    header.ejs
/scripts/seed.js
/data/
```

## Environment variables

- `PORT` – server port (default `3000`)
- `SESSION_SECRET` – overrides the cookie-session secret (recommended in production)

## Notes

- Tailwind CSS is loaded via CDN. No build step required.
- All user-provided text is sanitized before rendering. URLs are linkified safely.
- Dates and streak calculations use UTC day boundaries.
