"use client";

import { Play, Film, Copy, Clock } from "lucide-react";
import { useState } from "react";
import { formatBytes, formatDate, getFileExtension } from "@/lib/utils";
import { videoApi } from "@/lib/api";
import { useNavigation } from "@/lib/navigation";

// 8bit Components
import { Card, CardContent } from "@/components/ui/8bit/card";
import { Badge } from "@/components/ui/8bit/badge";
import { Button } from "@/components/ui/8bit/button";

interface VideoCardProps {
  id: string;
  index: number;
  name: string;
  size: number;
  mimeType?: string;
  createdTime?: string;
  thumbnail?: string;
  parentPath?: { id: string; name: string }[];
  isSearchResult?: boolean;
}

export default function VideoCard({
  id,
  index,
  name,
  size,
  mimeType,
  createdTime,
  thumbnail,
  parentPath,
  isSearchResult,
}: VideoCardProps) {
  const { navigate } = useNavigation();
  const [imageError, setImageError] = useState(false);
  const [copied, setCopied] = useState(false);

  const ext = getFileExtension(name);

  const clipboardWrite = async (text: string): Promise<boolean> => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch { /* denied */ }
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.width = "1px";
      ta.style.height = "1px";
      ta.style.padding = "0";
      ta.style.border = "none";
      ta.style.outline = "none";
      ta.style.boxShadow = "none";
      ta.style.background = "transparent";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) return true;
    } catch { /* noop */ }
    window.prompt("Copy this URL:", text);
    return true;
  };

  const copyStreamUrl = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const data = await videoApi.getExternalUrls(id);
      await clipboardWrite(data.urls.proxy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const url = await videoApi.getStreamUrl(id);
      await clipboardWrite(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate('watch', { id });
  };

  return (
    <a href="#" onClick={handleClick} className="block group h-full">
      <Card className="h-full hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all duration-75 overflow-hidden flex flex-col">
        {/* Thumbnail */}
        <div className="aspect-video bg-muted relative border-b-4 border-border overflow-hidden">
          {thumbnail && !imageError ? (
            <img
              src={thumbnail}
              alt={name}
              className="w-full h-full object-cover rendering-pixelated"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-card pattern-grid-lg">
              <Film className="w-12 h-12 text-muted-foreground opacity-20" />
            </div>
          )}

          {/* Play Overlay */}
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <div className="w-12 h-12 bg-primary border-2 border-foreground flex items-center justify-center shadow-[4px_4px_0_0_rgba(0,0,0,1)] hover:scale-110 transition-transform">
              <Play className="w-6 h-6 text-primary-foreground ml-1" />
            </div>
          </div>

          {ext && (
            <div className="absolute top-2 left-2">
              <Badge variant="default" className="text-xs uppercase shadow-sm">
                {ext}
              </Badge>
            </div>
          )}

          <div className="absolute bottom-2 right-2">
            <Badge
              variant="outline"
              className="text-xs bg-black/80 text-white border-white/20 shadow-sm"
            >
              {formatBytes(size)}
            </Badge>
          </div>
        </div>

        {/* Content */}
        <CardContent className="p-3 flex flex-col flex-1 gap-2">
          <div className="flex-1">
            <h3
              className="font-bold text-xs uppercase leading-tight line-clamp-2 text-foreground group-hover:text-primary transition-colors mb-1"
              title={name}
            >
              {name}
            </h3>

            {isSearchResult && parentPath && parentPath.length > 0 && (
              <p className="text-xs text-muted-foreground truncate uppercase font-mono">
                {parentPath.map((p) => p.name).join(" / ")}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t-2 border-dashed border-border/50 mt-auto">
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase">
              {createdTime && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDate(createdTime).split(",")[0]}
                </span>
              )}
              <span className="font-bold text-primary">#{index + 1}</span>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-none hover:bg-transparent hover:text-primary"
              onClick={copyStreamUrl}
              title={copied ? "COPIED!" : "COPY URL"}
            >
              {copied ? (
                <span className="text-[8px] font-bold text-green-500">OK!</span>
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </a>
  );
}
