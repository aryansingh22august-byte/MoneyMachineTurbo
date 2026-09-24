import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock, Shield, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

export default function Login() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;

    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        toast.success("Access Granted", {
          description: "Welcome to Money Machine AI.",
        });
        // The token is in an httpOnly cookie; reload so AuthGuard re-checks
        // /api/auth/status with it attached.
        window.location.reload();
      } else {
        // Surface the server's reason so throttling (429) isn't mistaken for a
        // wrong password.
        toast.error(res.status === 429 ? "Too Many Attempts" : "Access Denied", {
          description: data.error ?? "Incorrect password. Please try again.",
        });
      }
    } catch (error) {
      toast.error("Error", {
        description: "Failed to verify password.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-zinc-950 bg-grid-white/[0.02] relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
        <div className="w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="w-full max-w-md border-zinc-800 bg-zinc-900/50 backdrop-blur-xl shadow-2xl">
          <CardHeader className="space-y-4 pb-6">
            <div className="mx-auto w-16 h-16 bg-blue-600/10 rounded-2xl flex items-center justify-center mb-2 ring-1 ring-blue-500/20 shadow-[0_0_30px_rgba(37,99,235,0.2)]">
              <Shield className="w-8 h-8 text-blue-500" />
            </div>
            <div className="space-y-2 text-center">
              <CardTitle className="text-2xl font-bold tracking-tight text-white">Money Machine AI</CardTitle>
              <CardDescription className="text-zinc-400">
                Please enter your access password to continue
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2 relative">
                <Lock className="absolute left-3 top-2.5 h-5 w-5 text-zinc-500" />
                <Input
                  type="password"
                  placeholder="Enter password..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 bg-zinc-950/50 border-zinc-800 text-white placeholder:text-zinc-500 h-11 focus-visible:ring-blue-500"
                />
              </div>
              <Button 
                type="submit" 
                className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-medium transition-all"
                disabled={loading || !password}
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    Unlock Platform
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
