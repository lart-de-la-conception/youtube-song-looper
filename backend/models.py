from sqlalchemy import Column, Integer, String, DateTime, UniqueConstraint, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func

Base = declarative_base()

class LoopedVideo(Base):
    __tablename__ = "looped_videos"
    __table_args__ = (
        UniqueConstraint("user_id", "video_id", name="uq_user_video"),
    )
    
    id = Column(String, primary_key=True, index=True)
    video_id = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    loop_duration = Column(Integer, nullable=False) # in minutes
    created_at = Column(DateTime(timezone=True), default=func.now())
    last_played_at = Column(DateTime(timezone=True), default=func.now())
    user_id = Column(String, nullable=True, index=True)
    play_count = Column(Integer, default=1)
    is_favorite = Column(Boolean, default=False, nullable=False, index=True)

