import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Home from '../page';
import axios from 'axios';

// Mock react-youtube to capture props for invoking onReady/onEnd in tests
jest.mock('react-youtube', () => (props: { onReady?: Function; onEnd?: Function; onStateChange?: Function }) => {
  (global as any).__ytProps = props;
  return <div data-testid="yt-player" />;
});

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock fetch globally (history requests, oEmbed lookups)
global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as any;

describe('Home page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => [] } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders inputs and button', () => {
    render(<Home />);
    expect(screen.getByLabelText(/YouTube Video URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Loop Duration/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Repeat count/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Load & Loop/i })).toBeInTheDocument();
  });

  it('shows validation error when loop duration is missing', async () => {
    render(<Home />);
    fireEvent.change(screen.getByLabelText(/YouTube Video URL/i), {
      target: { value: 'https://www.youtube.com/watch?v=abcdefghijk' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Load & Loop/i }));
    expect(await screen.findByText(/Please enter a valid loop duration/i)).toBeInTheDocument();
  });

  it('shows URL validation error when URL is invalid but duration is valid', async () => {
    render(<Home />);
    fireEvent.change(screen.getByLabelText(/Loop Duration/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/YouTube Video URL/i), { target: { value: 'not-a-url' } });
    const form = screen.getByRole('button', { name: /Load & Loop/i }).closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(await screen.findByText(/Please enter a valid YouTube URL/i)).toBeInTheDocument();
  });

  it('shows validation error when repeat count is invalid', async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /Repeat count/i }));
    fireEvent.change(screen.getByLabelText(/Repeat Count/i), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/YouTube Video URL/i), {
      target: { value: 'https://www.youtube.com/watch?v=abcdefghijk' },
    });
    const form = screen.getByRole('button', { name: /Load & Loop/i }).closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(await screen.findByText(/Please enter a valid repeat count/i)).toBeInTheDocument();
  });

  it('submits valid URL and duration, saves, and renders player', async () => {
    // oEmbed title fetch
    (global.fetch as jest.Mock).mockImplementationOnce(async (url: string) => {
      if (url.includes('oembed')) {
        return { ok: true, json: async () => ({ title: 'Sample Video' }) } as any;
      }
      return { ok: true, json: async () => [] } as any;
    });
    mockedAxios.post.mockResolvedValue({ data: { id: '1', video_id: 'abcdefghijk', title: 'Sample Video', loop_duration: 2 } } as any);

    render(<Home />);
    fireEvent.change(screen.getByLabelText(/Loop Duration/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/YouTube Video URL/i), { target: { value: 'https://www.youtube.com/watch?v=abcdefghijk' } });
    fireEvent.click(screen.getByRole('button', { name: /Load & Loop/i }));

    expect(await screen.findByText(/Saved to history/i)).toBeInTheDocument();
    expect(await screen.findByTestId('yt-player')).toBeInTheDocument();
  });

  it('opens history panel and fetches with default sort, then changes sort', async () => {
    render(<Home />);

    // Open history
    fireEvent.click(screen.getByRole('button', { name: /open history/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // Default sort fetch (?sort=recent)
    expect((global.fetch as jest.Mock).mock.calls.some(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('/api/looped-songs?sort=recent')
    )).toBe(true);

    // Change sort to plays
    (global.fetch as jest.Mock).mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Play count/i }));
    expect((global.fetch as jest.Mock).mock.calls.some(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('/api/looped-songs?sort=plays')
    )).toBe(true);
  });

  it('favorites, deletes, and undoes delete for a history item', async () => {
    // Mock history list when opening panel
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ([{
        id: 'row1', video_id: 'vid12345678a', title: 'Track 1', loop_duration: 3, play_count: 1, is_favorite: false,
      }]),
    } as any);

    // Mock refetches after actions
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => [] } as any);

    mockedAxios.patch.mockResolvedValue({ data: {} } as any);
    mockedAxios.delete.mockResolvedValue({} as any);

    render(<Home />);
    // Open history
    fireEvent.click(screen.getByRole('button', { name: /open history/i }));

    // Favorite toggle
    fireEvent.click(await screen.findByLabelText(/Toggle favorite/i));
    expect(mockedAxios.patch).toHaveBeenCalledWith(
      expect.stringContaining('/api/looped-songs/vid12345678a/favorite'),
      { is_favorite: true }
    );

    // Delete
    fireEvent.click(screen.getByLabelText(/Delete/i));
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      expect.stringContaining('/api/looped-songs/vid12345678a')
    );

    // Undo banner appears and can restore
    const undoButton = await screen.findByRole('button', { name: /Undo/i });
    fireEvent.click(undoButton);
    expect(mockedAxios.patch).toHaveBeenCalledWith(
      expect.stringContaining('/api/looped-songs/vid12345678a/restore')
    );
  });

  it('shows fetched video title after entering a valid YouTube URL', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(async (url: string) => {
      if (url.includes('oembed')) {
        return { ok: true, json: async () => ({ title: 'Fetched Title' }) } as any;
      }
      return { ok: true, json: async () => [] } as any;
    });
    render(<Home />);
    fireEvent.change(screen.getByLabelText(/YouTube Video URL/i), {
      target: { value: 'https://www.youtube.com/watch?v=abcdefghijk' },
    });
    expect(await screen.findByText(/Fetched Title/i)).toBeInTheDocument();
  });

  it('disables submit and shows "Saving…" while request pending', async () => {
    let resolvePost: (v?: unknown) => void;
    mockedAxios.post.mockImplementation(
      () => new Promise((res) => { resolvePost = res; }) as any
    );
    render(<Home />);
    fireEvent.change(screen.getByLabelText(/Loop Duration/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/YouTube Video URL/i), { target: { value: 'https://www.youtube.com/watch?v=abcdefghijk' } });
    fireEvent.click(screen.getByRole('button', { name: /Load & Loop/i }));
    expect(screen.getByRole('button', { name: /Saving…/i })).toBeDisabled();
    // finish request
    // @ts-expect-error resolvePost is assigned inside mock
    resolvePost({ data: {} });
    // back to enabled state
    expect(await screen.findByRole('button', { name: /Load & Loop/i })).toBeEnabled();
  });

  it('shows empty state text when no history', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => [] } as any);
    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /Open history/i }));
    expect(await screen.findByText(/No history yet/i)).toBeInTheDocument();
  });

  it('shows error toasts on failed save and favorite/delete', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('save failed'));
    render(<Home />);
    fireEvent.change(screen.getByLabelText(/Loop Duration/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/YouTube Video URL/i), { target: { value: 'https://www.youtube.com/watch?v=abcdefghijk' } });
    fireEvent.click(screen.getByRole('button', { name: /Load & Loop/i }));
    expect(await screen.findByText(/Couldn't save/i)).toBeInTheDocument();

    // Open history and inject one item
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ([{
      id: 'row2', video_id: 'viderr12345x', title: 'Err Track', loop_duration: 3, play_count: 1, is_favorite: false,
    }]) } as any);
    fireEvent.click(screen.getByRole('button', { name: /Open history/i }));

    mockedAxios.patch.mockRejectedValueOnce(new Error('favorite failed'));
    fireEvent.click(await screen.findByLabelText(/Toggle favorite/i));
    expect(await screen.findByText(/Could not update favorite/i)).toBeInTheDocument();

    mockedAxios.delete.mockRejectedValueOnce(new Error('delete failed'));
    fireEvent.click(screen.getByLabelText(/Delete/i));
    expect(await screen.findByText(/Could not remove from history/i)).toBeInTheDocument();
  });

  it('onEnd stops when over target duration', async () => {
    // Over target path only: mock time so elapsed >= target to force stop
    render(<Home />);
    mockedAxios.post.mockResolvedValue({ data: {} } as any);
    fireEvent.change(screen.getByLabelText(/Loop Duration/i), { target: { value: '0.001' } });
    fireEvent.change(screen.getByLabelText(/YouTube Video URL/i), { target: { value: 'https://www.youtube.com/watch?v=abcdefghijk' } });
    fireEvent.click(screen.getByRole('button', { name: /Load & Loop/i }));

    const seekTo2 = jest.fn();
    const playVideo2 = jest.fn();
    await act(async () => {
      (global as any).__ytProps.onReady({ target: { seekTo: seekTo2, playVideo: playVideo2 } });
    });
    const realNow = Date.now;
    const base = realNow();
    // Advance time by 10 minutes to exceed any tiny target
    Date.now = () => base + 10 * 60 * 1000;
    await act(async () => {
      (global as any).__ytProps.onEnd({ target: { seekTo: seekTo2, playVideo: playVideo2 } });
    });
    // Restore Date.now
    Date.now = realNow;
    expect(seekTo2).not.toHaveBeenCalled();
  });

  it('shows a wakeup hint when history loading is unusually slow', async () => {
    jest.useFakeTimers();

    let resolveFetch!: (value: any) => void;
    (global.fetch as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }) as any
    );

    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /Open history/i }));

    expect(screen.getByText(/Loading…/i)).toBeInTheDocument();
    expect(screen.queryByText(/Waking up the API/i)).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2500);
    });

    expect(screen.getByText(/Waking up the API/i)).toBeInTheDocument();

    await act(async () => {
      resolveFetch({ ok: true, json: async () => [] });
    });

    expect(await screen.findByText(/No history yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Waking up the API/i)).not.toBeInTheDocument();
  });

  it('stops looping after the selected repeat count', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} } as any);

    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /Repeat count/i }));
    fireEvent.change(screen.getByLabelText(/Repeat Count/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/YouTube Video URL/i), {
      target: { value: 'https://www.youtube.com/watch?v=abcdefghijk' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Load & Loop/i }));

    expect(await screen.findByTestId('yt-player')).toBeInTheDocument();

    const seekTo = jest.fn();
    const playVideo = jest.fn();

    await act(async () => {
      (global as any).__ytProps.onReady({ target: { seekTo, playVideo } });
    });

    expect(screen.getByText(/Play 1 \/ 2/i)).toBeInTheDocument();

    await act(async () => {
      (global as any).__ytProps.onEnd({ target: { seekTo, playVideo } });
    });

    expect(seekTo).toHaveBeenCalledTimes(1);

    await act(async () => {
      (global as any).__ytProps.onStateChange({ data: 1 });
    });

    expect(screen.getByText(/Play 2 \/ 2/i)).toBeInTheDocument();

    await act(async () => {
      (global as any).__ytProps.onEnd({ target: { seekTo, playVideo } });
    });

    expect(seekTo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Play 2 \/ 2/i)).not.toBeInTheDocument();
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/saveloopedsong'),
      expect.objectContaining({ video_id: 'abcdefghijk', loop_duration: 0 }),
    );
  });

  it('does not reuse old repeat count after switching back to duration mode', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} } as any);

    render(<Home />);

    // First set a repeat count.
    fireEvent.click(screen.getByRole('button', { name: /Repeat count/i }));
    fireEvent.change(screen.getByLabelText(/Repeat Count/i), { target: { value: '3' } });

    // Then switch to duration mode and submit.
    fireEvent.click(screen.getByRole('button', { name: /Duration/i }));
    fireEvent.change(screen.getByLabelText(/Loop Duration/i), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/YouTube Video URL/i), {
      target: { value: 'https://www.youtube.com/watch?v=abcdefghijk' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Load & Loop/i }));

    expect(await screen.findByTestId('yt-player')).toBeInTheDocument();

    const seekTo = jest.fn();
    const playVideo = jest.fn();

    await act(async () => {
      (global as any).__ytProps.onReady({ target: { seekTo, playVideo } });
    });

    // In duration mode with a long target, each end event should continue looping.
    await act(async () => {
      (global as any).__ytProps.onEnd({ target: { seekTo, playVideo } });
      (global as any).__ytProps.onStateChange({ data: 1 });
      (global as any).__ytProps.onEnd({ target: { seekTo, playVideo } });
      (global as any).__ytProps.onStateChange({ data: 1 });
      (global as any).__ytProps.onEnd({ target: { seekTo, playVideo } });
    });

    expect(seekTo).toHaveBeenCalledTimes(3);
  });
});


