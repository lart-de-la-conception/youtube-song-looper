import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import app, get_db, get_user_id
from backend.models import Base

# In-memory SQLite shared across threads for TestClient
engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

@pytest.fixture
def db_session():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

@pytest.fixture
def client(db_session):
    # Override dependencies: DB and user_id (cookie-less for tests)
    def override_get_db():
        try:
            yield db_session
        finally:
            pass
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_user_id] = lambda: "test-user-1"
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()

def test_save_and_list(client):
    """Create one item via POST, then GET list and verify shape and values."""
    # Save a new video and ensure the API returns 200 OK
    r = client.post("/api/saveloopedsong", json={
        "video_id": "abc123def45",
        "title": "Song A",
        "loop_duration": 10
    })
    assert r.status_code == 200, f"POST /api/saveloopedsong failed: {r.text}"

    # Fetch list and verify it contains exactly one item with expected fields
    r = client.get("/api/looped-songs")
    items = r.json()
    assert isinstance(items, list), "GET /api/looped-songs did not return a list"
    assert len(items) == 1, f"Expected 1 item, got {len(items)}: {items}"
    item = items[0]
    # Descriptive checks
    assert item["video_id"] == "abc123def45", f"video_id mismatch: {item}"
    assert item["title"] == "Song A", f"title mismatch: {item}"
    assert item["loop_duration"] == 10, f"loop_duration mismatch: {item}"
    assert item["play_count"] >= 1, f"play_count expected >=1: {item}"

def test_upsert_increments_play_count(client):
    """Saving the same (user_id, video_id) twice should increment play_count."""
    client.post("/api/saveloopedsong", json={"video_id": "v1", "title": "A", "loop_duration": 5})
    client.post("/api/saveloopedsong", json={"video_id": "v1", "title": "A", "loop_duration": 5})
    items = client.get("/api/looped-songs").json()
    assert items[0]["video_id"] == "v1"
    assert items[0]["play_count"] == 2, f"expected play_count=2 got {items[0]}"

def test_soft_delete_and_list_excludes(client):
    """Soft-deleted items should not appear in GET /api/looped-songs."""
    client.post("/api/saveloopedsong", json={"video_id": "v2", "title": "B", "loop_duration": 7})
    r = client.delete("/api/looped-songs/v2")
    assert r.status_code == 204
    items = client.get("/api/looped-songs").json()
    assert all(i["video_id"] != "v2" for i in items), f"deleted item still listed: {items}"

def test_restore_soft_deleted_preserves_play_count(client):
    """Restoring a soft-deleted item should not change its accumulated play_count."""
    client.post("/api/saveloopedsong", json={"video_id": "v3", "title": "C", "loop_duration": 3})
    client.delete("/api/looped-songs/v3")
    # Restore should NOT increment play_count
    r = client.patch("/api/looped-songs/v3/restore")
    assert r.status_code == 200
    item = client.get("/api/looped-songs").json()[0]
    assert item["video_id"] == "v3"
    assert item["play_count"] == 1, f"restore should preserve play_count: {item}"

def test_set_favorite_idempotent_and_pinned_first(client):
    """PATCH favorite is idempotent and favorites are ordered first in listings."""
    client.post("/api/saveloopedsong", json={"video_id": "v4", "title": "D", "loop_duration": 4})
    client.post("/api/saveloopedsong", json={"video_id": "v5", "title": "E", "loop_duration": 4})
    r = client.patch("/api/looped-songs/v5/favorite", json={"is_favorite": True})
    assert r.status_code == 200 and r.json()["is_favorite"] is True
    # Setting same value again keeps true (idempotent)
    r = client.patch("/api/looped-songs/v5/favorite", json={"is_favorite": True})
    assert r.status_code == 200 and r.json()["is_favorite"] is True
    items = client.get("/api/looped-songs").json()
    assert items[0]["video_id"] == "v5", f"favorites should be pinned first: {items}"

def test_sorting_recent_and_plays(client):
    """Verify sorting by recent last_played and by play_count works as specified."""
    # v6 with higher play_count
    client.post("/api/saveloopedsong", json={"video_id": "v6", "title": "F", "loop_duration": 4})
    client.post("/api/saveloopedsong", json={"video_id": "v6", "title": "F", "loop_duration": 4})
    # v7 played most recently
    client.post("/api/saveloopedsong", json={"video_id": "v7", "title": "G", "loop_duration": 4})
    items_recent = client.get("/api/looped-songs", params={"sort": "recent"}).json()
    assert items_recent[0]["video_id"] == "v7", f"recent sort should put last_played first: {items_recent}"
    items_plays = client.get("/api/looped-songs", params={"sort": "plays"}).json()
    assert items_plays[0]["video_id"] == "v6", f"plays sort should put highest play_count first: {items_plays}"

def test_validation_422_on_missing_fields(client):
    """Invalid payloads should be rejected by FastAPI validation with 422 status."""
    r = client.post("/api/saveloopedsong", json={"video_id": "bad"})
    assert r.status_code == 422

def test_update_title_and_duration_on_save(client):
    """Subsequent save of same video updates mutable fields like title and duration."""
    client.post("/api/saveloopedsong", json={"video_id": "v8", "title": "Old", "loop_duration": 5})
    client.post("/api/saveloopedsong", json={"video_id": "v8", "title": "New", "loop_duration": 9})
    item = client.get("/api/looped-songs").json()[0]
    assert item["title"] == "New" and item["loop_duration"] == 9

def test_delete_nonexistent_returns_404(client):
    """Deleting a non-existent item should return 404 Not Found."""
    r = client.delete("/api/looped-songs/does-not-exist")
    assert r.status_code == 404

def test_favorite_nonexistent_returns_404(client):
    """Favoriting a non-existent item should return 404 Not Found."""
    r = client.patch("/api/looped-songs/does-not-exist/favorite", json={"is_favorite": True})
    assert r.status_code == 404

def test_per_user_isolation(db_session):
    """Items are isolated by cookie-derived user_id; users cannot see each other's items."""
    # client for user A
    def override_db():
        try: yield db_session
        finally: pass
    app.dependency_overrides[get_db] = override_db

    app.dependency_overrides[get_user_id] = lambda: "user-A"
    with TestClient(app) as client_a:
        client_a.post("/api/saveloopedsong", json={"video_id": "vx", "title": "X", "loop_duration": 5})
        a_items = client_a.get("/api/looped-songs").json()
        assert len(a_items) == 1

    # client for user B
    app.dependency_overrides[get_user_id] = lambda: "user-B"
    with TestClient(app) as client_b:
        b_items = client_b.get("/api/looped-songs").json()
        assert b_items == [], f"user-B should not see user-A items: {b_items}"

    app.dependency_overrides.clear()