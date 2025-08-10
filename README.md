# YouTube Song Looper

A minimal Next.js + FastAPI app to loop YouTube songs in the browser with quick history access.

## Features
- Paste a YouTube URL or pick from a title dropdown (native datalist)
- Loop a song for a chosen duration; accurate timer that pauses/resumes
- History panel (right side): favorites first, sort by most recent, play count, or recently added
- One‑click re‑loop from history (increments play count)
- Favorite/unfavorite songs (idempotent API)

## Tech
- Frontend: Next.js (App Router), React, Tailwind, react-youtube
- Backend: FastAPI, SQLAlchemy, SQLite

## API (FastAPI)
- POST `/api/saveloopedsong`
  - Body: `{ video_id: string, title: string, loop_duration: number, user_id?: string }`
  - Upsert by `(user_id, video_id)`; increments `play_count`, updates `last_played_at`
- GET `/api/looped-songs?sort=recent|plays`
  - Favorites always appear first; `recent` uses `last_played_at`, `plays` uses `play_count`, default is `created_at`
- PATCH `/api/looped-songs/{video_id}/favorite`
  - Body: `{ is_favorite: boolean }` (idempotent)

Response object (subset):
```
{
  id, video_id, title, loop_duration, user_id,
  play_count, created_at, last_played_at, is_favorite
}
```

## Local development
Backend
```
cd backend
python -m venv venv
source venv/bin/activate  
pip install -r requirements.txt
uvicorn main:app --reload
```

Frontend
```
cd frontend
npm install
npm run dev
```

## Notes
- Anonymous users: currently using `user_id` provided by the client (temporary). Future plan: server‑issued anonymous cookie, optional account signup (email/OAuth) with migration.
- SQLite schema changes may require recreating `database.db` during development.

## References
- react-youtube: https://github.com/tjallingt/react-youtube
- YouTube IFrame Player API: https://developers.google.com/youtube/iframe_api_reference
- FastAPI: https://fastapi.tiangolo.com/
