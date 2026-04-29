# YouTube Song Looper

A minimal Next.js + FastAPI app to loop YouTube songs in the browser with quick history access.

## Features
- Paste a YouTube URL
- Loop a song for a chosen duration; accurate timer that pauses/resumes
- History panel (favorites first) with sort by most recent, play count, or recently added
- One‑click re‑loop from history (increments play count)
- Favorite/unfavorite songs (idempotent API)

## Tech
- Frontend: Next.js (App Router), React, Tailwind, react-youtube, Jest + Testing Library
- Backend: FastAPI, SQLAlchemy, SQLite (v1)

## API (FastAPI)
- POST `/api/saveloopedsong`
  - Body: `{ video_id: string, title: string, loop_duration: number }`
  - Upsert by anonymous `user_id` (server cookie) + `video_id`; increments `play_count`, updates `last_played_at`
- GET `/api/looped-songs?sort=recent|plays`
  - Favorites always first; `recent` uses `last_played_at`, `plays` uses `play_count`, default is `created_at`
- PATCH `/api/looped-songs/{video_id}/favorite`
  - Body: `{ is_favorite: boolean }` (idempotent)
- DELETE `/api/looped-songs/{video_id}` soft‑deletes a single history entry
- PATCH `/api/looped-songs/{video_id}/restore` restores a soft‑deleted entry

Response object (subset):
```
{
  id, video_id, title, loop_duration,
  play_count, created_at, last_played_at, is_favorite
}
```

## Environment variables

### Frontend
- `NEXT_PUBLIC_API_URL` — Base URL of the backend API
  - Development: `http://localhost:8000`
  - Production: `https://api.your-domain.com`

### Backend
- `DATABASE_URL` — e.g. `sqlite:///./database.db` (local dev) or `postgresql+psycopg://USER:PASSWORD@HOST:PORT/DBNAME` (production)
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — optional alternative to `DATABASE_URL`. If both are set, backend uses Supabase REST (`supabase-py`) instead of SQLAlchemy DB connections.
- `FRONTEND_ORIGIN` — e.g. `http://localhost:3000` (dev) or `https://your-frontend.com` (prod)
- `FRONTEND_ORIGINS` — optional, comma-separated list of additional allowed origins (e.g. preview deployments)
- `COOKIE_SECURE` — `false` in dev, `true` in production (enables secure cookies over HTTPS)
- `COOKIE_SAMESITE` — usually unset. Defaults to `none` automatically when `COOKIE_SECURE=true` so cross-site cookies are sent in production. Override only if you really know you want `lax` or `strict`.

> Tip: Check in a `.env.example` illustrating the above. For local dev, use `.env` in `backend/` and `.env.development` / `.env.production` in `frontend/`.

## Local development

### Backend
```
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend
```
cd frontend
npm install
npm run dev
```

### Tests
- Frontend (Jest + RTL)
```
cd frontend
npm test
```
- Backend (pytest)
```
cd backend
pytest -q
```

## Production deployment

Recommended stack:
- Frontend on any static/SSR host (Vercel/Netlify/etc.).
- Backend on any container or process host (Render/Fly.io/Railway/etc.).
- Database on a managed Postgres provider (Supabase/Neon/Render Postgres/etc.).

### Backend
- Build: `pip install -r requirements.txt`
- Start: `uvicorn main:app --host 0.0.0.0 --port 8000`
- Env vars:
  - `DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:PORT/DBNAME`
  - `FRONTEND_ORIGIN=https://your-frontend.com`
  - `COOKIE_SECURE=true`
  - (optional) `FRONTEND_ORIGINS=https://preview-1.your-frontend.com,https://preview-2.your-frontend.com`

### Frontend
- Root: `frontend`
- Build: `npm run build`
- Env: `NEXT_PUBLIC_API_URL=https://your-backend-domain`

### CORS & cookies
- Backend enables CORS for `FRONTEND_ORIGIN` (plus any `FRONTEND_ORIGINS`) and sets an anonymous cookie to identify the user across visits.
- The frontend must send credentials (it does — `axios.defaults.withCredentials = true` and `fetch(..., { credentials: 'include' })`).
- In production over HTTPS, set `COOKIE_SECURE=true`. `COOKIE_SAMESITE` will default to `none` automatically so the cookie works cross-site.
- If history "disappears" between visits in production, the cookie is almost always the cause: check `COOKIE_SECURE`, HTTPS, and that the frontend is actually hitting the configured backend domain.

## Database

### Local development (SQLite)
Use the default `DATABASE_URL=sqlite:///./database.db`. The schema is created automatically on startup via `Base.metadata.create_all`.

### Production (Postgres on Supabase)

1. Create a Supabase project. The Postgres database is provisioned automatically.
2. In the Supabase dashboard, go to **Project Settings → Database → Connection string**, then copy the **Connection pooler** string in **Transaction mode** (it ends in `:6543/postgres`). Prefer the pooler over the direct connection — it works from IPv4-only hosts and is the right choice for an API that scales to zero.
3. Convert the URL prefix to use the bundled driver: replace `postgresql://` with `postgresql+psycopg://`. The final value should look like:
   ```
   postgresql+psycopg://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
   ```
4. Set `DATABASE_URL` on the backend host to that string.
5. Start the backend. The schema is created automatically the first time it connects (`Base.metadata.create_all`).
6. Keep `FRONTEND_ORIGIN` and `NEXT_PUBLIC_API_URL` pointing to your deployed domains.

The backend automatically detects the transaction pooler (port `6543`) and:
- disables prepared-statement caching, which Supavisor in transaction mode does not support;
- uses `NullPool` so it doesn't hold idle connections through the pooler.

If you ever want a direct connection instead (port `5432`), you don't need any code changes — just update `DATABASE_URL`. The pooler is recommended unless you specifically need session-level features.

### Alternative: Supabase REST (no DB socket connection)
If your host/network has trouble with direct Postgres connections, you can skip `DATABASE_URL` and use Supabase's HTTP API from the backend:

```
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

When both are set, backend uses `supabase-py` for all history CRUD operations and does not create a SQLAlchemy engine.

> Important: do not store the database inside the same ephemeral container as the backend. Managed Postgres persists across redeploys; an SQLite file on a non-persistent disk does not. Losing history after a deploy almost always means the database disk was wiped.

### Other Postgres providers
The same setup works for Neon, Render Postgres, Railway, etc. Use the connection string they give you, prefix it with `postgresql+psycopg://`, and set it as `DATABASE_URL`. No further code changes are required.

### Migrations
Schema is currently created via `Base.metadata.create_all` on startup. That is fine for a stable schema but does not perform `ALTER`s. When the schema starts changing in production, introduce Alembic for migrations.

## References
- react-youtube: https://github.com/tjallingt/react-youtube
- YouTube IFrame Player API: https://developers.google.com/youtube/iframe_api_reference
- FastAPI: https://fastapi.tiangolo.com/
