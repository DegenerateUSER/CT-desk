// ─────────────────────────────────────────────────────────────────────────────
// MpvPlayer — React component for embedded mpv video via libmpv + Canvas
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  SkipBack,
  SkipForward,
  Loader2,
  Settings,
  Monitor,
  Subtitles,
  AudioLines,
  Gauge,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  RefreshCw,
  RectangleHorizontal,
  Columns2,
} from 'lucide-react';
import { formatTime } from '@/lib/utils';
import { mpv, isElectron, MpvStatus, MpvTrack } from '@/lib/electron';

interface MpvPlayerProps {
  src: string;
  title: string;
  isFullscreen?: boolean;
  isTheater?: boolean;
  httpHeaders?: string[];
  /** Epoch ms when the auth token expires (used for direct stream) */
  tokenExpiresAt?: number | null;
  /** Called when the player needs a fresh token (re-fetch direct URL) */
  onTokenRefresh?: () => void;
  onTheaterToggle?: () => void;
  onEnded?: () => void;
}

type SettingsPage = null | 'main' | 'audio' | 'subtitles' | 'speed';

export default function MpvPlayer({ src, title, isFullscreen = false, isTheater = false, httpHeaders, tokenExpiresAt, onTokenRefresh, onTheaterToggle, onEnded }: MpvPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const pendingFrameRef = useRef<{ data: ArrayBuffer; width: number; height: number } | null>(null);
  const hasFirstFrameRef = useRef(false);
  const tokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<MpvStatus | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(100);
  const [tokenExpiringSoon, setTokenExpiringSoon] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);

  // Derived state
  const isPlaying = status?.playing ?? false;
  const duration = status?.duration ?? 0;
  const position = status?.position ?? 0;
  const speed = status?.speed ?? 1.0;
  const tracks = status?.tracks ?? { audio: [], video: [], sub: [] };
  const cacheDuration = status?.cacheDuration ?? 0;
  const bufferedEnd = duration > 0 ? Math.min(position + cacheDuration, duration) : 0;

  // ── Canvas Frame Rendering Loop ──────────────────────────────────────────

  const paintFrame = useCallback(() => {
    const frame = pendingFrameRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!frame || !canvas) {
      animFrameRef.current = requestAnimationFrame(paintFrame);
      return;
    }

    pendingFrameRef.current = null;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      animFrameRef.current = requestAnimationFrame(paintFrame);
      return;
    }

    // In theater/fullscreen: letterbox to fit container; otherwise stretch to fill
    if ((isFullscreen || isTheater) && container) {
      const cw = container.clientWidth;
      const ch = container.clientHeight;

      // Set canvas to container size so it fills the space
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      // Create an offscreen canvas with the frame data
      const offscreen = new OffscreenCanvas(frame.width, frame.height);
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) {
        animFrameRef.current = requestAnimationFrame(paintFrame);
        return;
      }
      const pixels = new Uint8ClampedArray(frame.data);
      const imageData = new ImageData(pixels, frame.width, frame.height);
      offCtx.putImageData(imageData, 0, 0);

      // Calculate letterbox fit
      const scale = Math.min(cw / frame.width, ch / frame.height);
      const dw = frame.width * scale;
      const dh = frame.height * scale;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;

      // Clear to black (letterbox bars) and draw scaled frame
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(offscreen, dx, dy, dw, dh);
    } else {
      // Normal mode: canvas matches frame exactly, CSS stretches to fit
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      const pixels = new Uint8ClampedArray(frame.data);
      const imageData = new ImageData(pixels, frame.width, frame.height);
      ctx.putImageData(imageData, 0, 0);
    }

    animFrameRef.current = requestAnimationFrame(paintFrame);
  }, [isFullscreen, isTheater]);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(paintFrame);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [paintFrame]);

  // ── Resize observer ──────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isElectron()) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          const dpr = window.devicePixelRatio || 1;
          mpv.resize(Math.round(width * dpr), Math.round(height * dpr));
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ── Load media ───────────────────────────────────────────────────────────

  // Serialize headers for stable dependency comparison
  const headersKey = httpHeaders?.join('|') || '';

  useEffect(() => {
    if (!isElectron() || !src) return;

    setIsLoading(true);
    setHasFirstFrame(false);
    hasFirstFrameRef.current = false;
    setError(null);

    const container = containerRef.current;
    const dpr = window.devicePixelRatio || 1;
    const width = container ? Math.round(container.clientWidth * dpr) : 1280;
    const height = container ? Math.round(container.clientHeight * dpr) : 720;

    mpv.load(src, { width, height, httpHeaders: httpHeaders || [] }).catch((err: any) => {
      setError(err?.message || 'Failed to start mpv');
      setIsLoading(false);
    });

    // Reset token warning when source changes
    setTokenExpiringSoon(false);

    return () => {
      mpv.stop();
    };
  }, [src, headersKey]);

  // ── Subscribe to mpv events ──────────────────────────────────────────────

  useEffect(() => {
    if (!isElectron()) return;

    const unsubStatus = mpv.onStatusUpdate((s) => {
      setStatus(s);
      if (s.playing) setIsLoading(false);
    });

    const unsubError = mpv.onError((err) => {
      setError(err.message);
    });

    const unsubEnded = mpv.onEnded(() => {
      onEnded?.();
    });

    const unsubFrame = mpv.onFrame((frame) => {
      pendingFrameRef.current = frame;
      if (!hasFirstFrameRef.current) {
        hasFirstFrameRef.current = true;
        setHasFirstFrame(true);
      }
    });

    return () => {
      unsubStatus();
      unsubError();
      unsubEnded();
      unsubFrame();
    };
  }, [onEnded]);

  // (fullscreen state is lifted to WatchView and passed as prop)

  // ── Token expiry warning timer ────────────────────────────────────────────

  useEffect(() => {
    if (tokenTimerRef.current) {
      clearTimeout(tokenTimerRef.current);
      tokenTimerRef.current = null;
    }
    setTokenExpiringSoon(false);

    if (!tokenExpiresAt) return;

    const now = Date.now();
    const warningMs = tokenExpiresAt - now - 5 * 60 * 1000; // warn 5 min before

    if (warningMs <= 0) {
      // Already about to expire or expired
      setTokenExpiringSoon(true);
      return;
    }

    tokenTimerRef.current = setTimeout(() => {
      setTokenExpiringSoon(true);
    }, warningMs);

    return () => {
      if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current);
    };
  }, [tokenExpiresAt]);

  // ── Control Helpers ──────────────────────────────────────────────────────

  const togglePlayPause = useCallback(async () => {
    if (isPlaying) await mpv.pause();
    else await mpv.play();
  }, [isPlaying]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    mpv.seek(ratio * duration);
  }, [duration]);

  const handleProgressHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverTime(ratio * duration);
    setHoverX(e.clientX - rect.left);
  }, [duration]);

  const handleProgressLeave = useCallback(() => {
    setHoverTime(null);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseInt(e.target.value, 10);
    setVolume(vol);
    mpv.setVolume(vol);
  }, []);

  const toggleMute = useCallback(() => {
    if (volume > 0) {
      mpv.setVolume(0);
      setVolume(0);
    } else {
      mpv.setVolume(100);
      setVolume(100);
    }
  }, [volume]);

  const seekRelative = useCallback((seconds: number) => {
    mpv.seek(Math.max(0, position + seconds));
  }, [position]);

  const handleSpeedChange = useCallback((newSpeed: number) => {
    mpv.setSpeed(newSpeed);
  }, []);

  const handleSubtitleChange = useCallback((trackId: number) => {
    mpv.setSubtitle(trackId);
    setSettingsPage('main');
  }, []);

  const handleAudioChange = useCallback((trackId: number) => {
    mpv.setAudio(trackId);
    setSettingsPage('main');
  }, []);

  const toggleFullscreen = useCallback(() => {
    mpv.toggleFullscreen();
  }, []);

  const toggleSettings = useCallback(() => {
    setSettingsPage((prev) => (prev ? null : 'main'));
  }, []);

  // ── Auto-hide controls + cursor ─────────────────────────────────────────

  const [cursorHidden, setCursorHidden] = useState(false);

  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    setCursorHidden(false);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
        setSettingsPage(null);
        setCursorHidden(true);
      }
    }, 3000);
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekRelative(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekRelative(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume((v) => {
            const nv = Math.min(150, v + 5);
            mpv.setVolume(nv);
            return nv;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume((v) => {
            const nv = Math.max(0, v - 5);
            mpv.setVolume(nv);
            return nv;
          });
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'Escape':
          if (isFullscreen) {
            e.preventDefault();
            toggleFullscreen();
          } else if (settingsPage) {
            e.preventDefault();
            setSettingsPage(null);
          }
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 't':
          e.preventDefault();
          if (!isFullscreen && onTheaterToggle) onTheaterToggle();
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlayPause, seekRelative, toggleFullscreen, toggleMute, settingsPage, isFullscreen, onTheaterToggle]);

  // ── Not in Electron ──────────────────────────────────────────────────────

  if (!isElectron()) {
    return (
      <div className="aspect-video bg-black flex items-center justify-center border-4 border-border">
        <div className="text-center p-8">
          <Monitor className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-sm text-muted-foreground uppercase font-bold">
            MPV Player requires the Desktop App
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Video playback is handled natively by mpv
          </p>
        </div>
      </div>
    );
  }

  // ── Error State ──────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="aspect-video bg-black flex items-center justify-center border-4 border-destructive">
        <div className="text-center p-8 max-w-md">
          <p className="text-sm text-destructive uppercase font-bold mb-2">PLAYBACK ERROR</p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setIsLoading(true);
              mpv.load(src, { httpHeaders: httpHeaders || [] });
            }}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground text-xs uppercase font-bold border-2 border-foreground hover:bg-primary/80"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Settings Panel (layered submenu) ─────────────────────────────────────

  const renderSettings = () => {
    if (!settingsPage) return null;

    return (
      <div
        className="absolute bottom-8 right-0 w-64 bg-black/95 border-2 border-border text-xs z-50 overflow-hidden"
        style={{ height: '240px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {settingsPage === 'main' && (
          <div className="flex flex-col h-full">
            <div className="px-3 py-2.5 border-b border-white/10 text-muted-foreground uppercase font-bold text-[10px] tracking-wider shrink-0">
              Settings
            </div>
            <div className="flex-1 flex flex-col justify-center p-2 space-y-1">
              <button
                onClick={() => setSettingsPage('subtitles')}
                className="flex items-center justify-between w-full px-3 py-2.5 hover:bg-white/10 text-white/80 hover:text-white transition-colors rounded"
              >
                <span className="flex items-center gap-2.5">
                  <Subtitles className="w-4 h-4" /> Subtitles
                </span>
                <div className="flex items-center gap-1.5 text-white/40">
                  <span className="text-[10px]">
                    {tracks.sub.find((t) => t.selected)?.title ||
                      tracks.sub.find((t) => t.selected)?.lang ||
                      'Off'}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </button>
              <button
                onClick={() => setSettingsPage('audio')}
                className="flex items-center justify-between w-full px-3 py-2.5 hover:bg-white/10 text-white/80 hover:text-white transition-colors rounded"
              >
                <span className="flex items-center gap-2.5">
                  <AudioLines className="w-4 h-4" /> Audio
                </span>
                <div className="flex items-center gap-1.5 text-white/40">
                  <span className="text-[10px]">
                    {tracks.audio.find((t) => t.selected)?.title ||
                      tracks.audio.find((t) => t.selected)?.lang ||
                      'Default'}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </button>
              <button
                onClick={() => setSettingsPage('speed')}
                className="flex items-center justify-between w-full px-3 py-2.5 hover:bg-white/10 text-white/80 hover:text-white transition-colors rounded"
              >
                <span className="flex items-center gap-2.5">
                  <Gauge className="w-4 h-4" /> Playback Speed
                </span>
                <div className="flex items-center gap-1.5 text-white/40">
                  <span className="text-[10px]">{speed === 1 ? 'Normal' : `${speed}x`}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </button>
            </div>
          </div>
        )}

        {settingsPage === 'subtitles' && (
          <div className="flex flex-col h-full">
            <button
              onClick={() => setSettingsPage('main')}
              className="flex items-center gap-2 px-3 py-2.5 border-b border-white/10 text-white/80 hover:text-white font-bold uppercase text-[10px] tracking-wider shrink-0 hover:bg-white/5 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Subtitles
            </button>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
              <button
                onClick={() => handleSubtitleChange(0)}
                className={`block w-full text-left px-3 py-2 hover:bg-white/10 rounded transition-colors ${
                  !tracks.sub.some((t) => t.selected) ? 'text-primary' : 'text-white/70'
                }`}
              >
                Off
              </button>
              {tracks.sub.length === 0 ? (
                <p className="text-white/30 px-3 py-2 italic">No subtitle tracks</p>
              ) : (
                tracks.sub.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleSubtitleChange(t.id)}
                    className={`block w-full text-left px-3 py-2 hover:bg-white/10 rounded transition-colors ${
                      t.selected ? 'text-primary' : 'text-white/70'
                    }`}
                  >
                    {t.title || t.lang || `Track ${t.id}`}
                    {t.lang && t.title ? ` (${t.lang})` : ''}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {settingsPage === 'audio' && (
          <div className="flex flex-col h-full">
            <button
              onClick={() => setSettingsPage('main')}
              className="flex items-center gap-2 px-3 py-2.5 border-b border-white/10 text-white/80 hover:text-white font-bold uppercase text-[10px] tracking-wider shrink-0 hover:bg-white/5 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Audio
            </button>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
              {tracks.audio.length === 0 ? (
                <p className="text-white/30 px-3 py-2 italic">No audio tracks</p>
              ) : (
                tracks.audio.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleAudioChange(t.id)}
                    className={`block w-full text-left px-3 py-2 hover:bg-white/10 rounded transition-colors ${
                      t.selected ? 'text-primary' : 'text-white/70'
                    }`}
                  >
                    {t.title || t.lang || `Track ${t.id}`}
                    {t.lang && t.title ? ` (${t.lang})` : ''}
                    {t.codec ? ` · ${t.codec}` : ''}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {settingsPage === 'speed' && (
          <div className="flex flex-col h-full">
            <button
              onClick={() => setSettingsPage('main')}
              className="flex items-center gap-2 px-3 py-2.5 border-b border-white/10 text-white/80 hover:text-white font-bold uppercase text-[10px] tracking-wider shrink-0 hover:bg-white/5 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Playback Speed
            </button>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
              {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    handleSpeedChange(s);
                    setSettingsPage('main');
                  }}
                  className={`block w-full text-left px-3 py-2 hover:bg-white/10 rounded transition-colors ${
                    speed === s ? 'text-primary' : 'text-white/70'
                  }`}
                >
                  {s === 1 ? 'Normal' : `${s}x`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Player UI ────────────────────────────────────────────────────────────

  const showLoadingOverlay = isLoading || !hasFirstFrame;

  return (
    <div
      ref={containerRef}
      className={`bg-black group ${
        isFullscreen
          ? 'w-full h-full'
          : isTheater
            ? 'relative w-full h-full'
            : 'relative aspect-video border-4 border-border'
      }`}
      style={{ cursor: cursorHidden ? 'none' : 'default' }}
      onMouseMove={showControlsTemporarily}
      onMouseLeave={() => {
        if (isPlaying) {
          setShowControls(false);
          setCursorHidden(true);
        }
        setSettingsPage(null);
      }}
    >
      {/* Canvas for libmpv frame rendering */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: 'auto' }}
      />

      {/* Clickable overlay for play/pause */}
      <div
        className="absolute inset-0 z-10"
        style={{ cursor: cursorHidden ? 'none' : 'pointer' }}
        onClick={togglePlayPause}
        onDoubleClick={toggleFullscreen}
      />

      {/* Loading overlay */}
      {showLoadingOverlay && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
          <div className="text-center">
            <div className="relative w-16 h-16 mx-auto mb-4">
              <div className="absolute inset-0 border-4 border-primary/20 rounded-full" />
              <div className="absolute inset-0 border-4 border-transparent border-t-primary rounded-full animate-spin" />
              <Play className="absolute inset-0 m-auto w-6 h-6 text-primary/60" />
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest animate-pulse">
              Loading...
            </p>
          </div>
        </div>
      )}

      {/* Token expiry warning overlay */}
      {tokenExpiringSoon && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-40 bg-amber-900/95 border-2 border-amber-500 px-4 py-3 flex items-center gap-3 shadow-lg max-w-md">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <div className="flex-1">
            <p className="text-xs text-amber-200 uppercase font-bold">Stream token expiring soon</p>
            <p className="text-[10px] text-amber-300/70 mt-0.5">Direct stream link will expire. Refresh to continue.</p>
          </div>
          {onTokenRefresh && (
            <button
              onClick={(e) => { e.stopPropagation(); onTokenRefresh(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-black text-xs uppercase font-bold hover:bg-amber-400 transition-colors shrink-0"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          )}
        </div>
      )}

      {/* Controls overlay */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 z-30 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="w-full h-1.5 hover:h-3 bg-white/20 cursor-pointer mb-3 group/progress relative transition-all"
          onClick={handleSeek}
          onMouseMove={handleProgressHover}
          onMouseLeave={handleProgressLeave}
        >
          {/* Buffered */}
          <div
            className="absolute top-0 left-0 h-full bg-white/30 transition-all pointer-events-none"
            style={{ width: duration ? `${(bufferedEnd / duration) * 100}%` : '0%' }}
          />
          {/* Played */}
          <div
            className="absolute top-0 left-0 h-full bg-primary transition-all pointer-events-none"
            style={{ width: duration ? `${(position / duration) * 100}%` : '0%' }}
          />
          {/* Scrubber dot */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-primary border-2 border-white rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity pointer-events-none"
            style={{ left: duration ? `calc(${(position / duration) * 100}% - 7px)` : '0' }}
          />
          {/* Hover time tooltip */}
          {hoverTime !== null && (
            <div
              className="absolute -top-9 -translate-x-1/2 bg-black/90 text-white text-[10px] font-mono px-2 py-1 rounded pointer-events-none whitespace-nowrap border border-white/20"
              style={{ left: `${hoverX}px` }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-3">
          {/* Skip back */}
          <button
            onClick={() => seekRelative(-10)}
            className="text-white/70 hover:text-white transition-colors"
            title="Back 10s"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlayPause}
            className="text-white hover:text-primary transition-colors"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
          </button>

          {/* Skip forward */}
          <button
            onClick={() => seekRelative(10)}
            className="text-white/70 hover:text-white transition-colors"
            title="Forward 10s"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          {/* Time */}
          <span className="text-xs text-white/70 font-mono tabular-nums min-w-[100px]">
            {formatTime(position)} / {formatTime(duration)}
          </span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Volume */}
          <button
            onClick={toggleMute}
            className="text-white/70 hover:text-white transition-colors"
          >
            {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min="0"
            max="150"
            value={volume}
            onChange={handleVolumeChange}
            className="w-20 h-1 accent-primary"
          />

          {/* Speed indicator (quick cycle) */}
          <button
            onClick={() => {
              const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
              const idx = speeds.indexOf(speed);
              handleSpeedChange(speeds[(idx + 1) % speeds.length]);
            }}
            className="text-xs text-white/70 hover:text-white font-mono px-1"
            title="Playback speed"
          >
            {speed}x
          </button>

          {/* Settings button */}
          <div className="relative">
            <button
              onClick={toggleSettings}
              className={`transition-colors ${
                settingsPage ? 'text-primary' : 'text-white/70 hover:text-white'
              }`}
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            {renderSettings()}
          </div>

          {/* Theater mode */}
          {!isFullscreen && onTheaterToggle && (
            <button
              onClick={onTheaterToggle}
              className={`transition-colors ${isTheater ? 'text-primary' : 'text-white/70 hover:text-white'}`}
              title={isTheater ? 'Default View (T)' : 'Theater Mode (T)'}
            >
              {isTheater ? (
                <Columns2 className="w-4 h-4" />
              ) : (
                <RectangleHorizontal className="w-4 h-4" />
              )}
            </button>
          )}

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="text-white/70 hover:text-white transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Title overlay (top) */}
      <div
        className={`absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-black/60 to-transparent z-30 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <p className="text-xs text-white/80 uppercase font-bold truncate">{title}</p>
      </div>
    </div>
  );
}
