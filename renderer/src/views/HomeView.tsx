"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import VideoCard from "@/components/VideoCard";
import { videoApi, DriveItem } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import {
  Search,
  Grid,
  List,
  Film,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  ChevronRight,
  Play,
  Clock,
  ArrowUpDown,
  Home,
  FileVideo,
  Download,
  LogIn,
  Activity,
} from "lucide-react";
import { useNavigation } from "@/lib/navigation";
import { useUserAuth } from "@/lib/auth";

// 8bit Components
import { Button } from "@/components/ui/8bit/button";
import { Input } from "@/components/ui/8bit/input";
import { Card, CardContent } from "@/components/ui/8bit/card";
import { Badge } from "@/components/ui/8bit/badge";

export default function HomeView() {
  const { isAuthenticated, isLoading: authLoading, user } = useUserAuth();
  const { navigate } = useNavigation();

  // Folder navigation state
  const [folderStack, setFolderStack] = useState<string[]>([]);
  const currentFolderId =
    folderStack.length > 0 ? folderStack[folderStack.length - 1] : undefined;

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "size" | "date">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Browse current folder
  const {
    data: browseData,
    isLoading: isBrowseLoading,
    isFetching: isBrowseFetching,
    refetch,
  } = useQuery({
    queryKey: ["browse", currentFolderId],
    queryFn: () => videoApi.browse(currentFolderId),
    staleTime: 60_000,
    enabled: !debouncedSearch,
  });

  // Search across all folders
  const {
    data: searchData,
    isLoading: isSearchLoading,
    isFetching: isSearchFetching,
    refetch: refetchSearch,
  } = useQuery({
    queryKey: ["search", debouncedSearch],
    queryFn: () => videoApi.search(debouncedSearch),
    staleTime: 30_000,
    enabled: !!debouncedSearch,
  });

  const isLoading = debouncedSearch ? isSearchLoading : isBrowseLoading;
  const isFetching = debouncedSearch ? isSearchFetching : isBrowseFetching;

  const allItems: DriveItem[] = debouncedSearch
    ? (searchData?.items ?? [])
    : (browseData?.items ?? []);
  const breadcrumb = browseData?.breadcrumb ?? [];

  const filteredItems = (() => {
    if (debouncedSearch) return allItems;

    let items = [...allItems];
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      let cmp = 0;
      if (sortBy === "name") {
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      } else if (sortBy === "size") {
        cmp = (a.size || 0) - (b.size || 0);
      } else {
        const da = a.created_time || "";
        const db = b.created_time || "";
        cmp = da.localeCompare(db);
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return items;
  })();

  const folders = filteredItems.filter((i) => i.type === "folder");
  const files = filteredItems.filter((i) => i.type === "file");

  const openFolder = useCallback((folderId: string) => {
    setFolderStack((prev) => [...prev, folderId]);
    setSearchQuery("");
  }, []);

  const navigateToBreadcrumb = useCallback(
    (index: number) => {
      if (index < 0) {
        setFolderStack([]);
      } else {
        setFolderStack((prev) => {
          const targetId = breadcrumb[index]?.id;
          const idx = prev.indexOf(targetId);
          return idx >= 0 ? prev.slice(0, idx + 1) : prev.slice(0, index + 1);
        });
      }
      setSearchQuery("");
    },
    [breadcrumb]
  );

  const goBack = useCallback(() => {
    setFolderStack((prev) => prev.slice(0, -1));
    setSearchQuery("");
  }, []);

  const handleRefresh = async () => {
    await videoApi.refreshIndex();
    refetch();
    if (debouncedSearch) refetchSearch();
  };

  // Auth gate
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto" />
          <p className="text-sm uppercase tracking-widest text-muted-foreground">
            Loading System...
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md border-4 border-primary shadow-[8px_8px_0_0_var(--primary)] bg-card">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-20 h-20 bg-primary/20 rounded-none border-4 border-primary flex items-center justify-center mx-auto mb-4">
              <Play className="w-10 h-10 text-primary ml-1" />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-foreground">
                CHEAP<span className="text-primary">TRICKS</span>
              </h1>
              <p className="text-xs text-muted-foreground uppercase leading-relaxed">
                Insert Coin to Continue
                <br />
                Stream your Drive videos
              </p>
            </div>

            <div className="flex flex-col gap-4 mt-8">
              <Button
                className="w-full h-12 text-sm uppercase tracking-wider"
                variant="default"
                onClick={() => navigate("login")}
              >
                <LogIn className="w-4 h-4 mr-2" />
                Sign In
              </Button>
              <Button
                className="w-full h-12 text-sm uppercase tracking-wider"
                variant="outline"
                onClick={() => navigate("register")}
              >
                New Game
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b-4 border-border shadow-[0_4px_0_0_rgba(0,0,0,0.5)]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
            {/* Logo */}
            <div className="flex items-center justify-between w-full lg:w-auto">
              <button
                onClick={() => setFolderStack([])}
                className="flex items-center gap-3 shrink-0 group"
              >
                <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center shadow-[4px_4px_0_0_rgba(0,0,0,1)] group-hover:translate-x-1 group-hover:translate-y-1 group-hover:shadow-none transition-all">
                  <img src="./logo.png" alt="Logo" width={120} height={120} />
                </div>
                <span className="text-lg font-bold tracking-tight hidden sm:block">
                  <span className="text-foreground">CHEAP</span>
                  <span className="text-primary">TRICKS</span>
                </span>
              </button>
            </div>

            {/* Search */}
            <div className="flex-1 w-full max-w-2xl px-0 lg:px-8">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="SEARCH DATABASE..."
                  className="w-full pl-10 pr-10 h-12 border-2 border-border bg-card text-foreground placeholder-muted-foreground text-sm uppercase focus-visible:ring-0 focus-visible:border-primary shadow-[4px_4px_0_0_rgba(0,0,0,0.5)] focus:shadow-[4px_4px_0_0_var(--primary)] transition-all"
                />
                {isFetching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary animate-spin" />
                )}
              </div>
            </div>

            {/* Desktop Actions */}
            <div className="flex items-center gap-3 shrink-0 w-full lg:w-auto overflow-x-auto pb-2 lg:pb-0">
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 border-2"
                title="Torrents"
                onClick={() => navigate("search")}
              >
                <Download className="w-4 h-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 border-2"
                title="Active Downloads"
                onClick={() => navigate("downloads")}
              >
                <Activity className="w-4 h-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 border-2"
                onClick={handleRefresh}
                disabled={isFetching}
              >
                <RefreshCw
                  className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`}
                />
              </Button>

              <Button
                variant={showFilters ? "default" : "outline"}
                size="icon"
                className="h-10 w-10 border-2"
                onClick={() => setShowFilters(!showFilters)}
              >
                <SlidersHorizontal className="w-4 h-4" />
              </Button>

              <div className="hidden sm:flex items-center gap-1 bg-card p-1">
                <Button
                  variant={viewMode === "grid" ? "default" : "ghost"}
                  size="icon"
                  className="h-8 w-8 rounded-none border-0"
                  onClick={() => setViewMode("grid")}
                >
                  <Grid className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === "list" ? "default" : "ghost"}
                  size="icon"
                  className="h-8 w-8 rounded-none border-0"
                  onClick={() => setViewMode("list")}
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>

              {/* Auth User */}
              {user && (
                <button onClick={() => navigate("profile")}>
                  <div className="flex items-center gap-3 pl-2 border-2 border-border bg-card p-1 pr-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)] hover:translate-y-1 hover:shadow-none transition-all cursor-pointer">
                    <div className="w-8 h-8 bg-secondary border-2 border-secondary-foreground flex items-center justify-center text-xs font-bold text-secondary-foreground">
                      {user.display_name?.charAt(0).toUpperCase() ||
                        user.username.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-bold uppercase truncate max-w-[100px] hidden md:block">
                      {user.display_name || user.username}
                    </span>
                  </div>
                </button>
              )}
            </div>
          </div>

          {/* Filter bar */}
          {showFilters && (
            <div className="flex flex-wrap items-center gap-4 mt-6 p-4 border-2 border-dashed border-border bg-muted/20 animate-in slide-in-from-top-2">
              <span className="text-xs text-primary uppercase tracking-widest font-bold">
                Sort System:
              </span>
              <div className="flex gap-2">
                {(["name", "date", "size"] as const).map((s) => (
                  <Button
                    key={s}
                    variant={sortBy === s ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      if (sortBy === s) {
                        setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                      } else {
                        setSortBy(s);
                        setSortOrder(s === "name" ? "asc" : "desc");
                      }
                    }}
                    className="h-8 text-xs uppercase border-2"
                  >
                    {s === "date" && <Clock className="w-3 h-3 mr-2" />}
                    {s === "size" && <ArrowUpDown className="w-3 h-3 mr-2" />}
                    {s}
                    {sortBy === s && (
                      <span className="ml-2 text-xs">
                        {sortOrder === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Breadcrumb */}
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        <nav className="flex items-center gap-2 text-sm overflow-x-auto pb-2 scrollbar-hide">
          <Button
            variant={folderStack.length === 0 ? "default" : "outline"}
            size="sm"
            onClick={() => navigateToBreadcrumb(-1)}
            className="shrink-0 h-8 text-xs border-2 gap-2"
          >
            <Home className="w-3 h-3" />
            ROOT
          </Button>

          {breadcrumb.map((crumb, i) => (
            <div
              key={crumb.id}
              className="flex items-center gap-2 shrink-0 animate-in fade-in slide-in-from-left-2"
            >
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
              <Button
                variant={i === breadcrumb.length - 1 ? "default" : "outline"}
                size="sm"
                onClick={() => navigateToBreadcrumb(i)}
                className="shrink-0 h-8 text-xs border-2"
              >
                {crumb.name}
              </Button>
            </div>
          ))}
        </nav>
      </div>

      {/* Main content */}
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 pb-20">
        {/* Stats bar */}
        <div className="flex items-center justify-between mb-8 border-b-2 border-dashed border-muted pb-4">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            {isLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span className="animate-pulse">Accessing Data...</span>
              </span>
            ) : (
              <>
                <span className="text-primary font-bold">{folders.length}</span>{" "}
                DIRS
                <span className="mx-2 text-border">|</span>
                <span className="text-secondary font-bold">
                  {files.length}
                </span>{" "}
                FILES
                {debouncedSearch && (
                  <span className="ml-2 text-foreground">
                    [QUERY: &quot;{debouncedSearch}&quot;]
                  </span>
                )}
              </>
            )}
          </p>
          {folderStack.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={goBack}
              className="h-7 text-xs border-2"
            >
              ← BACK
            </Button>
          )}
        </div>

        {/* Loading */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-32 space-y-6">
            <div className="relative">
              <div className="w-20 h-20 border-4 border-primary border-t-transparent animate-spin rounded-full"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-primary animate-pulse" />
              </div>
            </div>
            <p className="text-sm text-primary uppercase tracking-widest animate-pulse">
              Loading Files and videos...
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 border-4 border-dashed border-border/30 bg-card/50">
            <div className="w-24 h-24 mb-6 relative">
              <div className="absolute inset-0 bg-muted/20 transform rotate-6 border-2 border-dashed border-muted"></div>
              <div className="absolute inset-0 bg-card border-4 border-muted flex items-center justify-center shadow-[8px_8px_0_0_var(--muted)]">
                {debouncedSearch ? (
                  <Search className="w-8 h-8 text-muted-foreground" />
                ) : (
                  <FolderOpen className="w-8 h-8 text-muted-foreground" />
                )}
              </div>
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2 uppercase">
              {debouncedSearch ? "No Hits" : "Empty Sector"}
            </h3>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-6">
              {debouncedSearch
                ? `Query "${debouncedSearch}" returned 0 results.`
                : "No data found in this sector."}
            </p>
            {debouncedSearch && (
              <Button onClick={() => setSearchQuery("")} variant="default">
                RESET QUERY
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Folders */}
            {folders.length > 0 && (
              <div className="mb-12">
                {files.length > 0 && (
                  <h2 className="text-sm font-bold text-primary uppercase tracking-widest mb-4 flex items-center gap-2 border-b-2 border-primary w-fit pb-1 px-2">
                    <Folder className="w-4 h-4" /> Directories
                  </h2>
                )}

                {viewMode === "grid" ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                    {folders.map((folder) => (
                      <Card
                        key={folder.id}
                        onClick={() => openFolder(folder.id)}
                        className="group cursor-pointer hover:border-accent hover:shadow-[4px_4px_0_0_var(--accent)] hover:-translate-y-1 transition-all duration-100 bg-card"
                      >
                        <CardContent className="p-4 flex flex-col items-center text-center gap-3">
                          <div className="w-12 h-12 bg-accent/10 border-2 border-accent/20 flex items-center justify-center group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
                            <Folder className="w-6 h-6 text-accent group-hover:text-accent-foreground" />
                          </div>
                          <div className="w-full">
                            <h3 className="text-xs font-bold text-foreground truncate w-full group-hover:text-accent transition-colors uppercase">
                              {folder.name}
                            </h3>
                            {folder.modified_time && !debouncedSearch && (
                              <p className="text-xs text-muted-foreground mt-1 font-mono">
                                {new Date(
                                  folder.modified_time
                                ).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {folders.map((folder) => (
                      <div
                        key={folder.id}
                        onClick={() => openFolder(folder.id)}
                        className="flex items-center gap-4 p-3 border-2 border-border bg-card hover:bg-accent/10 hover:border-accent cursor-pointer transition-colors group relative"
                      >
                        <Folder className="w-5 h-5 text-accent shrink-0" />
                        <span className="text-sm font-bold text-foreground group-hover:text-accent transition-colors uppercase flex-1 truncate">
                          {folder.name}
                        </span>
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-accent" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Files */}
            {files.length > 0 && (
              <div>
                {folders.length > 0 && (
                  <h2 className="text-sm font-bold text-secondary uppercase tracking-widest mb-4 flex items-center gap-2 border-b-2 border-secondary w-fit pb-1 px-2">
                    <FileVideo className="w-4 h-4" /> Files / Resources
                  </h2>
                )}

                {viewMode === "grid" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
                    {files.map((file, i) =>
                      file.is_video ? (
                        <VideoCard
                          key={file.id}
                          id={file.id}
                          index={i}
                          name={file.name}
                          size={file.size}
                          mimeType={file.mime_type}
                          createdTime={file.created_time || undefined}
                          parentPath={file.parent_path}
                          isSearchResult={!!debouncedSearch}
                          thumbnail={file.thumbnail_link || undefined}
                        />
                      ) : (
                        <Card
                          key={file.id}
                          className="bg-muted/10 border-2 border-dashed border-muted/50 p-4 flex flex-col items-center justify-center text-center gap-3 opacity-70 hover:opacity-100 transition-opacity"
                        >
                          <div className="w-10 h-10 bg-muted/20 flex items-center justify-center rounded-none">
                            <Film className="w-5 h-5 text-muted-foreground" />
                          </div>
                          <h3 className="text-xs font-mono text-muted-foreground truncate w-full">
                            {file.name}
                          </h3>
                          <Badge
                            variant="outline"
                            className="text-xs rounded-none"
                          >
                            {formatBytes(file.size)}
                          </Badge>
                        </Card>
                      )
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {files.map((file, i) =>
                      file.is_video ? (
                        <button
                          key={file.id}
                          onClick={() =>
                            navigate("watch", { id: file.id })
                          }
                          className="flex items-center gap-4 p-3 border-2 border-border/50 bg-card hover:border-primary hover:shadow-[4px_4px_0_0_var(--primary)] hover:-translate-y-0.5 transition-all group w-full text-left"
                        >
                          <div className="w-8 h-8 bg-primary/10 border border-primary/20 flex items-center justify-center">
                            <Film className="w-4 h-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-xs font-bold text-foreground uppercase truncate group-hover:text-primary transition-colors">
                              {file.name}
                            </h3>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground font-mono">
                              <span>{formatBytes(file.size)}</span>
                              {file.created_time && (
                                <span>
                                  {new Date(
                                    file.created_time
                                  ).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                          <Play className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                        </button>
                      ) : (
                        <div
                          key={file.id}
                          className="flex items-center gap-4 p-3 border-2 border-dashed border-border/30 bg-muted/5 text-muted-foreground"
                        >
                          <Film className="w-4 h-4" />
                          <span className="text-xs font-mono truncate flex-1">
                            {file.name}
                          </span>
                          <span className="text-xs font-mono">
                            {formatBytes(file.size)}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t-4 border-black bg-muted/10 py-8 mt-12">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground uppercase tracking-widest font-mono">
            <p>SYSTEM STATUS: ONLINE</p>
            <p>
              {folders.length} DIR &bull; {files.length} FILE
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
