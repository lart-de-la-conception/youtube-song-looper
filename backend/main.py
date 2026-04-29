from fastapi import FastAPI, Depends, HTTPException, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, List, Optional
from sqlalchemy.orm import Session

# Allow running as either `backend.main` (repo root) or `main` (inside backend/)
try:
    from backend.models import LoopedVideo, Base
    from backend.schemas import LoopedVideoCreate, LoopedVideoResponse, FavoriteUpdate
except ImportError:  # running from backend/ as top-level module
    from models import LoopedVideo, Base
    from schemas import LoopedVideoCreate, LoopedVideoResponse, FavoriteUpdate

import uuid
from datetime import datetime, UTC
import os

from sqlalchemy import create_engine, desc
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool
from dotenv import load_dotenv


load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./database.db")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
USE_SUPABASE_REST = bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "").split(",")
    if origin.strip()
]
ALLOWED_ORIGINS = list(dict.fromkeys([FRONTEND_ORIGIN, *FRONTEND_ORIGINS]))
LOCAL_DEV_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

supabase = None
if USE_SUPABASE_REST:
    try:
        from supabase import create_client
    except ImportError as exc:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, but `supabase` is not installed."
        ) from exc
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

SessionLocal = None
if not USE_SUPABASE_REST:
    # Build engine arguments based on the configured database.
    connect_args: dict = {}
    engine_kwargs: dict = {}

    if DATABASE_URL.startswith("sqlite"):
        # Required for SQLite when used across threads (FastAPI request workers).
        connect_args["check_same_thread"] = False
    elif DATABASE_URL.startswith("postgresql"):
        # Supabase exposes Postgres via Supavisor at port 6543 in transaction mode,
        # which is the recommended URL for IPv4-only hosts and short-lived
        # connections. Transaction-mode poolers can't safely keep server-side
        # prepared statements or long-lived client connections, so:
        #   - disable prepared statement caching (psycopg `prepare_threshold=None`)
        #   - use NullPool so we don't hold idle connections through the pooler
        if ":6543" in DATABASE_URL:
            connect_args["prepare_threshold"] = None
            engine_kwargs["poolclass"] = NullPool

    engine = create_engine(DATABASE_URL, connect_args=connect_args, **engine_kwargs)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)


app = FastAPI(title="YouTube Song Looper API", version="1.0.0")


def get_db():
    if USE_SUPABASE_REST:
        yield None
        return

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _require_db(db: Optional[Session]) -> Session:
    if db is None:
        raise HTTPException(status_code=500, detail="Database session unavailable")
    return db


def _supabase_table():
    if supabase is None:
        raise RuntimeError("Supabase client is not configured")
    return supabase.table("looped_videos")


def _supabase_get_item(user_id: str, video_id: str, is_deleted: Optional[bool] = None):
    query = _supabase_table().select("*").eq("user_id", user_id).eq("video_id", video_id)
    if is_deleted is not None:
        query = query.eq("is_deleted", is_deleted)
    data = query.limit(1).execute().data or []
    return data[0] if data else None


def _supabase_update_item(
    user_id: str, video_id: str, payload: dict[str, Any], is_deleted: Optional[bool] = None
):
    query = _supabase_table().update(payload).eq("user_id", user_id).eq("video_id", video_id)
    if is_deleted is not None:
        query = query.eq("is_deleted", is_deleted)
    data = query.execute().data or []
    return data[0] if data else None


# Anonymous cookie-based user id
COOKIE_NAME = "anon_uid"
COOKIE_MAX_AGE = 60 * 60 * 24 * 365  # 1 year
# In production, set COOKIE_SECURE=true so the cookie is only sent over HTTPS.
# For local development keep it false via backend/.env (do not change code).
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
# SameSite policy:
# - In dev (HTTP, same-site) "lax" is fine.
# - In production the frontend and backend usually live on different domains,
#   which requires SameSite=none (with Secure) for the cookie to be sent at all.
# Default to "none" whenever COOKIE_SECURE=true so production setups don't
# silently lose the anonymous user_id between visits.
_DEFAULT_SAMESITE = "none" if COOKIE_SECURE else "lax"
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", _DEFAULT_SAMESITE).lower()
if COOKIE_SAMESITE not in {"lax", "none", "strict"}:
    COOKIE_SAMESITE = _DEFAULT_SAMESITE
# Browsers reject SameSite=None without Secure. If misconfigured, fall back to
# "lax" so cookies still work in dev rather than being silently dropped.
if COOKIE_SAMESITE == "none" and not COOKIE_SECURE:
    COOKIE_SAMESITE = "lax"


def get_user_id(request: Request, response: Response) -> str:
    uid = request.cookies.get(COOKIE_NAME)
    if not uid:
        uid = str(uuid.uuid4())
        response.set_cookie(
            key=COOKIE_NAME,
            value=uid,
            max_age=COOKIE_MAX_AGE,
            samesite=COOKIE_SAMESITE,  # "none" for cross-site (requires Secure)
            secure=COOKIE_SECURE,  # true in prod (HTTPS), false in local dev
            httponly=True,
        )
    return uid


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=LOCAL_DEV_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    return {"message": "Hello, World!"}


@app.get("/api/looped-songs", response_model=List[LoopedVideoResponse])
def get_looped_songs(
    sort: Optional[str] = None,
    db: Optional[Session] = Depends(get_db),
    user_id: str = Depends(get_user_id),
):
    if USE_SUPABASE_REST:
        try:
            order_col = {
                "recent": "last_played_at",
                "plays": "play_count",
            }.get(sort or "", "created_at")
            data = (
                _supabase_table()
                .select("*")
                .eq("user_id", user_id)
                .eq("is_deleted", False)
                .order("is_favorite", desc=True)
                .order(order_col, desc=True)
                .execute()
                .data
                or []
            )
            return data
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Failed to load history") from exc

    db = _require_db(db)
    q = db.query(LoopedVideo).filter(
        LoopedVideo.user_id == user_id,
        LoopedVideo.is_deleted.is_(False),
    )
    order_cols = [desc(LoopedVideo.is_favorite)]
    if sort == "recent":
        order_cols.append(desc(LoopedVideo.last_played_at))
    elif sort == "plays":
        order_cols.append(desc(LoopedVideo.play_count))
    else:
        order_cols.append(desc(LoopedVideo.created_at))
    q = q.order_by(*order_cols)
    return q.all()


@app.post("/api/saveloopedsong", response_model=LoopedVideoResponse)
def save_looped_song(
    song: LoopedVideoCreate,
    db: Optional[Session] = Depends(get_db),
    user_id: str = Depends(get_user_id),
):
    now = _now_utc()

    if USE_SUPABASE_REST:
        try:
            existing = _supabase_get_item(user_id=user_id, video_id=song.video_id)
            if existing:
                if bool(existing.get("is_deleted")):
                    updated = _supabase_update_item(
                        user_id=user_id,
                        video_id=song.video_id,
                        payload={
                            "is_deleted": False,
                            "last_played_at": now.isoformat(),
                            "title": song.title,
                            "loop_duration": song.loop_duration,
                        },
                    )
                else:
                    updated = _supabase_update_item(
                        user_id=user_id,
                        video_id=song.video_id,
                        payload={
                            "play_count": int(existing.get("play_count") or 0) + 1,
                            "last_played_at": now.isoformat(),
                            "title": song.title,
                            "loop_duration": song.loop_duration,
                        },
                    )
                if not updated:
                    raise HTTPException(status_code=500, detail="Failed to update item")
                return updated

            created = (
                _supabase_table()
                .insert(
                    {
                        "id": str(uuid.uuid4()),
                        "video_id": song.video_id,
                        "title": song.title,
                        "loop_duration": song.loop_duration,
                        "user_id": user_id,
                        "play_count": 1,
                        "created_at": now.isoformat(),
                        "last_played_at": now.isoformat(),
                        "is_favorite": False,
                        "is_deleted": False,
                    }
                )
                .execute()
                .data
                or []
            )
            if not created:
                raise HTTPException(status_code=500, detail="Failed to create item")
            return created[0]
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Failed to save history item") from exc

    db = _require_db(db)
    existing = db.query(LoopedVideo).filter(
        LoopedVideo.video_id == song.video_id,
        LoopedVideo.user_id == user_id,
    ).first()

    if existing:
        if existing.is_deleted:
            existing.is_deleted = False
            existing.last_played_at = now
            existing.title = song.title
            existing.loop_duration = song.loop_duration
            db.commit()
            db.refresh(existing)
            return existing
        existing.play_count = (existing.play_count or 0) + 1
        existing.last_played_at = now
        existing.title = song.title
        existing.loop_duration = song.loop_duration
        db.commit()
        db.refresh(existing)
        return existing

    db_song = LoopedVideo(
        id=str(uuid.uuid4()),
        video_id=song.video_id,
        title=song.title,
        loop_duration=song.loop_duration,
        user_id=user_id,
        play_count=1,
        last_played_at=now,
        is_deleted=False,
    )
    db.add(db_song)
    db.commit()
    db.refresh(db_song)
    return db_song


@app.patch("/api/looped-songs/{video_id}/favorite", response_model=LoopedVideoResponse)
def set_favorite(
    video_id: str,
    payload: FavoriteUpdate,
    db: Optional[Session] = Depends(get_db),
    user_id: str = Depends(get_user_id),
):
    if USE_SUPABASE_REST:
        try:
            item = _supabase_update_item(
                user_id=user_id,
                video_id=video_id,
                payload={"is_favorite": bool(payload.is_favorite)},
                is_deleted=False,
            )
            if not item:
                raise HTTPException(status_code=404, detail="Item not found")
            return item
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Failed to update favorite") from exc

    db = _require_db(db)
    item = db.query(LoopedVideo).filter(
        LoopedVideo.video_id == video_id,
        LoopedVideo.user_id == user_id,
        LoopedVideo.is_deleted.is_(False),
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    item.is_favorite = bool(payload.is_favorite)
    db.commit()
    db.refresh(item)
    return item


@app.delete("/api/looped-songs/{video_id}", status_code=204)
def soft_delete_looped_song(
    video_id: str,
    db: Optional[Session] = Depends(get_db),
    user_id: str = Depends(get_user_id),
):
    """Soft-delete a single history entry for the given (user_id, video_id)."""
    if USE_SUPABASE_REST:
        try:
            item = _supabase_update_item(
                user_id=user_id,
                video_id=video_id,
                payload={"is_deleted": True},
                is_deleted=False,
            )
            if not item:
                raise HTTPException(status_code=404, detail="Item not found")
            return Response(status_code=204)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Failed to delete history item") from exc

    db = _require_db(db)
    item = db.query(LoopedVideo).filter(
        LoopedVideo.video_id == video_id,
        LoopedVideo.user_id == user_id,
        LoopedVideo.is_deleted.is_(False),
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.is_deleted = True
    db.commit()
    return Response(status_code=204)


@app.patch("/api/looped-songs/{video_id}/restore", response_model=LoopedVideoResponse)
def restore_looped_song(
    video_id: str,
    db: Optional[Session] = Depends(get_db),
    user_id: str = Depends(get_user_id),
):
    if USE_SUPABASE_REST:
        try:
            item = _supabase_update_item(
                user_id=user_id,
                video_id=video_id,
                payload={"is_deleted": False},
                is_deleted=True,
            )
            if not item:
                raise HTTPException(status_code=404, detail="Item not found")
            return item
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Failed to restore history item") from exc

    db = _require_db(db)
    item = db.query(LoopedVideo).filter(
        LoopedVideo.video_id == video_id,
        LoopedVideo.user_id == user_id,
        LoopedVideo.is_deleted.is_(True),
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.is_deleted = False
    db.commit()
    db.refresh(item)
    return item