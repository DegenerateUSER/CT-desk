// ─────────────────────────────────────────────────────────────────────────────
// API Layer — Electron desktop app
// ─────────────────────────────────────────────────────────────────────────────
// All API calls go to the remote server. The desktop app no longer bundles
// a local Python backend — video is streamed directly from Google Drive
// using zero-bandwidth direct URLs.
// ─────────────────────────────────────────────────────────────────────────────

// ── Configuration ────────────────────────────────────────────────────────────

// Remote server URL — from .env (NEXT_PUBLIC_ vars are inlined at build time)
const REMOTE_SERVER_URL = process.env.NEXT_PUBLIC_REMOTE_SERVER_URL || 'http://165.232.116.243:8000';

function getServerBaseUrl(): string {
  return REMOTE_SERVER_URL;
}

// Common headers
const commonHeaders: Record<string, string> = {
  'ngrok-skip-browser-warning': '1',
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface DriveItem {
  id: string;
  name: string;
  type: 'folder' | 'file';
  mime_type: string;
  size: number;
  created_time: string | null;
  modified_time: string | null;
  web_view_link: string | null;
  web_content_link: string | null;
  thumbnail_link: string | null;
  is_video?: boolean;
  parent_path?: { id: string; name: string }[];
}

export interface BrowseResponse {
  items: DriveItem[];
  folder_id: string;
  breadcrumb: { id: string; name: string }[];
}

export interface VideoDetail {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  created_time: string | null;
  modified_time: string | null;
  web_view_link: string | null;
  web_content_link: string | null;
  thumbnail_link: string | null;
}

export interface UserProfile {
  id: number;
  username: string;
  email: string;
  display_name: string;
  status: string;
  is_admin?: boolean;
  role?: string;
  created_at: string | null;
}

export interface ReferralCode {
  id: number;
  code: string;
  created_at: string | null;
  is_used: boolean;
  used_by: string | null;
  used_at: string | null;
}

export interface TorrentSearchResult {
  source: string;
  torrent_id: string;
  name: string;
  size: string;
  seeders: number;
  leechers: number;
  time: string;
  uploader: string;
  url: string;
  magnet?: string | null;
  category?: string;
  downloads?: number;
  imdb?: string;
}

export interface TorrentDetail {
  source: string;
  torrent_id: string;
  name: string;
  description: string;
  size: string;
  size_bytes?: number;
  seeders: number;
  leechers: number;
  time: string;
  uploader: string;
  info_hash: string;
  magnet: string | null;
  category: string;
  imdb?: string;
  num_files?: number;
  completed?: number;
  files: Array<string | { name: string; size: string }>;
}

export interface ActiveTorrent {
  info_hash: string;
  name: string;
  status: string;
  progress: number;
  download_rate: number;
  upload_rate: number;
  num_seeds: number;
  total_size: number;
  downloaded: number;
  is_finished: boolean;
  files: string[];
  uploading: boolean;
  uploaded: boolean;
  upload_failed: boolean;
  upload_progress: number;
  upload_bytes_done: number;
  upload_bytes_total: number;
  upload_speed: number;
  upload_started_at: string | null;
  upload_error: string | null;
  drive_files: string[];
  added_by: string;
  added_at: number | null;
}

// ── Auth helpers ─────────────────────────────────────────────────────────────

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('user_token');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { ...commonHeaders, Authorization: `Bearer ${token}` } : { ...commonHeaders };
}

/**
 * Resolve relative thumbnail URLs to absolute using the server base URL.
 */
function resolveThumbnail(item: DriveItem): DriveItem {
  if (item.thumbnail_link && item.thumbnail_link.startsWith('/')) {
    return { ...item, thumbnail_link: `${getServerBaseUrl()}${item.thumbnail_link}` };
  }
  return item;
}

/**
 * Fetch from the remote server.
 */
async function serverFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${getServerBaseUrl()}${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...(opts.headers as Record<string, string> || {}) },
  });
}

// ── User Auth API (always remote) ────────────────────────────────────────────

export const userAuthApi = {
  register: async (data: {
    username: string;
    email: string;
    password: string;
    referral_code: string;
    display_name?: string;
  }) => {
    const res = await serverFetch('/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Registration failed' }));
      throw new Error(err.detail || 'Registration failed');
    }
    return res.json();
  },

  login: async (username: string, password: string) => {
    const res = await serverFetch('/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Login failed' }));
      throw new Error(err.detail || 'Login failed');
    }
    return res.json();
  },

  getProfile: async (): Promise<UserProfile> => {
    const res = await serverFetch('/api/user/me');
    if (!res.ok) throw new Error('Not authenticated');
    return res.json();
  },

  getReferralCodes: async (): Promise<{ codes: ReferralCode[]; max_codes: number }> => {
    const res = await serverFetch('/api/user/referral-codes');
    if (!res.ok) throw new Error('Failed to fetch codes');
    return res.json();
  },

  createReferralCode: async (): Promise<{ code: string; created_at: string }> => {
    const res = await serverFetch('/api/user/referral-codes', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to create code' }));
      throw new Error(err.detail || 'Failed to create code');
    }
    return res.json();
  },
};

// ── Video / Drive API ─────────────────────────────────────────────────────────

export const videoApi = {
  browse: async (folderId?: string): Promise<BrowseResponse> => {
    const qs = folderId ? `?folder_id=${encodeURIComponent(folderId)}` : '';
    const res = await serverFetch(`/api/browse${qs}`);
    if (!res.ok) throw new Error('Failed to browse folder');
    const data: BrowseResponse = await res.json();
    data.items = Array.isArray(data.items) ? data.items.map(resolveThumbnail) : [];
    return data;
  },

  search: async (query: string): Promise<{ items: DriveItem[] }> => {
    const qs = new URLSearchParams({ q: query });
    const res = await serverFetch(`/api/search?${qs}`);
    if (!res.ok) throw new Error('Failed to search');
    const data: { items: DriveItem[] } = await res.json();
    data.items = Array.isArray(data.items) ? data.items.map(resolveThumbnail) : [];
    return data;
  },

  listVideos: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    sort?: string;
    order?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.search) qs.set('search', params.search);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.order) qs.set('order', params.order);
    const res = await serverFetch(`/api/videos?${qs}`);
    if (!res.ok) throw new Error('Failed to fetch videos');
    const data = await res.json();
    if (Array.isArray(data.videos)) data.videos = data.videos.map(resolveThumbnail);
    if (Array.isArray(data.items)) data.items = data.items.map(resolveThumbnail);
    return data;
  },

  getVideo: async (videoId: string): Promise<VideoDetail> => {
    const res = await serverFetch(`/api/videos/${videoId}`);
    if (!res.ok) throw new Error('Video not found');
    const data: VideoDetail = await res.json();
    if (data.thumbnail_link && data.thumbnail_link.startsWith('/')) {
      data.thumbnail_link = `${getServerBaseUrl()}${data.thumbnail_link}`;
    }
    return data;
  },

  /**
   * Get the streaming URL for a video.
   * Returns a full URL pointing to the remote server.
   */
  getStreamUrl: (videoId: string): string => {
    return `${getServerBaseUrl()}/api/stream/${videoId}`;
  },

  getExternalUrls: async (videoId: string) => {
    const res = await serverFetch(`/api/external/${videoId}`);
    if (!res.ok) throw new Error('Failed to get external URLs');
    return res.json();
  },

  /**
   * Get Telegram file metadata for direct streaming (desktop app only).
   * Returns bot_token, api_id, api_hash, chat_id, message_id, etc.
   */
  getTelegramStreamInfo: async (videoId: string) => {
    const res = await serverFetch(`/api/telegram-stream-info/${videoId}`);
    if (!res.ok) throw new Error('Not a Telegram file');
    return res.json();
  },

  refreshIndex: async () => {
    const res = await serverFetch('/api/videos/refresh');
    if (!res.ok) throw new Error('Refresh failed');
    return res.json();
  },
};

// ── Torrent Search API ───────────────────────────────────────────────────────

export const torrentSearchApi = {
  search: async (
    query: string,
    source: 'anime' | 'movies',
    page: number = 1,
  ): Promise<{ results: TorrentSearchResult[]; query: string; source: string; page: number }> => {
    const apiSource = source === 'anime' ? 'nyaa' : 'tpb';
    const res = await serverFetch('/api/torrent-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, source: apiSource, page }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Search failed' }));
      throw new Error(err.detail || 'Search failed');
    }
    return res.json();
  },

  getDetail: async (source: string, torrentId: string): Promise<TorrentDetail> => {
    const res = await serverFetch(
      `/api/torrent-search/detail?source=${encodeURIComponent(source)}&torrent_id=${encodeURIComponent(torrentId)}`
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to fetch details' }));
      throw new Error(err.detail || 'Failed to fetch details');
    }
    return res.json();
  },

  addTorrent: async (torrent: {
    source: string;
    torrent_id: string;
    magnet?: string | null;
    name: string;
  }): Promise<{ info_hash: string; message: string; name: string }> => {
    const res = await serverFetch('/api/torrent-search/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(torrent),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to add torrent' }));
      throw new Error(err.detail || 'Failed to add torrent');
    }
    return res.json();
  },
};

// ── Active Torrents API ──────────────────────────────────────────────────────

export const activeTorrentsApi = {
  list: async (): Promise<Record<string, ActiveTorrent>> => {
    const res = await serverFetch('/torrents');
    if (!res.ok) throw new Error('Failed to fetch active torrents');
    return res.json();
  },

  retryUpload: async (infoHash: string): Promise<{ message: string }> => {
    const res = await serverFetch(`/torrents/${infoHash}/retry-upload`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Retry failed' }));
      throw new Error(err.detail || 'Retry failed');
    }
    return res.json();
  },

  stopTorrent: async (infoHash: string): Promise<{ message: string }> => {
    const res = await serverFetch(`/torrents/${infoHash}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to stop torrent' }));
      throw new Error(err.detail || 'Failed to stop torrent');
    }
    return res.json();
  },
};
