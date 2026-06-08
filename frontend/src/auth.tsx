import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Platform } from "react-native";

import { api, setToken, clearToken, User } from "@/src/api";
import { storage } from "@/src/utils/storage";

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthCtx = createContext<AuthState>({
  user: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
  refresh: async () => {},
});

const AUTH_URL = "https://auth.emergentagent.com/?redirect=";

async function processSessionId(sessionId: string): Promise<User | null> {
  try {
    const r = await fetch("https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data", {
      headers: { "X-Session-ID": sessionId },
    });
    if (!r.ok) return null;
    const data = await r.json();
    // Send the persistent session_token to backend to register
    const resp = await api<{ user: User; session_token: string }>("/auth/session", {
      method: "POST",
      body: { session_token: data.session_token },
      auth: false,
    });
    await setToken(resp.session_token);
    return resp.user;
  } catch (e) {
    console.warn("processSessionId failed", e);
    return null;
  }
}

function extractSessionId(url: string): string | null {
  try {
    const u = new URL(url);
    const fromHash = u.hash.match(/session_id=([^&]+)/);
    if (fromHash) return decodeURIComponent(fromHash[1]);
    const q = u.searchParams.get("session_id");
    if (q) return q;
  } catch {}
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: User }>("/auth/me");
      setUser(r.user);
    } catch {
      setUser(null);
      await clearToken();
    }
  }, []);

  useEffect(() => {
    (async () => {
      // Web: check URL for session_id from redirect
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const sid = extractSessionId(window.location.href);
        if (sid) {
          const u = await processSessionId(sid);
          if (u) setUser(u);
          window.history.replaceState(null, "", window.location.pathname);
          setLoading(false);
          return;
        }
      } else {
        // Mobile cold start
        const initial = await Linking.getInitialURL();
        if (initial) {
          const sid = extractSessionId(initial);
          if (sid) {
            const u = await processSessionId(sid);
            if (u) setUser(u);
            setLoading(false);
            return;
          }
        }
      }
      const token = await storage.secureGet<string>("around_you_token", "");
      if (token) {
        await refresh();
      }
      setLoading(false);
    })();
  }, [refresh]);

  const signIn = useCallback(async () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const redirect = window.location.origin + "/";
      window.location.href = AUTH_URL + encodeURIComponent(redirect);
      return;
    }
    const redirect = Linking.createURL("auth");
    const result = await WebBrowser.openAuthSessionAsync(
      AUTH_URL + encodeURIComponent(redirect),
      redirect,
    );
    if (result.type === "success" && result.url) {
      const sid = extractSessionId(result.url);
      if (sid) {
        const u = await processSessionId(sid);
        if (u) setUser(u);
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, signIn, signOut, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}
