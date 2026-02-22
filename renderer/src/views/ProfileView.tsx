"use client";

import { useState, useEffect } from "react";
import { useNavigation } from "@/lib/navigation";
import { useUserAuth } from "@/lib/auth";
import { userAuthApi, ReferralCode } from "@/lib/api";
import {
  ArrowLeft,
  User,
  Mail,
  Calendar,
  Shield,
  Copy,
  Check,
  Plus,
  Loader2,
  LogOut,
  Ticket,
  Users,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

// 8bit Components
import { Button } from "@/components/ui/8bit/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/8bit/card";
import { Badge } from "@/components/ui/8bit/badge";

export default function ProfileView() {
  const { isAuthenticated, isLoading, user, logout } = useUserAuth();
  const { navigate } = useNavigation();

  const [codes, setCodes] = useState<ReferralCode[]>([]);
  const [maxCodes, setMaxCodes] = useState(2);
  const [loadingCodes, setLoadingCodes] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("login");
    }
  }, [isLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchCodes();
    }
  }, [isAuthenticated]);

  const fetchCodes = async () => {
    try {
      setLoadingCodes(true);
      const data = await userAuthApi.getReferralCodes();
      setCodes(Array.isArray(data.codes) ? data.codes : []);
      setMaxCodes(data.max_codes ?? 2);
    } catch {
      // ignore
    } finally {
      setLoadingCodes(false);
    }
  };

  const handleCreateCode = async () => {
    setError("");
    setCreating(true);
    try {
      await userAuthApi.createReferralCode();
      await fetchCodes();
    } catch (err: any) {
      setError(err.message || "Failed to create code");
    } finally {
      setCreating(false);
    }
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleLogout = () => {
    logout();
    navigate("login");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated || !user) return null;

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b-4 border-border shadow-[0_4px_0_0_rgba(0,0,0,0.5)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 border-2"
                onClick={() => navigate("home")}
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <button
                onClick={() => navigate("home")}
                className="flex items-center gap-3 group"
              >
                <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-[4px_4px_0_0_rgba(0,0,0,1)] group-hover:translate-x-1 group-hover:translate-y-1 group-hover:shadow-none transition-all">
                  <img src="./logo.png" alt="Logo" width={100} height={100} />
                </div>
                <span className="text-lg font-bold tracking-tight hidden sm:block">
                  <span className="text-foreground">CHEAP</span>
                  <span className="text-primary">TRICKS</span>
                </span>
              </button>
            </div>

            <Button
              onClick={handleLogout}
              variant="destructive"
              className="h-10 uppercase text-xs font-bold border-2"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Profile Card */}
        <Card className="border-4 border-primary shadow-[8px_8px_0_0_var(--primary)] bg-card">
          <CardHeader className="flex flex-row items-center gap-6 pb-6 border-b-4 border-border">
            <div className="w-20 h-20 bg-secondary border-4 border-foreground flex items-center justify-center shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
              <span className="text-2xl font-bold text-secondary-foreground">
                {user.display_name?.charAt(0).toUpperCase() ||
                  user.username.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1">
              <CardTitle className="text-2xl uppercase mb-2">
                {user.display_name || user.username}
              </CardTitle>
              <Badge
                variant={user.status === "active" ? "default" : "secondary"}
                className="uppercase text-xs"
              >
                {user.status}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 border-2 border-border bg-muted/20">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <User className="w-4 h-4" />
                  <span className="text-xs uppercase font-bold">Username</span>
                </div>
                <p className="font-mono text-sm uppercase">{user.username}</p>
              </div>

              <div className="p-4 border-2 border-border bg-muted/20">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Mail className="w-4 h-4" />
                  <span className="text-xs uppercase font-bold">Email</span>
                </div>
                <p
                  className="font-mono text-sm uppercase truncate"
                  title={user.email}
                >
                  {user.email}
                </p>
              </div>

              <div className="p-4 border-2 border-border bg-muted/20">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Shield className="w-4 h-4" />
                  <span className="text-xs uppercase font-bold">Role</span>
                </div>
                <p className="font-mono text-sm uppercase">
                  {user.is_admin ? "Admin" : "User"}
                </p>
              </div>

              <div className="p-4 border-2 border-border bg-muted/20">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Calendar className="w-4 h-4" />
                  <span className="text-xs uppercase font-bold">Joined</span>
                </div>
                <p className="font-mono text-sm uppercase">
                  {user.created_at ? formatDate(user.created_at) : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Referral Codes */}
        <Card className="border-4 border-secondary shadow-[8px_8px_0_0_var(--secondary)] bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-6 border-b-4 border-border">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-secondary border-2 border-foreground flex items-center justify-center">
                <Ticket className="w-6 h-6 text-foreground" />
              </div>
              <div>
                <CardTitle className="text-lg uppercase">
                  Referral Codes
                </CardTitle>
                <p className="text-xs text-muted-foreground uppercase font-bold mt-1">
                  {codes.length} / {maxCodes} USED
                </p>
              </div>
            </div>

            {codes.length < maxCodes && (
              <Button
                onClick={handleCreateCode}
                disabled={creating}
                variant="secondary"
                size="sm"
                className="uppercase text-xs font-bold"
              >
                {creating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                Generate
              </Button>
            )}
          </CardHeader>

          <CardContent className="pt-6">
            {error && (
              <div className="mb-4 bg-destructive/10 border-2 border-destructive p-3 text-destructive text-xs uppercase font-bold">
                {error}
              </div>
            )}

            {loadingCodes ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            ) : codes.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-border bg-muted/10">
                <Ticket className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-sm font-bold uppercase text-foreground mb-2">
                  No Codes Generated
                </p>
                <p className="text-xs text-muted-foreground uppercase max-w-xs mx-auto">
                  Create a code to invite a friend to the platform.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {codes.map((code) => (
                  <div
                    key={code.id}
                    className={`flex items-center justify-between p-4 border-2 ${
                      code.is_used
                        ? "bg-muted border-border opacity-60"
                        : "bg-card border-secondary"
                    }`}
                  >
                    <div className="flex flex-col gap-1">
                      <code
                        className={`text-lg font-bold tracking-widest ${
                          code.is_used
                            ? "text-muted-foreground line-through"
                            : "text-secondary"
                        }`}
                      >
                        {code.code}
                      </code>
                      {code.is_used && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase font-bold">
                          <Users className="w-3 h-3" />
                          <span>Used By: {code.used_by}</span>
                        </div>
                      )}
                    </div>

                    {!code.is_used && (
                      <Button
                        onClick={() => copyCode(code.code)}
                        variant="outline"
                        size="sm"
                        className="uppercase text-xs h-8"
                      >
                        {copiedCode === code.code ? (
                          <>
                            <Check className="w-3 h-3 mr-1" /> COPIED
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 mr-1" /> COPY
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 p-4 border-2 border-dashed border-border bg-muted/10">
              <p className="text-xs text-muted-foreground uppercase leading-relaxed font-mono">
                <span className="text-primary font-bold">Info:</span> Each user
                can create up to {maxCodes} referral codes. Share your code with
                someone you trust.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
