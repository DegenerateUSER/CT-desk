"use client";

import { useState } from "react";
import { userAuthApi } from "@/lib/api";
import { useNavigation } from "@/lib/navigation";
import {
  Play,
  UserPlus,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle,
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
import { Separator } from "@/components/ui/8bit/separator";

export default function RegisterView() {
  const { navigate } = useNavigation();

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    referral_code: "",
    display_name: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (!form.referral_code.trim()) {
      setError("A referral code is required to register");
      return;
    }

    setLoading(true);
    try {
      await userAuthApi.register({
        username: form.username,
        email: form.email,
        password: form.password,
        referral_code: form.referral_code.trim().toUpperCase(),
        display_name: form.display_name || undefined,
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="w-full max-w-md border-4 border-emerald-500 shadow-[8px_8px_0_0_var(--emerald-500)] bg-card">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-emerald-500/10 border-4 border-emerald-500 mx-auto flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-emerald-500" />
            </div>
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-emerald-500 uppercase">
                Registration Submitted!
              </h2>
              <p className="text-xs text-muted-foreground uppercase leading-relaxed font-mono">
                Your account is pending admin approval. You&apos;ll be able to
                log in once an admin approves your request.
              </p>
            </div>
            <Button
              className="w-full uppercase"
              variant="default"
              onClick={() => navigate("login")}
            >
              Return to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md border-4 border-secondary shadow-[8px_8px_0_0_var(--secondary)] bg-card">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="w-16 h-16 bg-secondary rounded-xl mx-auto flex items-center justify-center shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
            <img src="./logo.png" alt="Logo" width={160} height={160} />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">
              <span className="text-foreground">CHEAP</span>
              <span className="text-secondary">TRICKS</span>
            </CardTitle>
            <CardDescription className="text-xs uppercase tracking-widest mt-2">
              New Player Registration
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <Separator className="bg-border" />

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-destructive/10 border-2 border-destructive p-3 text-destructive text-xs uppercase font-bold text-center">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs uppercase font-bold text-muted-foreground">
                Referral Code <span className="text-destructive">*</span>
              </label>
              <Input
                type="text"
                value={form.referral_code}
                onChange={(e) => updateField("referral_code", e.target.value)}
                required
                maxLength={20}
                className="uppercase border-accent text-accent placeholder:text-accent/50"
                placeholder="INSERT CODE"
              />
              <p className="text-[9px] text-muted-foreground font-mono uppercase">
                Required to join the server.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-xs uppercase font-bold text-muted-foreground">
                  Username <span className="text-destructive">*</span>
                </label>
                <Input
                  type="text"
                  value={form.username}
                  onChange={(e) => updateField("username", e.target.value)}
                  required
                  minLength={3}
                  placeholder="PLAYER 1"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase font-bold text-muted-foreground">
                  Display Name
                </label>
                <Input
                  type="text"
                  value={form.display_name}
                  onChange={(e) => updateField("display_name", e.target.value)}
                  className="uppercase"
                  placeholder="OPTIONAL"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase font-bold text-muted-foreground">
                Email <span className="text-destructive">*</span>
              </label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                required
                className="uppercase"
                placeholder="EMAIL@DOMAIN.COM"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase font-bold text-muted-foreground">
                Password <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => updateField("password", e.target.value)}
                  required
                  minLength={6}
                  className="pr-10"
                  placeholder="6+ CHARS"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase font-bold text-muted-foreground">
                Confirm Password <span className="text-destructive">*</span>
              </label>
              <Input
                type={showPassword ? "text" : "password"}
                value={form.confirmPassword}
                onChange={(e) => updateField("confirmPassword", e.target.value)}
                required
                placeholder="SAME AS ABOVE"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 text-sm uppercase tracking-wider font-bold mt-4"
              variant="default"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  CREATING...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Create Account
                </>
              )}
            </Button>

            <div className="text-center pt-2">
              <p className="text-xs text-muted-foreground uppercase mb-2">
                Already a Player?
              </p>
              <Button
                variant="outline"
                className="w-full text-xs uppercase h-10"
                onClick={() => navigate("login")}
              >
                Back to Login
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
