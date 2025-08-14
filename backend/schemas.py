from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime

class LoopedVideoCreate(BaseModel):
    video_id: str
    title: str
    loop_duration: int
    user_id: Optional[str] = None

class FavoriteUpdate(BaseModel):
    is_favorite: bool

class LoopedVideoResponse(BaseModel):
    id: str
    video_id: str
    title: str
    loop_duration: int
    user_id: Optional[str] = None
    play_count: int
    created_at: datetime
    last_played_at: datetime
    is_favorite: bool
    is_deleted: bool

    # Pydantic v2: enable SQLAlchemy ORM compatibility
    model_config = ConfigDict(from_attributes=True)