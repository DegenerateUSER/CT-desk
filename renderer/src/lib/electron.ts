// ─────────────────────────────────────────────────────────────────────────────
// Electron Bridge — Type-safe access to window.electronAPI from the renderer
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of the API exposed by preload.js via contextBridge */
export interface ElectronAPI {
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
  once: (channel: string, callback: (...args: any[]) => void) => void;
  platform: string;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

/**
 * Check if we're running inside Electron.
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
}

/**
 * Get the Electron API (throws if not in Electron).
 */
export function getElectronAPI(): ElectronAPI {
  if (!isElectron()) {
    throw new Error('Not running in Electron');
  }
  return window.electronAPI!;
}

/**
 * Safely invoke an Electron IPC channel.
 * Returns null if not in Electron context (for SSR / dev).
 */
export async function electronInvoke<T = any>(channel: string, ...args: any[]): Promise<T | null> {
  if (!isElectron()) return null;
  return window.electronAPI!.invoke(channel, ...args);
}

/**
 * Subscribe to an Electron IPC event.
 * Returns a no-op unsubscribe function if not in Electron.
 */
export function electronOn(channel: string, callback: (...args: any[]) => void): () => void {
  if (!isElectron()) return () => {};
  return window.electronAPI!.on(channel, callback);
}

// ── MPV convenience wrappers ────────────────────────────────────────────────

export const mpv = {
  load: (source: string, options?: { width?: number; height?: number; httpHeaders?: string[] }) =>
    electronInvoke('mpv:load', source, options),

  play: () => electronInvoke('mpv:play'),
  pause: () => electronInvoke('mpv:pause'),
  stop: () => electronInvoke('mpv:stop'),

  seek: (position: number) => electronInvoke('mpv:seek', position),
  setVolume: (volume: number) => electronInvoke('mpv:set-volume', volume),
  getStatus: () => electronInvoke<MpvStatus>('mpv:get-status'),

  setSubtitle: (trackId: number) => electronInvoke('mpv:set-subtitle', trackId),
  setAudio: (trackId: number) => electronInvoke('mpv:set-audio', trackId),
  toggleFullscreen: () => electronInvoke('mpv:toggle-fullscreen'),
  setSpeed: (speed: number) => electronInvoke('mpv:set-speed', speed),
  resize: (width: number, height: number) => electronInvoke('mpv:resize', width, height),

  onStatusUpdate: (cb: (status: MpvStatus) => void) => electronOn('mpv:status-update', cb),
  onError: (cb: (error: { message: string; code: string }) => void) => electronOn('mpv:error', cb),
  onEnded: (cb: (info: { code?: number; reason?: string }) => void) => electronOn('mpv:ended', cb),
  onFrame: (cb: (frame: { data: ArrayBuffer; width: number; height: number }) => void) =>
    electronOn('mpv:frame', cb),
  onVideoReconfig: (cb: (dims: { width: number; height: number }) => void) =>
    electronOn('mpv:video-reconfig', cb),
  onFullscreenChange: (cb: (isFullscreen: boolean) => void) =>
    electronOn('app:fullscreen-change', cb),
};

export interface MpvStatus {
  playing: boolean;
  paused: boolean;
  duration: number;
  position: number;
  volume: number;
  muted: boolean;
  speed: number;
  filename: string;
  connected: boolean;
  embedded: boolean;
  idle: boolean;
  cacheDuration: number;
  tracks: {
    audio: MpvTrack[];
    video: MpvTrack[];
    sub: MpvTrack[];
  };
}

export interface MpvTrack {
  id: number;
  type: 'audio' | 'video' | 'sub';
  title?: string;
  lang?: string;
  codec?: string;
  selected?: boolean;
  external?: boolean;
}

// ── File system convenience wrappers ────────────────────────────────────────

export const fs = {
  openFileDialog: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
    electronInvoke<string>('fs:open-file-dialog', options),
  openFolderDialog: () => electronInvoke<string>('fs:open-folder-dialog'),
};

// ── Telegram direct streaming ───────────────────────────────────────────────

export interface TelegramStreamResult {
  url: string;
  port: number;
}

export const telegram = {
  /**
   * Start a direct Telegram stream (zero server bandwidth).
   * Returns a local HTTP URL that MPV can load.
   */
  startStream: (streamInfo: any) =>
    electronInvoke<TelegramStreamResult>('telegram:start-stream', streamInfo),

  /** Stop a Telegram stream for a specific video. */
  stopStream: (videoId: string) =>
    electronInvoke('telegram:stop-stream', videoId),
};

// ── Shell convenience wrappers ──────────────────────────────────────────────

export const electronShell = {
  /** Open a URL in the user's default external browser. */
  openExternal: (url: string) => electronInvoke('shell:open-external', url),
};

// ── Torrent streaming (WebTorrent) convenience wrappers ─────────────────────

export interface TorrentFileInfo {
  index: number;
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
}

export interface TorrentStreamResult {
  url: string;
  port: number;
  streamId: string;
  fileName: string;
  fileSize: number;
}

export interface TorrentStreamProgress {
  streamId: string;
  downloaded: number;
  total: number;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  numPeers: number;
  timeRemaining: number;
  fileName: string;
}

export const torrent = {
  /** Get list of video files in a torrent (by magnet URI). */
  getFiles: (magnetUri: string) =>
    electronInvoke<TorrentFileInfo[]>('torrent:get-files', magnetUri),

  /** Start streaming a torrent file. Returns local HTTP URL for MPV. */
  startStream: (magnetUri: string, fileIndex?: number) =>
    electronInvoke<TorrentStreamResult>('torrent:start-stream', magnetUri, fileIndex),

  /** Stop an active torrent stream. */
  stopStream: (streamId: string) =>
    electronInvoke('torrent:stop-stream', streamId),

  /** Get status of all active streams. */
  getStreamStatus: () =>
    electronInvoke<Record<string, TorrentStreamProgress>>('torrent:stream-status'),

  /** Subscribe to torrent stream progress updates. */
  onStreamProgress: (cb: (progress: TorrentStreamProgress) => void) =>
    electronOn('torrent:stream-progress', cb),
};

// ── App convenience wrappers ────────────────────────────────────────────────

export const appInfo = {
  getVersion: () => electronInvoke<string>('app:get-version'),
  getPlatform: () => electronInvoke<string>('app:get-platform'),
};
