from fastapi import FastAPI, Depends
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


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Hello, World!"}

@app.get("/api/looped-songs", response_model=List[LoopedVideoResponse])
def get_looped_songs(sort: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(LoopedVideo)
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
def save_looped_song(song: LoopedVideoCreate, db: Session = Depends(get_db)):
    existing = db.query(LoopedVideo).filter(
        LoopedVideo.video_id == song.video_id,
        LoopedVideo.user_id == song.user_id
    ).first()

    now = datetime.utcnow()

    if existing:
        existing.play_count = (existing.play_count or 0) + 1
        existing.last_played_at = now
        if song.title:
            existing.title = song.title
        if song.loop_duration:
            existing.loop_duration = song.loop_duration
        db.commit()
        db.refresh(existing)
        return existing
    
    db_song = LoopedVideo(
        id=str(uuid.uuid4()),
        video_id=song.video_id,
        title=song.title,
        loop_duration=song.loop_duration,
        user_id=song.user_id,
        play_count=1,
        last_played_at=now,
    )
    db.add(db_song)
    db.commit()
    db.refresh(db_song)
    return db_song

@app.patch("/api/looped-songs/{video_id}/favorite", response_model=LoopedVideoResponse)
def set_favorite(video_id: str, payload: FavoriteUpdate, user_id: Optional[str] = None, db: Session = Depends(get_db)):
    item = db.query(LoopedVideo).filter(LoopedVideo.video_id == video_id, LoopedVideo.user_id == user_id).first()
    if not item:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Item not found")
    
    item.is_favorite = bool(payload.is_favorite)
    db.commit()
    db.refresh(item)
    return item