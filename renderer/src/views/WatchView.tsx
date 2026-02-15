"use client";

import { useEffect, useState } from "react";
import { useNavigation, useRouteParam } from "@/lib/navigation";
import MpvPlayer from "@/components/MpvPlayer";
import { videoApi } from "@/lib/api";
import { formatBytes, formatDate, getFileExtension } from "@/lib/utils";
import { useUserAuth } from "@/lib/auth";
import { isElectron, mpv, electronShell } from "@/lib/electron";
import {
  ArrowLeft,
  Home,
  Share2,
  Download,
  Globe,
  Copy,
  Check,
  Info,
  Loader2,
  Film,
  Monitor,
} from "lucide-react";

// 8bit Components
import { Button } from "@/components/ui/8bit/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/8bit/card";
import { Badge } from "@/components/ui/8bit/badge";

interface VideoDetails {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  created_time?: string | null;
  modified_time?: string | null;
  web_view_link?: string | null;
  web_content_link?: string | null;
}

interface ExternalUrls {
  proxy: string;
  vlc: string;
  mx_player: string;
  web_view: string;
  direct_url: string | null;
  direct_token: string | null;
  direct_vlc_cmd: string | null;
  direct_expires_in: number | null;
}

export default function WatchView() {
  const { isAuthenticated, isLoading: authLoading } = useUserAuth();
  const { navigate, goBack } = useNavigation();
  const videoId = useRouteParam("id") || "";

  const [video, setVideo] = useState<VideoDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"info" | "stream">("info");
  const [externalUrls, setExternalUrls] = useState<ExternalUrls | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string>("");
  const [httpHeaders, setHttpHeaders] = useState<string[]>([]);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTheater, setIsTheater] = useState(false);

  // ── Subscribe to fullscreen state changes from main process ──────────────
  useEffect(() => {
    if (!isElectron()) return;
    return mpv.onFullscreenChange((isFs: boolean) => {
      setIsFullscreen(isFs);
    });
  }, []);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("login");
    }
  }, [authLoading, isAuthenticated, navigate]);

  /** Fetch a direct URL (zero-bandwidth) if available, falling back to proxy. */
  const resolveDirectStream = async (vid: string) => {
    try {
      const extData = await videoApi.getExternalUrls(vid);
      setExternalUrls(extData.urls);

      if (extData.urls.direct_url && extData.urls.direct_token) {
        // Use the direct Google Drive URL (bypasses server bandwidth)
        setStreamUrl(extData.urls.direct_url);
        setHttpHeaders([`Authorization: Bearer ${extData.urls.direct_token}`]);
        const expiresIn = extData.urls.direct_expires_in || 3600;
        setTokenExpiresAt(Date.now() + expiresIn * 1000);
        console.log('[WatchView] Using direct stream (zero bandwidth)');
        return;
      }
    } catch {
      // non-critical — fall through to proxy
    }
    // Fallback: use the proxy stream through our server
    const url = await videoApi.getStreamUrl(vid);
    setStreamUrl(url);
    setHttpHeaders([]);
    setTokenExpiresAt(null);
    console.log('[WatchView] Using proxy stream (no direct URL available)');
  };

  /** Called by the player when the token is about to expire. */
  const handleTokenRefresh = async () => {
    if (!videoId) return;
    const currentPosition = 0; // Will resume from where mpv seeks
    try {
      const extData = await videoApi.getExternalUrls(videoId);
      if (extData.urls.direct_url && extData.urls.direct_token) {
        setStreamUrl(extData.urls.direct_url);
        setHttpHeaders([`Authorization: Bearer ${extData.urls.direct_token}`]);
        const expiresIn = extData.urls.direct_expires_in || 3600;
        setTokenExpiresAt(Date.now() + expiresIn * 1000);
        console.log('[WatchView] Direct stream token refreshed');
        return;
      }
    } catch {
      // Fall back to proxy
    }
    // If we can't get a fresh direct URL, switch to proxy
    const url = await videoApi.getStreamUrl(videoId);
    setStreamUrl(url);
    setHttpHeaders([]);
    setTokenExpiresAt(null);
    console.log('[WatchView] Token refresh failed — switched to proxy stream');
  };

  useEffect(() => {
    if (!videoId || !isAuthenticated) return;

    const fetchVideo = async () => {
      try {
        setLoading(true);
        const data = await videoApi.getVideo(videoId);
        setVideo(data);

        // Resolve stream URL: prefer direct (zero-bandwidth), fallback to proxy
        await resolveDirectStream(videoId);
      } catch {
        setError("Video not found");
      } finally {
        setLoading(false);
      }
    };

    fetchVideo();
  }, [videoId, isAuthenticated]);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copy this URL:", text);
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (authLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground text-sm uppercase animate-pulse">
            Loading video protocols...
          </p>
        </div>
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full border-4 border-destructive">
          <CardContent className="flex flex-col items-center p-8 text-center">
            <div className="w-16 h-16 bg-destructive border-4 border-foreground flex items-center justify-center mb-6 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
              <Film className="w-8 h-8 text-destructive-foreground" />
            </div>
            <h2 className="text-xl font-bold uppercase text-foreground mb-2">
              Video Missing
            </h2>
            <p className="text-sm font-mono text-muted-foreground mb-6">
              {error || "ERROR 404: TAPE NOT FOUND"}
            </p>
            <Button
              className="font-bold uppercase border-2"
              onClick={() => navigate("home")}
            >
              <ArrowLeft className="w-4 h-4 mr-2" /> Return to Library
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ext = getFileExtension(video.name);

  return (
    <div className={isFullscreen ? "h-screen w-screen bg-black overflow-hidden" : isTheater ? "h-screen w-screen bg-black overflow-hidden" : "min-h-screen bg-background text-foreground"}>
      {/* Header — hidden in fullscreen */}
      <header className={`${isFullscreen || isTheater ? "hidden" : ""} sticky top-0 z-50 bg-background border-b-4 border-border shadow-[0_4px_0_0_rgba(0,0,0,0.5)]`}>
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <Button
                onClick={() => goBack()}
                variant="outline"
                size="icon"
                className="h-10 w-10 border-2"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>

              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => navigate("home")}
                  className="flex items-center gap-3 shrink-0 group"
                >
                  <div className="w-10 h-10 bg-primary border-2 border-foreground flex items-center justify-center shadow-[4px_4px_0_0_rgba(0,0,0,1)] group-hover:translate-x-1 group-hover:translate-y-1 group-hover:shadow-none transition-all rounded-md overflow-hidden">
                    <img
                      src="./logo.png"
                      alt="Logo"
                      width={40}
                      height={40}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </button>
                <div className="hidden sm:block">
                  <span className="text-lg font-bold tracking-tight block leading-none">
                    <span className="text-foreground">CHEAP</span>
                    <span className="text-primary">TRICKS</span>
                  </span>
                  <p
                    className="text-xs text-muted-foreground truncate max-w-sm uppercase font-mono mt-0.5"
                    title={video.name}
                  >
                    Now Playing: {video.name}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={() => navigate("home")}
                variant="outline"
                size="icon"
                className="border-2"
              >
                <Home className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className={isFullscreen ? "h-full" : isTheater ? "h-full w-full" : "max-w-[1600px] mx-auto px-4 sm:px-6 py-8"}>
        <div className={isFullscreen ? "h-full" : isTheater ? "h-full w-full" : "grid grid-cols-1 lg:grid-cols-3 gap-8"}>
          {/* Video Player */}
          <div className={isFullscreen ? "h-full" : isTheater ? "h-full w-full" : "lg:col-span-2 space-y-6"}>
            {/* Retro Monitor Frame — stripped in fullscreen & theater */}
            <div className={isFullscreen || isTheater ? "h-full w-full" : "bg-foreground p-1 sm:p-2 rounded-lg shadow-[8px_8px_0_0_rgba(0,0,0,0.3)]"}>
              <div className={isFullscreen || isTheater ? "h-full w-full" : "bg-black border-4 border-gray-700 rounded-sm overflow-hidden relative"}>
                <MpvPlayer
                  src={streamUrl}
                  title={video.name}
                  isFullscreen={isFullscreen}
                  isTheater={isTheater}
                  httpHeaders={httpHeaders}
                  tokenExpiresAt={tokenExpiresAt}
                  onTokenRefresh={handleTokenRefresh}
                  onTheaterToggle={() => setIsTheater((prev) => !prev)}
                />
              </div>
            </div>

            {/* Video title & meta — hidden in fullscreen */}
            {!isFullscreen && !isTheater && (<>
            <Card className="border-4 border-primary shadow-[8px_8px_0_0_var(--primary)]">
              <CardContent className="p-4 sm:p-6">
                <h1 className="text-lg sm:text-xl font-bold uppercase leading-tight mb-4 break-all">
                  {video.name}
                </h1>
                <div className="flex flex-wrap items-center gap-3">
                  {ext && (
                    <Badge
                      variant="secondary"
                      className="text-xs uppercase font-bold border-2 border-foreground"
                    >
                      FMT: {ext}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className="text-xs uppercase font-bold border-2"
                  >
                    SIZE: {formatBytes(video.size)}
                  </Badge>
                  {video.created_time && (
                    <span className="text-xs font-mono uppercase text-muted-foreground">
                      DATE: {formatDate(video.created_time).split(",")[0]}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Tabs */}
            <div className="space-y-4">
              <div className="flex gap-4 border-b-4 border-border pb-4 overflow-x-auto">
                <Button
                  onClick={() => setActiveTab("info")}
                  variant={activeTab === "info" ? "default" : "outline"}
                  className="rounded-none border-2 font-bold uppercase"
                >
                  <Info className="w-4 h-4 mr-2" /> Details
                </Button>
                <Button
                  onClick={() => setActiveTab("stream")}
                  variant={activeTab === "stream" ? "secondary" : "outline"}
                  className="rounded-none border-2 font-bold uppercase"
                >
                  <Monitor className="w-4 h-4 mr-2" /> Stream Info
                </Button>
              </div>

              <div className="min-h-[300px]">
                {activeTab === "info" ? (
                  <Card className="border-2 border-border bg-card">
                    <CardContent className="p-6">
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
                        <div>
                          <dt className="text-xs text-primary uppercase font-bold mb-1">
                            File Name
                          </dt>
                          <dd className="text-sm font-mono break-all border-b-2 border-dashed border-border/50 pb-1">
                            {video.name}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-primary uppercase font-bold mb-1">
                            File Size
                          </dt>
                          <dd className="text-sm font-mono border-b-2 border-dashed border-border/50 pb-1">
                            {formatBytes(video.size)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-primary uppercase font-bold mb-1">
                            MIME Type
                          </dt>
                          <dd className="text-sm font-mono border-b-2 border-dashed border-border/50 pb-1">
                            {video.mime_type}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-primary uppercase font-bold mb-1">
                            Format
                          </dt>
                          <dd className="text-sm font-mono border-b-2 border-dashed border-border/50 pb-1">
                            {ext || "UNKNOWN"}
                          </dd>
                        </div>
                        {video.created_time && (
                          <div>
                            <dt className="text-xs text-primary uppercase font-bold mb-1">
                              Added
                            </dt>
                            <dd className="text-sm font-mono border-b-2 border-dashed border-border/50 pb-1">
                              {formatDate(video.created_time)}
                            </dd>
                          </div>
                        )}
                      </dl>

                      {video.web_view_link && (
                        <div className="mt-8 pt-4 border-t-4 border-border">
                          <Button
                            variant="outline"
                            className="w-full border-2 border-dashed font-bold uppercase"
                            onClick={() => {
                              if (!video.web_view_link) return;
                              if (isElectron()) {
                                electronShell.openExternal(video.web_view_link);
                              } else {
                                window.open(video.web_view_link, "_blank");
                              }
                            }}
                          >
                            <Globe className="w-4 h-4 mr-2" /> Open in Google
                            Drive
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="border-2 border-border bg-card">
                    <CardContent className="p-6 space-y-4">
                      <p className="text-xs text-muted-foreground uppercase font-mono">
                        Streaming via native mpv player with zero-bandwidth
                        direct Google Drive access. Hardware-accelerated decoding enabled.
                      </p>
                      {streamUrl && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold uppercase text-primary">
                              Stream URL
                            </span>
                            <Button
                              onClick={() =>
                                copyToClipboard(streamUrl, "stream-url")
                              }
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs font-bold uppercase"
                            >
                              {copiedField === "stream-url"
                                ? "COPIED!"
                                : "COPY"}
                            </Button>
                          </div>
                          <div className="bg-black p-2 border-2 border-primary/30 overflow-x-auto">
                            <code className="text-xs text-primary font-mono whitespace-nowrap">
                              {streamUrl}
                            </code>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
            </>)}
          </div>

          {/* Sidebar (1/3) — hidden in fullscreen & theater */}
          {!isFullscreen && !isTheater && (
          <div className="lg:col-span-1 border-l-4 border-dashed border-border pl-0 lg:pl-6 pt-6 lg:pt-0">
            <div className="sticky top-24 space-y-6">
              {/* Quick actions */}
              <Card className="border-2 border-border bg-card">
                <CardHeader className="bg-muted/20 border-b-2 border-border p-4">
                  <CardTitle className="text-sm uppercase">
                    Operations
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {video.web_view_link && (
                    <Button
                      variant="outline"
                      className="w-full justify-start border-2 font-bold uppercase"
                      onClick={() => {
                        if (!video.web_view_link) return;
                        if (isElectron()) {
                          electronShell.openExternal(video.web_view_link);
                        } else {
                          window.open(video.web_view_link, "_blank");
                        }
                      }}
                    >
                      <Globe className="w-4 h-4 mr-2" /> Open Drive
                    </Button>
                  )}

                  {streamUrl && (
                    <Button
                      variant="default"
                      className="w-full justify-start border-2 font-bold uppercase"
                      onClick={() =>
                        copyToClipboard(streamUrl, "download-url")
                      }
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      {copiedField === "download-url"
                        ? "Copied!"
                        : "Copy Stream URL"}
                      <Badge
                        variant="outline"
                        className="ml-auto text-xs border-white text-white"
                      >
                        {formatBytes(video.size)}
                      </Badge>
                    </Button>
                  )}
                </CardContent>
              </Card>

              {/* Features */}
              <Card className="border-2 border-border bg-card">
                <CardHeader className="bg-muted/20 border-b-2 border-border p-4">
                  <CardTitle className="text-sm uppercase">
                    System Specs
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <ul className="space-y-2">
                    {[
                      "Native mpv playback",
                      "Hardware-accelerated decode",
                      "MKV / ASS subtitle support",
                      "Keyboard shortcuts",
                      "Playback speed control",
                    ].map((feat) => (
                      <li
                        key={feat}
                        className="flex items-center gap-2 text-xs uppercase font-bold text-muted-foreground"
                      >
                        <div className="w-2 h-2 bg-green-500 border border-foreground" />
                        {feat}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {/* Keyboard shortcuts */}
              <Card className="border-2 border-border bg-card">
                <CardHeader className="bg-muted/20 border-b-2 border-border p-4">
                  <CardTitle className="text-sm uppercase">Controls</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-2">
                  {[
                    ["Space / K", "Play / Pause"],
                    ["F", "Fullscreen"],
                    ["T", "Theater Mode"],
                    ["M", "Mute"],
                    ["← / →", "Seek ±10s"],
                    ["↑ / ↓", "Volume"],
                  ].map(([key, desc]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between text-xs font-bold uppercase"
                    >
                      <span className="px-1 bg-muted border border-border text-foreground">
                        {key}
                      </span>
                      <span className="text-muted-foreground">{desc}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
          )}
        </div>
      </main>
    </div>
  );
}
