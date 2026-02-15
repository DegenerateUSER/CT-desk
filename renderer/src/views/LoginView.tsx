"use client";

import { useState } from "react";
import { useUserAuth } from "@/lib/auth";
import { useNavigation } from "@/lib/navigation";
import { Play, LogIn, Loader2, Eye, EyeOff } from "lucide-react";

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

export default function LoginView() {
  const { login } = useUserAuth();
  const { navigate } = useNavigation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("home");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md border-4 border-primary shadow-[8px_8px_0_0_var(--primary)] bg-card">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="w-16 h-16 bg-primary rounded-xl mx-auto flex items-center justify-center shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
            <img src="./logo.png" alt="Logo" width={160} height={160} />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">
              <span className="text-foreground">CHEAP</span>
              <span className="text-primary">TRICKS</span>
            </CardTitle>
            <CardDescription className="text-xs uppercase tracking-widest mt-2">
              Authentication Required
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
                Username
              </label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="INSERT USERNAME"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase font-bold text-muted-foreground">
                Password
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                  placeholder="INSERT PASSWORD"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
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
                  LOADING...
                </>
              ) : (
                <>
                  <img src="./coin.png" alt="Coin" width={30} height={30} />
                  INSERT COIN (LOGIN)
                </>
              )}
            </Button>

            <div className="text-center pt-2">
              <p className="text-xs text-muted-foreground uppercase mb-2">
                New Challenger?
              </p>
              <Button
                variant="outline"
                className="w-full text-xs uppercase h-10"
                onClick={() => navigate("register")}
              >
                Register New Account
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
