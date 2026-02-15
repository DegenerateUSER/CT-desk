"use client";

import { useState, useEffect, useCallback } from "react";
import { useNavigation } from "@/lib/navigation";
import { useUserAuth } from "@/lib/auth";
import {
  torrentSearchApi,
  activeTorrentsApi,
  TorrentSearchResult,
  TorrentDetail,
  ActiveTorrent,
} from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import {
  Search,
  Loader2,
  Download,
  Clock,
  HardDrive,
  ChevronLeft,
  ChevronRight,
  Check,
  AlertCircle,
  Film,
  Sparkles,
  X,
  ArrowDown,
  ArrowUp,
  Copy,
  RefreshCw,
  AlertTriangle,
  Activity,
  User,
} from "lucide-react";

// 8bit Components
import { Button } from "@/components/ui/8bit/button";
import { Input } from "@/components/ui/8bit/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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

type Category = "anime" | "movies";

export default function SearchView() {
  const { isAuthenticated, isLoading: authLoading, user } = useUserAuth();
  const { navigate } = useNavigation();

  const [category, setCategory] = useState<Category>("anime");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TorrentSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasSearched, setHasSearched] = useState(false);

  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});

  const [sortBy, setSortBy] = useState<"seeders" | "size" | "time">("seeders");

  const [selectedTorrent, setSelectedTorrent] =
    useState<TorrentSearchResult | null>(null);
  const [torrentDetail, setTorrentDetail] = useState<TorrentDetail | null>(
    null
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [activeTorrents, setActiveTorrents] = useState<ActiveTorrent[]>([]);
  const [showActiveTorrents, setShowActiveTorrents] = useState(true);

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

  const openDetail = async (torrent: TorrentSearchResult) => {
    setSelectedTorrent(torrent);
    setTorrentDetail(null);
    setDetailError("");
    setDetailLoading(true);

    try {
      const detail = await torrentSearchApi.getDetail(
        torrent.source,
        torrent.torrent_id
      );
      setTorrentDetail(detail);
    } catch (err: any) {
      setDetailError(err.message || "Failed to load details");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedTorrent(null);
    setTorrentDetail(null);
    setDetailError("");
  };

  const copyMagnet = (magnet: string) => {
    navigator.clipboard.writeText(magnet).catch(() => {});
  };

  const handleSearch = useCallback(
    async (searchPage: number = 1) => {
      if (!query.trim()) return;

      setLoading(true);
      setError("");
      setHasSearched(true);
      setPage(searchPage);

      try {
        const data = await torrentSearchApi.search(
          query.trim(),
          category,
          searchPage
        );
        setResults(data.results);
      } catch (err: any) {
        setError(err.message || "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [query, category]
  );

  const handleAddTorrent = async (torrent: TorrentSearchResult) => {
    const id = `${torrent.source}-${torrent.torrent_id}`;
    setAddingIds((prev) => new Set(prev).add(id));
    setAddErrors((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });

    try {
      await torrentSearchApi.addTorrent({
        source: torrent.source,
        torrent_id: torrent.torrent_id,
        magnet: torrent.magnet || null,
        name: torrent.name,
      });
      setAddedIds((prev) => new Set(prev).add(id));
    } catch (err: any) {
      setAddErrors((prev) => ({
        ...prev,
        [id]: err.message || "Failed to add",
      }));
    } finally {
      setAddingIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch(1);
  };

  const sortedResults = [...results].sort((a, b) => {
    if (sortBy === "seeders") return b.seeders - a.seeders;
    if (sortBy === "time") return (b.time || "").localeCompare(a.time || "");
    return 0;
  });

  if (authLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const activeDl = activeTorrents.filter(
    (t) => !t.is_finished && !t.uploaded && !t.upload_failed
  );
  const activeUploading = activeTorrents.filter((t) => t.uploading);
  const completed = activeTorrents.filter((t) => t.uploaded);
  const failed = activeTorrents.filter((t) => t.upload_failed);
  const hasActive =
    activeDl.length > 0 ||
    activeUploading.length > 0 ||
    completed.length > 0 ||
    failed.length > 0;

  const activeNames = new Set(activeTorrents.map((t) => t.name));

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
                    src="./logo.png"
                    alt="Logo"
                    width={40}
                    height={40}
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
                Torrent Search
              </h1>
            </div>
            <div className="flex items-center gap-3">
              {hasActive && (
                <Button
                  onClick={() => setShowActiveTorrents(!showActiveTorrents)}
                  variant={showActiveTorrents ? "secondary" : "outline"}
                  size="sm"
                  className="gap-2 border-2 h-9"
                >
                  <Activity className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase hidden sm:inline">
                    {activeDl.length + activeUploading.length} active
                  </span>
                  {activeDl.length > 0 && (
                    <span className="w-2 h-2 bg-primary animate-pulse" />
                  )}
                </Button>
              )}
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
        {/* Active Torrents Progress */}
        {hasActive && showActiveTorrents && (
          <Card className="mb-8 border-4 border-primary shadow-[8px_8px_0_0_var(--primary)] bg-card overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between py-3 border-b-4 border-border bg-muted/20">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                <CardTitle className="text-sm font-bold uppercase">
                  Active Operations
                </CardTitle>
                <Badge
                  variant="outline"
                  className="text-xs bg-white text-black border-black font-bold"
                >
                  {activeTorrents.length}
                </Badge>
              </div>
              <Button
                onClick={() => setShowActiveTorrents(false)}
                variant="ghost"
                size="icon"
                className="h-6 w-6"
              >
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>
            <div className="divide-y-4 divide-border max-h-[320px] overflow-y-auto">
              {activeTorrents.map((t) => {
                const dlPercent = Math.round(t.progress * 100);
                const isFailed =
                  t.upload_failed ||
                  (!!t.upload_error && !t.uploading && !t.uploaded);
                const isDownloading =
                  !t.is_finished && !t.uploaded && !isFailed;
                const isUploading = t.uploading && !isFailed;
                const isDone = t.uploaded && !isFailed;

                const handleRetry = async () => {
                  try {
                    await activeTorrentsApi.retryUpload(t.info_hash);
                  } catch (e) {
                    console.error("Retry failed:", e);
                  }
                };

                return (
                  <div key={t.info_hash} className="px-5 py-3 bg-card">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p
                        className="text-xs font-bold text-foreground truncate flex-1 uppercase font-mono"
                        title={t.name}
                      >
                        {t.name || t.info_hash.slice(0, 12)}
                      </p>
                      <div className="flex items-center gap-2">
                        {isFailed && (
                          <Button
                            onClick={handleRetry}
                            variant="destructive"
                            size="sm"
                            className="h-6 text-xs px-2 font-bold uppercase gap-1"
                          >
                            <RefreshCw className="w-3 h-3" /> Retry
                          </Button>
                        )}
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
                      </div>
                    </div>

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
                            : "bg-primary"
                      }
                      className="h-5 border-2 border-border mb-2 bg-muted/50"
                    />

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
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
                        </>
                      )}
                      {isUploading && (
                        <span className="text-xs text-muted-foreground uppercase font-mono">
                          {formatBytes(t.upload_bytes_done)} /{" "}
                          {formatBytes(t.upload_bytes_total)} to Drive
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Category toggle */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <Button
            onClick={() => {
              setCategory("anime");
              setResults([]);
              setHasSearched(false);
            }}
            variant={category === "anime" ? "default" : "outline"}
            className={`gap-2 border-2 uppercase font-bold ${category === "anime" ? "shadow-[4px_4px_0_0_var(--primary)] translate-x-[-2px] translate-y-[-2px]" : ""}`}
          >
            <Sparkles className="w-4 h-4" />
            Anime (Nyaa)
          </Button>
          <Button
            onClick={() => {
              setCategory("movies");
              setResults([]);
              setHasSearched(false);
            }}
            variant={category === "movies" ? "secondary" : "outline"}
            className={`gap-2 border-2 uppercase font-bold ${category === "movies" ? "shadow-[4px_4px_0_0_var(--secondary)] translate-x-[-2px] translate-y-[-2px]" : ""}`}
          >
            <Film className="w-4 h-4" />
            Movies (TPB)
          </Button>
        </div>

        {/* Search bar */}
        <div className="max-w-2xl mx-auto mb-10">
          <div className="relative flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={
                  category === "anime" ? "SEARCH NYAA.SI..." : "SEARCH TPB..."
                }
                className="pl-12 h-12 text-sm uppercase font-bold border-2 shadow-[4px_4px_0_0_rgba(0,0,0,0.2)] focus:shadow-[4px_4px_0_0_var(--primary)] transition-all"
                autoFocus
              />
            </div>
            <Button
              onClick={() => handleSearch(1)}
              disabled={loading || !query.trim()}
              className="h-12 w-32 border-2 font-bold uppercase shadow-[4px_4px_0_0_rgba(0,0,0,1)] hover:translate-y-1 hover:shadow-none transition-all"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Search"
              )}
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="max-w-2xl mx-auto mb-8 p-4 bg-destructive border-4 border-black text-destructive-foreground font-bold uppercase flex items-center gap-3 shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
            <AlertCircle className="w-6 h-6 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && hasSearched && results.length === 0 && (
          <Card className="max-w-md mx-auto p-8 text-center border-4 border-dashed border-border bg-transparent shadow-none">
            <Search className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-xl font-bold uppercase text-foreground mb-2">
              NO DATA FOUND
            </h3>
            <p className="text-sm text-muted-foreground uppercase font-mono">
              Try a different query protocol.
            </p>
          </Card>
        )}

        {!loading && sortedResults.length > 0 && (
          <>
            {/* Results header */}
            <div className="flex items-center justify-between mb-4 px-2">
              <p className="text-xs font-bold uppercase text-muted-foreground">
                <span className="text-primary">{results.length}</span>{" "}
                RESULT(S)
              </p>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase text-muted-foreground mr-1">
                  Sort:
                </span>
                {(["seeders", "time"] as const).map((s) => (
                  <Button
                    key={s}
                    variant={sortBy === s ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setSortBy(s)}
                    className="h-7 text-xs font-bold uppercase border-2 border-transparent hover:border-border"
                  >
                    {s === "seeders" ? "SEEDS" : "DATE"}
                  </Button>
                ))}
              </div>
            </div>

            {/* Results list */}
            <div className="space-y-3">
              {sortedResults.map((torrent) => {
                const id = `${torrent.source}-${torrent.torrent_id}`;
                const isAdding = addingIds.has(id);
                const isAdded =
                  addedIds.has(id) && activeNames.has(torrent.name);
                const addError = addErrors[id];

                return (
                  <Card
                    key={id}
                    className="group hover:border-primary transition-colors duration-200"
                  >
                    <CardContent className="p-4 flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <button
                          onClick={() => openDetail(torrent)}
                          className="text-left w-full focus:outline-none"
                        >
                          <h3 className="text-sm font-bold text-foreground leading-snug line-clamp-2 uppercase group-hover:text-primary transition-colors mb-2">
                            {torrent.name}
                          </h3>
                        </button>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <Badge
                            variant="outline"
                            className="text-xs bg-green-500/10 text-green-600 border-green-500/50 uppercase font-bold"
                          >
                            <ArrowUp className="w-3 h-3 mr-1" />{" "}
                            {torrent.seeders}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="text-xs bg-red-500/10 text-red-600 border-red-500/50 uppercase font-bold"
                          >
                            <ArrowDown className="w-3 h-3 mr-1" />{" "}
                            {torrent.leechers}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className="text-xs uppercase font-bold"
                          >
                            <HardDrive className="w-3 h-3 mr-1" />{" "}
                            {torrent.size}
                          </Badge>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground uppercase font-bold">
                            <Clock className="w-3 h-3" />
                            {torrent.time}
                          </span>
                        </div>

                        {addError && (
                          <div className="mt-2 p-2 bg-destructive/10 border-2 border-destructive text-destructive text-xs font-bold uppercase flex items-center gap-2">
                            <AlertCircle className="w-3 h-3" />
                            {addError}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 flex flex-col items-end gap-2">
                        {isAdded ? (
                          <Button
                            disabled
                            variant="outline"
                            size="sm"
                            className="h-8 border-green-500 text-green-600 opacity-100 bg-green-500/10 font-bold uppercase"
                          >
                            <Check className="w-4 h-4 mr-1" /> Added
                          </Button>
                        ) : (
                          <Button
                            onClick={() => handleAddTorrent(torrent)}
                            disabled={isAdding}
                            size="sm"
                            className="h-8 font-bold uppercase"
                          >
                            {isAdding ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4 mr-1" />
                            )}
                            {isAdding ? "BUSY" : "GET"}
                          </Button>
                        )}
                        <Button
                          onClick={() => openDetail(torrent)}
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs text-muted-foreground hover:text-primary uppercase"
                        >
                          INFO
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-center gap-4 mt-8">
              <Button
                onClick={() => handleSearch(page - 1)}
                disabled={page <= 1 || loading}
                variant="outline"
                className="w-24 border-2 font-bold uppercase"
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> PREV
              </Button>
              <div className="h-10 px-4 flex items-center justify-center bg-card border-2 border-border font-bold font-mono">
                PAGE {page}
              </div>
              <Button
                onClick={() => handleSearch(page + 1)}
                disabled={results.length === 0 || loading}
                variant="outline"
                className="w-24 border-2 font-bold uppercase"
              >
                NEXT <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </>
        )}
      </main>

      {/* Torrent Detail Dialog */}
      <Dialog
        open={!!selectedTorrent}
        onOpenChange={(open) => !open && closeDetail()}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden p-0 gap-0 border-4 border-primary shadow-[12px_12px_0_0_rgba(0,0,0,0.5)] bg-card">
          <DialogHeader className="p-4 border-b-4 border-border bg-muted/20">
            <DialogTitle className="text-lg uppercase line-clamp-1 pr-8">
              {selectedTorrent?.name}
            </DialogTitle>
            <DialogDescription className="text-xs font-mono uppercase text-muted-foreground">
              {torrentDetail?.info_hash ||
                "ID: " + selectedTorrent?.torrent_id}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {detailLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
              </div>
            ) : (
              <>
                {detailError && (
                  <div className="p-3 bg-destructive border-2 border-black text-white text-xs font-bold uppercase mb-4">
                    ERROR: {detailError}
                  </div>
                )}

                {/* Stats Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-muted/30 border-2 border-border text-center">
                    <div className="text-xs text-muted-foreground uppercase font-bold mb-1">
                      Seeds
                    </div>
                    <div className="text-lg font-bold text-green-600">
                      {torrentDetail?.seeders ?? selectedTorrent?.seeders}
                    </div>
                  </div>
                  <div className="p-3 bg-muted/30 border-2 border-border text-center">
                    <div className="text-xs text-muted-foreground uppercase font-bold mb-1">
                      Leeches
                    </div>
                    <div className="text-lg font-bold text-red-600">
                      {torrentDetail?.leechers ?? selectedTorrent?.leechers}
                    </div>
                  </div>
                  <div className="p-3 bg-muted/30 border-2 border-border text-center">
                    <div className="text-xs text-muted-foreground uppercase font-bold mb-1">
                      Size
                    </div>
                    <div className="text-lg font-bold text-foreground">
                      {torrentDetail?.size ?? selectedTorrent?.size}
                    </div>
                  </div>
                  <div className="p-3 bg-muted/30 border-2 border-border text-center">
                    <div className="text-xs text-muted-foreground uppercase font-bold mb-1">
                      Date
                    </div>
                    <div className="text-xs font-bold text-foreground mt-1.5">
                      {torrentDetail?.time ?? selectedTorrent?.time}
                    </div>
                  </div>
                </div>

                {torrentDetail?.description && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold uppercase text-primary border-b-2 border-primary inline-block">
                      Description
                    </div>
                    <div className="p-4 bg-muted/10 border-2 border-dashed border-border text-xs font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto text-muted-foreground">
                      {torrentDetail.description}
                    </div>
                  </div>
                )}

                {torrentDetail?.files && torrentDetail.files.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold uppercase text-primary border-b-2 border-primary inline-block">
                      Files ({torrentDetail.files.length})
                    </div>
                    <div className="p-2 border-2 border-border bg-card max-h-[150px] overflow-y-auto">
                      {torrentDetail.files.map((file, i) => (
                        <div
                          key={i}
                          className="px-2 py-1 text-xs font-mono border-b border-border/50 last:border-0 truncate"
                        >
                          {file}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="p-4 border-t-4 border-border bg-muted/20 flex-row gap-2 justify-end">
            {(torrentDetail?.magnet || selectedTorrent?.magnet) && (
              <Button
                onClick={() =>
                  copyMagnet(
                    torrentDetail?.magnet || selectedTorrent?.magnet || ""
                  )
                }
                variant="outline"
                className="gap-2 border-2 font-bold uppercase flex-1 sm:flex-none"
              >
                <Copy className="w-4 h-4" /> Copy Magnet
              </Button>
            )}

            {selectedTorrent && (
              <Button
                onClick={() => {
                  if (selectedTorrent) handleAddTorrent(selectedTorrent);
                  closeDetail();
                }}
                className="gap-2 font-bold uppercase flex-1 sm:flex-none"
              >
                <Download className="w-4 h-4" /> Download
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
