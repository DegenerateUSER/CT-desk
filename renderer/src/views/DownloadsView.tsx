"use client";

import { useState, useEffect } from "react";
import { useNavigation } from "@/lib/navigation";
import { useUserAuth } from "@/lib/auth";
import { activeTorrentsApi, ActiveTorrent } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import {
  Loader2,
  ArrowDown,
  ArrowUp,
  HardDrive,
  RefreshCw,
  AlertTriangle,
  Activity,
  Check,
  Upload,
  Trash2,
  User,
  X,
  Download,
  Clock,
  Timer,
} from "lucide-react";

import { Button } from "@/components/ui/8bit/button";
import {
  Card,
  CardContent,
} from "@/components/ui/8bit/card";
import { Badge } from "@/components/ui/8bit/badge";
import { Progress } from "@/components/ui/8bit/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/8bit/dialog";

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function DownloadsView() {
  const { isAuthenticated, isLoading: authLoading, user } = useUserAuth();
  const { navigate } = useNavigation();

  const [activeTorrents, setActiveTorrents] = useState<ActiveTorrent[]>([]);
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  const [stopErrors, setStopErrors] = useState<Record<string, string>>({});
  const [confirmStop, setConfirmStop] = useState<ActiveTorrent | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("login");
    }
  }, [authLoading, isAuthenticated, navigate]);

  // Poll active torrents every 3 seconds
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;

    const fetchActive = async () => {
      try {
        const data = await activeTorrentsApi.list();
        if (!cancelled) {
          setActiveTorrents(Object.values(data));
        }
      } catch {
        // silent
      }
    };

    fetchActive();
    const interval = setInterval(fetchActive, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  const handleStop = async (torrent: ActiveTorrent) => {
    setConfirmStop(null);
    setStopping((prev) => new Set(prev).add(torrent.info_hash));
    setStopErrors((prev) => {
      const n = { ...prev };
      delete n[torrent.info_hash];
      return n;
    });

    try {
      await activeTorrentsApi.stopTorrent(torrent.info_hash);
      setActiveTorrents((prev) =>
        prev.filter((t) => t.info_hash !== torrent.info_hash),
      );
    } catch (err: any) {
      setStopErrors((prev) => ({
        ...prev,
        [torrent.info_hash]: err.message || "Failed to stop torrent",
      }));
    } finally {
      setStopping((prev) => {
        const n = new Set(prev);
        n.delete(torrent.info_hash);
        return n;
      });
    }
  };

  const handleRetry = async (infoHash: string) => {
    try {
      await activeTorrentsApi.retryUpload(infoHash);
    } catch (e) {
      console.error("Retry failed:", e);
    }
  };

  if (authLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const downloading = activeTorrents.filter(
    (t) => !t.is_finished && !t.uploaded && !t.upload_failed,
  );
  const uploading = activeTorrents.filter(
    (t) => t.uploading && !t.upload_failed,
  );
  const completed = activeTorrents.filter((t) => t.uploaded);
  const failed = activeTorrents.filter(
    (t) => t.upload_failed || (!!t.upload_error && !t.uploading && !t.uploaded),
  );

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b-4 border-border shadow-[0_4px_0_0_rgba(0,0,0,0.5)]">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate("home")}
                className="flex items-center gap-3 shrink-0 group"
              >
                <div className="w-10 h-10 border-2 border-foreground flex items-center justify-center shadow-[4px_4px_0_0_rgba(0,0,0,1)] group-hover:translate-x-1 group-hover:translate-y-1 group-hover:shadow-none transition-all rounded-md overflow-hidden bg-white">
                  <img
                    src="/logo.png"
                    alt="Logo"
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="text-lg font-bold tracking-tight hidden sm:block">
                  <span className="text-foreground">CHEAP</span>
                  <span className="text-primary">TRICKS</span>
                </span>
              </button>
              <span className="text-muted-foreground hidden sm:block">/</span>
              <h1 className="text-sm font-bold text-muted-foreground uppercase hidden sm:block">
                Active Torrents
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => navigate("search")}
                variant="outline"
                size="sm"
                className="gap-2 border-2 h-9"
              >
                <Download className="w-4 h-4" />
                <span className="text-xs font-bold uppercase hidden sm:inline">
                  Search
                </span>
              </Button>
              {user && (
                <button onClick={() => navigate("profile")}>
                  <div className="flex items-center gap-2 px-2 py-1 bg-card border-2 border-border shadow-[2px_2px_0_0_rgba(0,0,0,1)] hover:translate-y-0.5 hover:shadow-sm transition-all cursor-pointer">
                    <div className="w-6 h-6 bg-secondary border-2 border-foreground flex items-center justify-center text-xs font-bold text-secondary-foreground">
                      {user.display_name?.charAt(0).toUpperCase() ||
                        user.username.charAt(0).toUpperCase()}
                    </div>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8">
        {/* Stats summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <Card className="border-2">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-primary">
                {downloading.length}
              </div>
              <div className="text-xs text-muted-foreground uppercase font-bold mt-1">
                Downloading
              </div>
            </CardContent>
          </Card>
          <Card className="border-2">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-secondary">
                {uploading.length}
              </div>
              <div className="text-xs text-muted-foreground uppercase font-bold mt-1">
                Uploading
              </div>
            </CardContent>
          </Card>
          <Card className="border-2">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600">
                {completed.length}
              </div>
              <div className="text-xs text-muted-foreground uppercase font-bold mt-1">
                Completed
              </div>
            </CardContent>
          </Card>
          <Card className="border-2">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-destructive">
                {failed.length}
              </div>
              <div className="text-xs text-muted-foreground uppercase font-bold mt-1">
                Failed
              </div>
            </CardContent>
          </Card>
        </div>

        {activeTorrents.length === 0 ? (
          <Card className="p-12 text-center border-4 border-dashed border-border bg-transparent shadow-none">
            <Activity className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-30" />
            <h3 className="text-xl font-bold uppercase text-foreground mb-2">
              No Active Torrents
            </h3>
            <p className="text-sm text-muted-foreground uppercase font-mono mb-6">
              Go to search to add some torrents.
            </p>
            <Button
              onClick={() => navigate("search")}
              className="uppercase font-bold"
            >
              <Download className="w-4 h-4 mr-2" /> Search Torrents
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {activeTorrents.map((t) => {
              const dlPercent = Math.round(t.progress * 100);
              const isFailed =
                t.upload_failed ||
                (!!t.upload_error && !t.uploading && !t.uploaded);
              const isDownloading =
                !t.is_finished && !t.uploaded && !isFailed;
              const isUploading = t.uploading && !isFailed;
              const isDone = t.uploaded && !isFailed;
              const isStopping = stopping.has(t.info_hash);
              const canStop =
                user &&
                (t.added_by === user.username ||
                  user.role === "admin" ||
                  user.is_admin);
              const stopError = stopErrors[t.info_hash];

              return (
                <Card
                  key={t.info_hash}
                  className={`border-2 overflow-hidden transition-colors ${
                    isFailed
                      ? "border-destructive/50"
                      : isDone
                        ? "border-green-500/50"
                        : isUploading
                          ? "border-secondary/50"
                          : "border-border"
                  }`}
                >
                  <CardContent className="p-5">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-bold text-foreground truncate uppercase font-mono"
                          title={t.name}
                        >
                          {t.name || t.info_hash.slice(0, 12)}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground uppercase font-mono flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {t.added_by || "unknown"}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono">
                            {formatBytes(t.total_size)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Status badge */}
                        <Badge
                          variant={
                            isFailed
                              ? "destructive"
                              : isDone
                                ? "default"
                                : "secondary"
                          }
                          className="text-xs uppercase font-bold"
                        >
                          {isFailed
                            ? "Failed"
                            : isDone
                              ? "Uploaded"
                              : isUploading
                                ? "Uploading"
                                : isDownloading
                                  ? `${dlPercent}%`
                                  : t.status}
                        </Badge>

                        {/* Retry button for failed */}
                        {isFailed && (
                          <Button
                            onClick={() => handleRetry(t.info_hash)}
                            variant="destructive"
                            size="sm"
                            className="h-7 text-xs px-2 font-bold uppercase gap-1"
                          >
                            <RefreshCw className="w-3 h-3" /> Retry
                          </Button>
                        )}

                        {/* Stop button — only for owner or admin */}
                        {canStop && (
                          <Button
                            onClick={() => setConfirmStop(t)}
                            disabled={isStopping}
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs px-2 font-bold uppercase gap-1 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                          >
                            {isStopping ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Trash2 className="w-3 h-3" />
                            )}
                            {isStopping ? "..." : "Stop"}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Progress bar */}
                    <Progress
                      value={
                        isUploading
                          ? Math.round(t.upload_progress * 100)
                          : isDone
                            ? 100
                            : dlPercent
                      }
                      variant="retro"
                      progressBg={
                        isFailed
                          ? "bg-destructive"
                          : isUploading
                            ? "bg-secondary"
                            : isDone
                              ? "bg-green-500"
                              : "bg-primary"
                      }
                      className="h-5 border-2 border-border mb-3 bg-muted/50"
                    />

                    {/* Stats row */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      {isFailed && (
                        <span className="flex items-center gap-1 text-xs text-destructive font-bold uppercase">
                          <AlertTriangle className="w-3 h-3" />
                          {t.upload_error || "Upload failed"}
                        </span>
                      )}
                      {isDownloading && (
                        <>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground uppercase font-mono">
                            <ArrowDown className="w-3 h-3 text-primary" />
                            {formatBytes(t.download_rate)}/s
                          </span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground uppercase font-mono">
                            <ArrowUp className="w-3 h-3 text-secondary" />
                            {formatBytes(t.upload_rate)}/s
                          </span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground uppercase font-mono">
                            <HardDrive className="w-3 h-3" />
                            {formatBytes(t.downloaded)} /{" "}
                            {formatBytes(t.total_size)}
                          </span>
                          {t.download_rate > 0 && t.total_size > 0 && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground uppercase font-mono">
                              <Timer className="w-3 h-3 text-primary" />
                              ETA {formatDuration((t.total_size - t.downloaded) / t.download_rate)}
                            </span>
                          )}
                          {t.added_at && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground uppercase font-mono">
                              <Clock className="w-3 h-3" />
                              {formatDuration(Date.now() / 1000 - t.added_at)} elapsed
                            </span>
                          )}
                        </>
                      )}
                      {isUploading && (
                        <>
                          <span className="text-xs text-muted-foreground uppercase font-mono flex items-center gap-1">
                            <Upload className="w-3 h-3" />
                            {formatBytes(t.upload_bytes_done)} /{" "}
                            {formatBytes(t.upload_bytes_total)} to Drive
                          </span>
                          {t.upload_started_at && t.upload_bytes_done > 0 && t.upload_bytes_total > 0 && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground uppercase font-mono">
                              <Timer className="w-3 h-3 text-secondary" />
                              ETA {formatDuration(
                                ((t.upload_bytes_total - t.upload_bytes_done) /
                                  (t.upload_bytes_done / (Date.now() / 1000 - Number(t.upload_started_at))))
                              )}
                            </span>
                          )}
                          {t.added_at && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground uppercase font-mono">
                              <Clock className="w-3 h-3" />
                              {formatDuration(Date.now() / 1000 - t.added_at)} elapsed
                            </span>
                          )}
                        </>
                      )}
                      {isDone && (
                        <span className="flex items-center gap-1 text-xs text-green-600 font-bold uppercase">
                          <Check className="w-3 h-3" /> Uploaded to Google Drive
                        </span>
                      )}
                    </div>

                    {/* Stop error */}
                    {stopError && (
                      <div className="mt-2 p-2 bg-destructive/10 border-2 border-destructive text-destructive text-xs font-bold uppercase flex items-center gap-2">
                        <AlertTriangle className="w-3 h-3" />
                        {stopError}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* Confirm stop dialog */}
      <Dialog
        open={!!confirmStop}
        onOpenChange={(open) => !open && setConfirmStop(null)}
      >
        <DialogContent className="max-w-md border-4 border-destructive shadow-[8px_8px_0_0_rgba(0,0,0,0.5)] bg-card p-0 gap-0">
          <DialogHeader className="p-4 border-b-4 border-border bg-destructive/10">
            <DialogTitle className="text-lg uppercase flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Stop Torrent?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground uppercase font-mono">
              This will stop the torrent and delete ALL local files permanently.
            </DialogDescription>
          </DialogHeader>

          <div className="p-4">
            <p className="text-sm font-bold uppercase font-mono truncate mb-4">
              {confirmStop?.name}
            </p>
            <p className="text-xs text-muted-foreground uppercase">
              Total size:{" "}
              {confirmStop ? formatBytes(confirmStop.total_size) : ""}
            </p>
          </div>

          <DialogFooter className="p-4 border-t-4 border-border bg-muted/20 flex-row gap-2 justify-end">
            <Button
              onClick={() => setConfirmStop(null)}
              variant="outline"
              className="border-2 font-bold uppercase flex-1 sm:flex-none"
            >
              <X className="w-4 h-4 mr-1" /> Cancel
            </Button>
            <Button
              onClick={() => confirmStop && handleStop(confirmStop)}
              variant="destructive"
              className="font-bold uppercase flex-1 sm:flex-none gap-2"
            >
              <Trash2 className="w-4 h-4" /> Stop & Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
