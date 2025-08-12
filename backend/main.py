from fastapi import FastAPI, Depends, HTTPException, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
from sqlalchemy.orm import Session
from models import LoopedVideo, Base
from schemas import LoopedVideoCreate, LoopedVideoResponse, FavoriteUpdate
import uuid

from sqlalchemy import create_engine, desc
from sqlalchemy.orm import sessionmaker

from dotenv import load_dotenv
import os
from datetime import datetime

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./database.db")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.create_all(bind=engine)


app = FastAPI(title="YouTube Song Looper API", version="1.0.0")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Anonymous cookie-based user id
COOKIE_NAME = "anon_uid"
COOKIE_MAX_AGE = 60 * 60 * 24 * 365  # 1 year

def get_user_id(request: Request, response: Response) -> str:
    uid = request.cookies.get(COOKIE_NAME)
    if not uid:
        uid = str(uuid.uuid4())
        response.set_cookie(
            key=COOKIE_NAME,
            value=uid,
            max_age=COOKIE_MAX_AGE,
            samesite="lax",
            secure=False,   # set True when behind HTTPS
            httponly=True,
        )
    return uid

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Hello, World!"}

@app.get("/api/looped-songs", response_model=List[LoopedVideoResponse])
def get_looped_songs(sort: Optional[str] = None, db: Session = Depends(get_db), user_id: str = Depends(get_user_id)):
    q = db.query(LoopedVideo).filter(LoopedVideo.user_id == user_id, LoopedVideo.is_deleted == False)
    # Always show favorites first
    order_cols = [desc(LoopedVideo.is_favorite)]
    if sort == "recent":
        order_cols.append(desc(LoopedVideo.last_played_at))
    elif sort == "plays":
        order_cols.append(desc(LoopedVideo.play_count))
    else:
        order_cols.append(desc(LoopedVideo.created_at))
    q = q.order_by(*order_cols)
    return q.all()

# function to save looped song to database for user to keep track of their looped songs 
@app.post("/api/saveloopedsong", response_model=LoopedVideoResponse)
def save_looped_song(song: LoopedVideoCreate, db: Session = Depends(get_db), user_id: str = Depends(get_user_id)):
    # Look up regardless of deletion state so we can restore if needed
    existing = db.query(LoopedVideo).filter(
        LoopedVideo.video_id == song.video_id,
        LoopedVideo.user_id == user_id,
    ).first()

    now = datetime.utcnow()

    if existing:
        # If this row was soft-deleted, restore it and preserve attributes
        if existing.is_deleted:
            existing.is_deleted = False
            existing.last_played_at = now
            if song.title:
                existing.title = song.title
            if song.loop_duration:
                existing.loop_duration = song.loop_duration
            db.commit()
            db.refresh(existing)
            return existing
        # Normal upsert/update path for active rows
        existing.play_count = (existing.play_count or 0) + 1
        existing.last_played_at = now
        if song.title:
            existing.title = song.title
        if song.loop_duration:
            existing.loop_duration = song.loop_duration
        db.commit()
        db.refresh(existing)
        return existing
    
    # No existing row found: create new
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
def set_favorite(video_id: str, payload: FavoriteUpdate, db: Session = Depends(get_db), user_id: str = Depends(get_user_id)):
    item = db.query(LoopedVideo).filter(LoopedVideo.video_id == video_id, LoopedVideo.user_id == user_id, LoopedVideo.is_deleted == False).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    item.is_favorite = bool(payload.is_favorite)
    db.commit()
    db.refresh(item)
    return item

@app.delete("/api/looped-songs/{video_id}", status_code=204)
def soft_delete_looped_song(video_id: str, db: Session = Depends(get_db), user_id: str = Depends(get_user_id)):
    """Soft-delete a single history entry for the given (user_id, video_id)."""
    item = db.query(LoopedVideo).filter(
        LoopedVideo.video_id == video_id,
        LoopedVideo.user_id == user_id,
        LoopedVideo.is_deleted == False,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.is_deleted = True
    db.commit()
    return Response(status_code=204)

@app.patch("/api/looped-songs/{video_id}/restore", response_model=LoopedVideoResponse)
def restore_looped_song(video_id: str, db: Session = Depends(get_db), user_id: str = Depends(get_user_id)):
    item = db.query(LoopedVideo).filter(
        LoopedVideo.video_id == video_id,
        LoopedVideo.user_id == user_id,
        LoopedVideo.is_deleted == True,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.is_deleted = False
    db.commit()
    db.refresh(item)
    return item