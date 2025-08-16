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
- `DATABASE_URL` — e.g. `sqlite:///./database.db` (v1) or `postgresql+psycopg://...` (later)
- `FRONTEND_ORIGIN` — e.g. `http://localhost:3000` (dev) or `https://your-frontend.com` (prod)
- `COOKIE_SECURE` — `false` in dev, `true` in production (enables secure cookies over HTTPS)

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

## Minimal deployment (v1 with SQLite)

This setup is suitable for low traffic and a single backend instance.

### Backend 
- Build: `pip install -r requirements.txt`
- Start: `uvicorn main:app --host 0.0.0.0 --port 8000`
- Env vars:
  - `DATABASE_URL=sqlite:////data/app.db` (mount a persistent volume at `/data`)
  - `FRONTEND_ORIGIN=https://your-frontend.com`
  - `COOKIE_SECURE=true`

### Frontend 
- Root: `frontend`
- Build: `npm run build`
- Env: `NEXT_PUBLIC_API_URL=https://your-backend-domain`

### CORS & cookies
- Backend enables CORS for `FRONTEND_ORIGIN` and sets an anonymous cookie to track user history.
- In production ensure HTTPS and `COOKIE_SECURE=true`.

## Migrating to Postgres later
1) Provision a managed Postgres (Supabase/Neon/Render DB) and set `DATABASE_URL`.
2) Run the backend with the new env; use a migration tool like Alembic when schema evolves.
3) Keep `FRONTEND_ORIGIN` and `NEXT_PUBLIC_API_URL` pointing to your deployed domains.

## References
- react-youtube: https://github.com/tjallingt/react-youtube
- YouTube IFrame Player API: https://developers.google.com/youtube/iframe_api_reference
- FastAPI: https://fastapi.tiangolo.com/
