import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";

interface AuthUser {
  id: number;
  phone: string;
  displayName: string | null;
  isAdmin: boolean;
  status: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (phone: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function safeJson(res: Response): Promise<AuthUser | null> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return null;
  try { return await res.json() as AuthUser; } catch { return null; }
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Heartbeat: 3 min — runs in background regardless of tab visibility.
// This keeps the rolling session cookie alive even when the tab is hidden,
// and provides a second layer of server keep-alive on top of the Worker ping.
const HEARTBEAT_MS = 3 * 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  // ──────────────────────────────────────────────────────────────────
  // refresh — called on mount and by the heartbeat
  //   • Only sets user=null when the server explicitly returns 401
  //   • 5xx / network errors → keep current state (server hiccup)
  //   • Retries up to 3× with exponential back-off on network failures
  // ──────────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    let attempts = 0;
    while (attempts <= 3) {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
          headers: { "Cache-Control": "no-cache" },
        });

        if (res.ok) {
          const data = await safeJson(res);
          if (data) setUser(data);
          return;
        }

        if (res.status === 401) {
          setUser(null);
          return;
        }

        // 403, 5xx — keep state, stop retrying
        return;

      } catch {
        attempts += 1;
        if (attempts > 3) return;
        await delay(1_000 * Math.pow(2, attempts - 1));
      }
    }
  }, []);

  // Initial session check on mount
  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // ── Heartbeat: renew rolling cookie + keep state fresh ────────────
  // IMPORTANT: Runs even when tab is hidden — the background Worker also
  // calls /api/auth/me every 3 min, but this provides a main-thread backup.
  // Removing the visibility gate ensures sessions stay alive in background.
  useEffect(() => {
    const id = setInterval(async () => {
      // Only ping if we believe the user is logged in
      if (!userRef.current) return;
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
          headers: { "Cache-Control": "no-cache" },
        });
        if (res.ok) {
          const data = await safeJson(res);
          if (data) setUser(data);
        } else if (res.status === 401) {
          setUser(null);
        }
        // 5xx → ignore, keep state
      } catch {
        // Network error → ignore, keep state
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, []);

  // ── Recover session instantly when tab regains focus ──────────────
  // staleTime: 0 + refetchOnWindowFocus in QueryClient handles most queries.
  // Auth state is managed separately here (not via React Query).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && userRef.current) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    // Also recover immediately when browser comes back online
    const onOnline = () => {
      if (userRef.current) void refresh();
    };
    window.addEventListener("online", onOnline);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh]);

  const login = async (phone: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password }),
      credentials: "include",
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error((data as { error?: string } | null)?.error || "فشل تسجيل الدخول");
    setUser(data);
  };

  const register = async (phone: string, password: string, displayName?: string) => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password, displayName }),
      credentials: "include",
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error((data as { error?: string } | null)?.error || "فشل التسجيل");
    setUser(data);
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // Fire-and-forget; clear state regardless
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
