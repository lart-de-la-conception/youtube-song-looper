'use client';
import React, { useState, useEffect, useRef } from 'react';
import YouTube from 'react-youtube';  
import { MdHistory, MdClose, MdStar, MdStarBorder, MdDelete } from 'react-icons/md';
import axios from 'axios';
axios.defaults.withCredentials = true;
import Toast, { ToastItem } from '@/components/Toast';

function getApiUrl() {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:8000';
    }
  }

  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
}


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
  const apiUrl = getApiUrl();
  const [youtubeUrl, setYoutubeUrl] = useState('');
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
        entries.map((e) => axios.patch(`${apiUrl}/api/looped-songs/${e.item.video_id}/restore`))
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
  const playerRef = useRef<{ seekTo: (t: number, allowSeekAhead?: boolean) => void; playVideo: () => void } | null>(null);

  const getHistoryUrl = () => {
    const base = `${apiUrl}/api/looped-songs`;
    if (sortBy === 'recent') return `${base}?sort=recent`;
    if (sortBy === 'plays') return `${base}?sort=plays`;
    return base;
  };

  // Refresh history with current sort
  const refreshHistoryWithCurrentSort = async () => {
    const res = await fetch(getHistoryUrl(), { credentials: 'include' });
    if (res.ok) setHistory(await res.json());
  };

  // Delete a history item
  const deleteHistoryItem = async (item: LoopedSong) => {
    // optimistic UI
    setHistory(h => h.filter(i => i.video_id !== item.video_id));
    
    try {
      await axios.delete(`${apiUrl}/api/looped-songs/${item.video_id}`);
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
        const res = await fetch(getHistoryUrl(), { credentials: 'include' });
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
  const onPlayerReady = (event: { target: { playVideo: () => void; seekTo: (t: number, allowSeekAhead?: boolean) => void } }) => {
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
  const onPlayerStateChange = (event: { data: number }) => {
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
  const onPlayerEnd = (event: { target: { seekTo: (t: number) => void; playVideo: () => void } }) => {
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
      await axios.post(`${apiUrl}/api/saveloopedsong`, {
        video_id: idFromUrl,
        title: videoTitle || '',
        loop_duration: Number(loopMinutes),
      });
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
    if (videoId === item.video_id && isLooping && !videoPaused) {
      showToast('Video is currently playing', 'success');
      return;
    }

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
      await axios.post(`${apiUrl}/api/saveloopedsong`, {
        video_id: item.video_id,
        title: item.title,
        loop_duration: item.loop_duration,
      });
      await refreshHistoryWithCurrentSort();
    } catch (err) {
      console.error('Failed to update play count from history:', err);
    }
  };

  // Toggle favorite for a history item and refresh list
  const toggleFavorite = async (item: LoopedSong) => {
    try {
      const base = `${apiUrl}/api/looped-songs/${item.video_id}/favorite`;
      // Send explicit state for idempotency
      await axios.patch(base, { is_favorite: !item.is_favorite });
      showToast(item.is_favorite ? 'Removed from favorites' : 'Added to favorites', 'success');
      await refreshHistoryWithCurrentSort();
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

      {/* Backdrop: blocks interaction with main content; drawer hidden off-screen when closed */}
      <button
        type="button"
        aria-label="Close history"
        aria-hidden={!isHistoryOpen}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 md:bg-black/30 ${
          isHistoryOpen
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setIsHistoryOpen(false)}
        tabIndex={isHistoryOpen ? 0 : -1}
      />

      {/* Slide-in History Panel — full viewport height, scroll only the list */}
      <aside
        id="history-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-drawer-title"
        aria-hidden={!isHistoryOpen}
        className={`fixed inset-y-0 right-0 z-50 flex h-dvh max-h-dvh w-full max-w-sm flex-col border-l border-gray-200 bg-white shadow-xl transition-transform duration-300 ease-out ${
          isHistoryOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-4">
          <h2 id="history-drawer-title" className="font-franklin-pro-bold text-lg tracking-wide text-gray-900 uppercase">
            History
          </h2>
          <button
            type="button"
            aria-label="Close history"
            onClick={() => setIsHistoryOpen(false)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-gray-700 transition hover:bg-gray-100 hover:text-black"
          >
            <MdClose size={16} aria-hidden />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-1">
          <div className="mb-2 shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={sortBy === 'recent'}
                onClick={() => setSortBy('recent')}
                className={`px-4 py-2.5 text-xs rounded border transition ${
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
                className={`px-4 py-2.5 text-xs rounded border transition ${
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
                className={`px-4 py-2.5 text-xs rounded border transition ${
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
                  type="button"
                  onClick={undoAllDeletes}
                  className="ml-3 rounded bg-black px-2 py-1 text-xs text-white hover:bg-black/80"
                >
                  Undo
                </button>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {historyLoading && <div className="mb-2 text-sm text-gray-500">Loading…</div>}
            {historyError && <div className="mb-2 text-sm text-red-500">{historyError}</div>}
            {history.length === 0 && !historyLoading ? (
              <div className="text-sm text-gray-500">No history yet</div>
            ) : (
              <div className="space-y-1">
                {history.map(renderHistoryItem)}
              </div>
            )}
          </div>
        </div>
      </aside>

      <header className="relative w-full py-8 pr-6 pl-4 md:pr-8 flex flex-col justify-center items-center">
        <button
          type="button"
          aria-label="Open history"
          aria-expanded={isHistoryOpen}
          aria-controls="history-drawer"
          onClick={() => setIsHistoryOpen(true)}
          className="absolute right-6 top-12.5 z-30 flex -translate-y-1/2 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 md:right-15"
        >
          <MdHistory size={18} className="shrink-0 text-gray-600" aria-hidden />
          History
        </button>
        <h1 className="mb-1 text-center font-franklin-pro-bold text-xl tracking-wide text-gray-900 uppercase md:text-3xl">
          YouTube Song Looper
        </h1>
        <p className="text-center text-sm text-gray-500">
          When one listen isn't enough ...
        </p>
      </header>
      <section className="flex flex-col items-center justify-start px-4 pt-8">
        <form onSubmit={handleSubmit} className="space-y-6 w-full max-w-md text-black">
          <div>
            <label htmlFor="youtube-url" className="mb-1 block font-franklin-pro-bold text-sm tracking-wide text-gray-900 uppercase">
              YouTube Video URL
            </label>
            <input
              id="youtube-url"
              type="url"
              required
              value={youtubeUrl}
              onChange={handleUrlChange}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-black placeholder-gray-400 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          {videoTitle && (
            <div className="mt-1 text-sm text-gray-600">
              {videoTitle}
            </div>
          )}
          <div>
            <label htmlFor="loop-minutes" className="mb-1 block font-franklin-pro-bold text-sm tracking-wide text-gray-900 uppercase">
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
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-black placeholder-gray-400 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          {error && (
            <div className="mt-1 text-sm text-red-500">{error}</div>
          )}
          <button
            type="submit"
            disabled={isSaving}
            aria-busy={isSaving}
            className="shake-btn w-full rounded-md bg-blue-600 py-2 text-base text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="inline-flex items-center justify-center gap-2 font-franklin-pro-bold uppercase text-sm">
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
              <div className="mb-2 text-center text-sm text-blue-600">
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
