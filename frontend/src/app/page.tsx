'use client';
import React, { useState, useEffect, useRef } from 'react';
import YouTube from 'react-youtube';  
import { MdHistory, MdStar, MdStarBorder, MdDelete } from 'react-icons/md';
import axios from 'axios';
import Toast, { ToastItem } from '@/components/Toast';


type LoopedSong = {
  id: string;
  video_id: string;
  title: string;
  loop_duration: number;
  user_id?: string | null;
  play_count?: number;
  created_at?: string;
  is_favorite?: boolean;
};

export default function Home() {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [urlInputText, setUrlInputText] = useState('');
  const [loopMinutes, setLoopMinutes] = useState('');
  const [submittedLoopMinutes, setSubmittedLoopMinutes] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [loopStartTime, setLoopStartTime] = useState<number | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  // fixing the issue where the elapsed time does not reflect when the video is paused
  const [videoPaused, setVideoPaused] = useState(false);
  const [timePassed, setTimePassed] = useState(0); 
  const [elapsedTime, setElapsedTime] = useState(0);
  const [error, setError] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  // saving state for submit
  const [isSaving, setIsSaving] = useState(false);
  // toast state
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // toast helper
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t, { id, type, text }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 2500);
  };

  // BATCH UNDO - to restore state after a delete operation(s)
  // how long the user can undo after delete (in ms)
  const UNDO_MS = 10000;

  type PendingEntry = {
    item: LoopedSong;
    timer: number;       // setTimeout id
    expires: number;     // Date.now() + UNDO_MS
  };

  // key by video_id
  const [pendingUndos, setPendingUndos] = useState<Record<string, PendingEntry>>({});

  // Undo all pending deletes: clear timers, recreate rows, refresh
  const undoAllDeletes = async () => {
    const entries = Object.values(pendingUndos);
    if (entries.length === 0) return;
    // stop scheduled expirations
    entries.forEach((e) => clearTimeout(e.timer));
    try {
      await Promise.all(
        entries.map((e) =>
          axios.patch(`http://localhost:8000/api/looped-songs/${e.item.video_id}/restore`, null, { params: { user_id: '' } })
        )
      );
      setPendingUndos({});
      await refreshHistoryWithCurrentSort();
      showToast('Restored item(s)', 'success');
    } catch (err) {
      console.error('Failed to restore items:', err);
      showToast('Could not restore items', 'error');
    }
  };

  // History panel state
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [history, setHistory] = useState<LoopedSong[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'plays' | 'added'>('recent');

  // Ref to the underlying YouTube player instance
  const playerRef = useRef<any | null>(null);

  const loopDurationMs = Number(loopMinutes) > 0 ? Number(loopMinutes) * 60 * 1000 : 0; // Convert minutes to milliseconds for easier comparison

  // Refresh history with current sort
  const refreshHistoryWithCurrentSort = async () => {
    const base = 'http://localhost:8000/api/looped-songs';
    const url = sortBy === 'recent' ? `${base}?sort=recent`
      : sortBy === 'plays' ? `${base}?sort=plays`
      : base;
    const res = await fetch(url);
    if (res.ok) setHistory(await res.json());
  };

  // Delete a history item
  const deleteHistoryItem = async (item: LoopedSong) => {
    // optimistic UI
    setHistory(h => h.filter(i => i.video_id !== item.video_id));
    
    try {
      await axios.delete(`http://localhost:8000/api/looped-songs/${item.video_id}`, { params: { user_id: '' } });
      // add to pending undo map
      const expires = Date.now() + UNDO_MS;
      const timer = window.setTimeout(() => {
        // remove from pending once window passes
        setPendingUndos((pendingByVideoId) => {
          const { [item.video_id]: _, ...rest } = pendingByVideoId;
          return rest;
        });
      }, UNDO_MS);
      setPendingUndos((pendingByVideoId) => ({
        ...pendingByVideoId,
        [item.video_id]: { item, timer, expires },
      }));

      // refresh history
      showToast('Removed from history', 'success');
      refreshHistoryWithCurrentSort();
    } catch (err) {
      console.error('Failed to delete history item:', err);
      showToast('Could not remove from history', 'error');
      // restore optimistic UI
      setHistory(h => [...h, item]);
    }
  };

  // Updates elapsed time counter every second while video is looping
  // Resets counter when looping stops or component unmounts
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isLooping && loopStartTime && !videoPaused) {
      interval = setInterval(() => {
        setElapsedTime(timePassed + (Date.now() - loopStartTime));
      }, 1000);
    } else {
      setElapsedTime(timePassed);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLooping, loopStartTime, videoPaused, timePassed]);

  // Fetch history on mount and whenever panel opens (lazy refresh)
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setHistoryLoading(true);
        setHistoryError('');
        const base = 'http://localhost:8000/api/looped-songs';
        const url =
          sortBy === 'recent'
            ? `${base}?sort=recent`
            : sortBy === 'plays'
            ? `${base}?sort=plays`
            : base; // 'added' falls back to default ordering
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch history');
        const data: LoopedSong[] = await res.json();
        setHistory(data);
      } catch (e: any) {
        setHistoryError(e?.message || 'Error fetching history');
      } finally {
        setHistoryLoading(false);
      }
    };
    if (isHistoryOpen) {
      fetchHistory();
    }
  }, [isHistoryOpen, sortBy]);

  /**
   * Extracts the YouTube video ID from a given URL string. Returns the ID if found, otherwise null.
   */
  function extractVideoId(url: string): string | null {
    const regExp = /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([\w-]{11})/;
    const match = url.match(regExp);
    return match ? match[1] : null;
  }

  /**
   * Event handler for when the YouTube player is ready. Records the start time, sets looping state, and starts playing the video.
   */
  const onPlayerReady = (event: any) => {
    // Keep a reference to control the player imperatively
    playerRef.current = event.target;
    setLoopStartTime(Date.now());
    setTimePassed(0); // Reset accumulated time
    setIsLooping(true);
    setElapsedTime(0);
    event.target.playVideo();
    // Refresh history when a video successfully starts
    void refreshHistoryWithCurrentSort();
  };

  // Fixing the issue where the elapsed time does not reflect when the video is paused
  const onPlayerStateChange = (event: any) => {
    if (event.data === 2) { // 2 = paused
      if (loopStartTime) {
        setTimePassed(prev => prev + (Date.now() - loopStartTime));
        setLoopStartTime(null);
      }
      setVideoPaused(true);
    } else if (event.data === 1) { // 1 = playing
      setLoopStartTime(Date.now());
      setVideoPaused(false);
    }
  };
  
  /**
   * Event handler for when the YouTube video ends. If within the loop duration,
   * seeks back to start and continues playing. Otherwise stops looping.
   * Calculates elapsed time since loop started to determine whether to continue.
   */
  const onPlayerEnd = (event: any) => {
    if (loopStartTime == null) return;

    // Duration of the session that just finished
    const sessionMs = Date.now() - loopStartTime;
    const totalMs = timePassed + sessionMs;

    // Prefer submitted duration; fall back to current input
    const targetMs =
      Number(submittedLoopMinutes) > 0
        ? Number(submittedLoopMinutes) * 60 * 1000
        : Number(loopMinutes) > 0
        ? Number(loopMinutes) * 60 * 1000
        : 0;

    // Accumulate the finished session and clear current session start
    setTimePassed((prev) => prev + sessionMs);
    setLoopStartTime(null);

    if (totalMs < targetMs) {
      // Continue looping without resetting the accumulated timer
      event.target.seekTo(0);
      event.target.playVideo();
    } else {
      setIsLooping(false);
    }
  };

  /**
   * Handles the form submission: extracts the video ID from the input URL, sets the video ID state, and marks the form as submitted.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loopMinutes || Number(loopMinutes) <= 0) {
      setError('Please enter a valid loop duration (in minutes).');
      setTimeout(() => {
        setError('');
      }, 3000);
      return;
    }
    setError('');
    setSubmittedLoopMinutes(loopMinutes);

    // Extract id from URL and validate
    const idFromUrl = extractVideoId(youtubeUrl);
    if (!idFromUrl) {
      setError('Please enter a valid YouTube URL.');
      return;
    }

    // save the looped song to the database
    try {
      setIsSaving(true);
      const resp = await axios.post('http://localhost:8000/api/saveloopedsong', {
        video_id: idFromUrl,
        title: videoTitle || '',
        loop_duration: Number(loopMinutes),
        user_id: '',
      });
      console.log(resp.data);
      showToast('Saved to history', 'success');
      // Refresh history to reflect updated play_count / ordering
      void refreshHistoryWithCurrentSort();
    } catch (err) {
      console.error('Error saving looped song:', err);
      showToast("Couldn't save. Try again.", 'error');
    } finally {
      setIsSaving(false);
    }

    // If the same video is already loaded, reset and play from start
    if (videoId && idFromUrl === videoId && playerRef.current) {
      // Reset loop timer state
      setIsLooping(true);
      setTimePassed(0);
      setElapsedTime(0);
      setLoopStartTime(Date.now());
      try {
        playerRef.current.seekTo(0, true);
        playerRef.current.playVideo();
      } catch (err) {
        console.error('Failed to control player:', err);
      }
    } else {
      // Different video: load it so onReady kicks in
      setVideoId(idFromUrl);
    }
  };

  /**
   * Formats milliseconds as mm:ss string.
   */
  function formatTime(ms: number) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Fetches video title using YouTube oEmbed API
   */
  const fetchVideoTitle = async (videoId: string) => {
    try {
      const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
      const data = await response.json();
      return data.title || '';
    } catch (error) {
      console.error('Error fetching video title:', error);
      return '';
    }
  };

  /**
   * Handles URL input change and fetches video title
   */
  const handleUrlChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const url = e.target.value;
    setYoutubeUrl(url);
    
    const id = extractVideoId(url);
    if (id) {
      const title = await fetchVideoTitle(id);
      setVideoTitle(title);
    } else {
      setVideoTitle('');
    }
  };

  /**
   * Load a history item: set video, title, and loop duration, then open player
   */
  const loadFromHistory = async (item: LoopedSong) => {
    setVideoId(item.video_id);
    setYoutubeUrl(`https://www.youtube.com/watch?v=${item.video_id}`);
    setVideoTitle(item.title);
    const minutes = String(item.loop_duration ?? '');
    setLoopMinutes(minutes);
    setSubmittedLoopMinutes(minutes);
    setIsLooping(false);
    setTimePassed(0);
    setElapsedTime(0);
    // Player will autoplay in onPlayerReady

    // Increment play_count for this history item and refresh the panel
    try {
      await axios.post('http://localhost:8000/api/saveloopedsong', {
        video_id: item.video_id,
        title: item.title,
        loop_duration: item.loop_duration,
        user_id: '',
      });
      await refreshHistoryWithCurrentSort();
    } catch (err) {
      console.error('Failed to update play count from history:', err);
    }
  };

  // Toggle favorite for a history item and refresh list
  const toggleFavorite = async (item: LoopedSong) => {
    try {
      const base = `http://localhost:8000/api/looped-songs/${item.video_id}/favorite`;
      // Send explicit state for idempotency
      await axios.patch(base, { is_favorite: !item.is_favorite }, { params: { user_id: '' } });
      showToast(item.is_favorite ? 'Removed from favorites' : 'Added to favorites', 'success');
      // Refetch with current sort to reflect authoritative value
      const listBase = 'http://localhost:8000/api/looped-songs';
      const url =
        sortBy === 'recent'
          ? `${listBase}?sort=recent`
          : sortBy === 'plays'
          ? `${listBase}?sort=plays`
          : listBase;
      const res = await fetch(url);
      if (res.ok) {
        const data: LoopedSong[] = await res.json();
        setHistory(data);
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
      showToast('Could not update favorite', 'error');
    }
  };

  const renderHistoryItem = (item: LoopedSong) => {
    const thumb = `https://img.youtube.com/vi/${item.video_id}/hqdefault.jpg`;
    return (
      <div key={item.id} className="w-full flex items-center gap-2">
        <button
          onClick={() => loadFromHistory(item)}
          className="flex-1 text-left flex items-center gap-3 p-2 rounded hover:bg-gray-100 transition"
        >
          <img src={thumb} alt={item.title} className="w-16 h-10 object-cover rounded" />
          <div className="flex-1">
            <div className="text-sm text-black line-clamp-2">{item.title}</div>
            <div className="text-xs text-gray-500">{item.loop_duration} min</div>
            <div className="text-xs text-gray-500">{item.play_count} plays</div>
          </div>
        </button>
        <button
          aria-label="Toggle favorite"
          onClick={(e) => { e.stopPropagation(); toggleFavorite(item); }}
          className="p-2 rounded hover:bg-gray-100 transition"
        >
          {item.is_favorite ? (
            <MdStar className="text-yellow-500" size={18} />
          ) : (
            <MdStarBorder className="text-gray-400" size={18} />
          )}
        </button>
        <button
          aria-label="Delete"
          onClick={(e) => { e.stopPropagation(); deleteHistoryItem(item); }}
          className="p-2 rounded hover:bg-gray-100 transition"
        >
          <MdDelete className="text-gray-400" size={18} />
        </button>
      </div>
    );
  };

  return (
    <main className="relative flex min-h-screen flex-col bg-white">
      {/* Toasts */}
      <Toast
        toasts={toasts}
        onClose={(id) => setToasts((t) => t.filter((x) => x.id !== id))}
        position="bottom-right"
      />

      {/* History toggle */}
      <button
        aria-label="Toggle history"
        onClick={() => setIsHistoryOpen(v => !v)}
        className="fixed right-4 top-4 z-40 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-black shadow-sm hover:bg-gray-50"
      >
        <span className="inline-flex items-center gap-2">
          <span className="h-4 w-4">
            <MdHistory size={16} aria-hidden/>
          </span>
          {isHistoryOpen ? 'Close History' : 'History'}
        </span>
      </button>

      {/* Slide-in History Panel */}
      <aside
        className={`fixed top-0 right-0 z-30 h-full w-80 transform border-l border-gray-200 bg-white p-4 shadow-lg transition-transform duration-300 ${
          isHistoryOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="mb-3">
          <h2 className="text-base font-light text-black">Loop History</h2>
          <div className="mt-8 flex items-center gap-2">
            <button
              type="button"
              aria-pressed={sortBy === 'recent'}
              onClick={() => setSortBy('recent')}
              className={`px-3 py-1 text-xs rounded border transition ${
                sortBy === 'recent'
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-black border-gray-200 hover:bg-gray-50'
              }`}
            >
              Most recent
            </button>
            <button
              type="button"
              aria-pressed={sortBy === 'plays'}
              onClick={() => setSortBy('plays')}
              className={`px-3 py-1 text-xs rounded border transition ${
                sortBy === 'plays'
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-black border-gray-200 hover:bg-gray-50'
              }`}
            >
              Play count
            </button>
            <button
              type="button"
              aria-pressed={sortBy === 'added'}
              onClick={() => setSortBy('added')}
              className={`px-3 py-1 text-xs rounded border transition ${
                sortBy === 'added'
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-black border-gray-200 hover:bg-gray-50'
              }`}
            >
              Recently added
            </button>
          </div>

          {/* Undo deleted items banner (batch) */}
          {Object.keys(pendingUndos).length > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-md border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-800">
              <span>
                Removed {Object.keys(pendingUndos).length} item{Object.keys(pendingUndos).length > 1 ? 's' : ''}. Press Undo if it was a mistake.
              </span>
              <button
                onClick={undoAllDeletes}
                className="ml-3 rounded bg-black px-2 py-1 text-xs text-white hover:bg-black/80"
              >
                Undo
              </button>
            </div>
          )}
        </div>
        {historyLoading && <div className="text-sm text-gray-500">Loading…</div>}
        {historyError && <div className="text-sm text-red-500">{historyError}</div>}
        <div className="max-h-[80vh] overflow-y-auto pr-1 space-y-1">
          {history.length === 0 && !historyLoading ? (
            <div className="text-sm text-gray-500">No history yet</div>
          ) : (
            history.map(renderHistoryItem)
          )}
        </div>
      </aside>

      <header className="w-full py-8 flex flex-col justify-center items-center">
        <h1
          className="text-2xl md:text-4xl font-light text-black mb-1 tracking-wide text-center"
        >
          YouTube Song Looper
        </h1>
        <p className="text-gray-500 text-center text-base font-light">
          When one listen isn't enough ...
        </p>
      </header>
      <section className="flex flex-col items-center justify-start px-4 pt-8">
        <form onSubmit={handleSubmit} className="space-y-6 w-full max-w-md text-black">
          <div>
            <label htmlFor="youtube-url" className="block text-sm font-normal mb-1 text-gray-700 tracking-wide">
              YouTube Video URL
            </label>
            <input
              id="youtube-url"
              type="url"
              required
              value={youtubeUrl}
              onChange={handleUrlChange}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white text-black placeholder-gray-400 text-sm font-light shadow-sm transition"
            />
          </div>
          {videoTitle && (
            <div className="mt-1 text-sm text-gray-600 font-light">
              {videoTitle}
            </div>
          )}
          <div>
            <label htmlFor="loop-minutes" className="block text-sm font-normal mb-1 text-gray-700 tracking-wide">
              Loop Duration (minutes)
            </label>
            <input
              id="loop-minutes"
              type="number"
              min={1}
              max={120}
              value={loopMinutes}
              onChange={e => {
                setLoopMinutes(e.target.value);
                if (error && e.target.value && Number(e.target.value) > 0) setError('');
              }}
              className="w-full border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white text-black placeholder-gray-400 text-sm font-light shadow-sm transition"
            />
          </div>
          {error && (
            <div className="text-red-500 text-sm font-light mt-1">{error}</div>
          )}
          <button
            type="submit"
            disabled={isSaving}
            aria-busy={isSaving}
            className="w-full bg-blue-600 text-white font-light py-2 rounded-md hover:bg-blue-700 transition text-base tracking-wide shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span className="inline-flex items-center justify-center gap-2">
              {isSaving && (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
              )}
              <span>{isSaving ? 'Saving…' : 'Load & Loop'}</span>
            </span>
          </button>
        </form>
        {videoId && (
          <div className="mt-12 flex flex-col items-center justify-center w-full">
            {isLooping && (
              <div className="mb-2 text-blue-600 text-center text-s font-light">
                Looping for {formatTime(elapsedTime)} / {submittedLoopMinutes ? `${submittedLoopMinutes}:00` : ''}
              </div>
            )}
            <div className="flex justify-center w-full">
              <YouTube
                videoId={videoId}
                opts={{
                  height: '360',
                  width: '640',
                  playerVars: { autoplay: 1 },
                }}
                onReady={onPlayerReady}
                onEnd={onPlayerEnd}
                onStateChange={onPlayerStateChange}
              />
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
