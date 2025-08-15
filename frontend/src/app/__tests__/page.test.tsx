import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Home from '../page';
import axios from 'axios';

// Mock react-youtube to capture props for invoking onReady/onEnd in tests
jest.mock('react-youtube', () => (props: any) => {
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
  });

  it('renders inputs and button', () => {
    render(<Home />);
    expect(screen.getByLabelText(/YouTube Video URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Loop Duration/i)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /toggle history/i }));
    expect(await screen.findByText(/Loop History/i)).toBeInTheDocument();

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
    fireEvent.click(screen.getByRole('button', { name: /toggle history/i }));

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
    fireEvent.click(screen.getByRole('button', { name: /Toggle history/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /Toggle history/i }));

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
});


