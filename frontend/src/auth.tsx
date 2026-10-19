import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { api, ApiError, AuthResult, clearToken, setToken, User } from "@/src/api";
import { storage } from "@/src/utils/storage";

/**
 * Passwordless auth against our own backend.
 *
 * Two paths, and both prove ownership of the address as a side effect, which is
 * why there is no separate "verify your email" step:
 *
 *   - Email OTP: request a code, enter it. Creates the account on first use.
 *   - Google:    Supabase runs the consent flow; we hand the resulting access
 *                token to our backend, which verifies it and returns one of our
 *                own session tokens.
 *
 * Sessions are still opaque bearer tokens in secure storage. Only the way they
 * are obtained changed, so nothing else in the app needed touching.
 */

export type Providers = {
  google: boolean;
  email_otp: boolean;
  password: boolean;
  supabase_url: string | null;
};

export type CodeRequestResult = {
  detail: string;
  expires_in_minutes: number;
  /** Present only outside production, so the flow works without a mailbox. */
  dev_code?: string | null;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  providers: Providers | null;
  requestCode: (email: string, name?: string) => Promise<CodeRequestResult>;
  verifyCode: (email: string, code: string, name?: string) => Promise<User>;
  signInWithGoogle: () => Promise<User>;
  completeGoogleSignIn: (accessToken: string) => Promise<User>;
  signOut: () => Promise<void>;
  signOutEverywhere: () => Promise<void>;
  refresh: () => Promise<void>;
};

const notReady = async () => {
  throw new Error("AuthProvider is not mounted");
};

const AuthCtx = createContext<AuthState>({
  user: null,
  loading: true,
  providers: null,
  requestCode: notReady,
  verifyCode: notReady,
  signInWithGoogle: notReady,
  completeGoogleSignIn: notReady,
  signOut: async () => {},
  signOutEverywhere: async () => {},
  refresh: async () => {},
});

const TOKEN_KEY = "around_you_token";

/** Pulls `access_token` out of the fragment Supabase redirects back with. */
export function accessTokenFromRedirect(url: string): string | null {
  const hashIndex = url.indexOf("#");
  if (hashIndex >= 0) {
    const fragment = new URLSearchParams(url.slice(hashIndex + 1));
    const token = fragment.get("access_token");
    if (token) return token;
  }
  // Some configurations return it as a query parameter instead.
  const queryIndex = url.indexOf("?");
  if (queryIndex >= 0) {
    const query = new URLSearchParams(url.slice(queryIndex + 1).split("#")[0]);
    return query.get("access_token");
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<Providers | null>(null);

  const refresh = useCallback(async () => {
    try {
      // /auth/me returns the user object directly, not wrapped in { user }.
      const me = await api<User>("/auth/me");
      setUser(me);
    } catch (e) {
      // Only clear the stored token when the server actually rejected it. A
      // network blip must not sign the user out of their own device.
      if (e instanceof ApiError && e.isAuthError) {
        setUser(null);
        await clearToken();
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      // Ask what's available so the UI can hide a Google button that would only
      // fail, rather than discovering it via a broken sign-in.
      api<Providers>("/auth/providers", { auth: false })
        .then(setProviders)
        .catch(() => setProviders(null));

      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      if (token) await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const requestCode = useCallback(async (email: string, name?: string) => {
    return await api<CodeRequestResult>("/auth/otp/request", {
      method: "POST",
      auth: false,
      body: { email: email.trim().toLowerCase(), name: name?.trim() || undefined },
    });
  }, []);

  const verifyCode = useCallback(
    async (email: string, code: string, name?: string) => {
      const r = await api<AuthResult>("/auth/otp/verify", {
        method: "POST",
        auth: false,
        body: {
          email: email.trim().toLowerCase(),
          code: code.trim(),
          name: name?.trim() || undefined,
        },
      });
      await setToken(r.session_token);
      setUser(r.user);
      return r.user;
    },
    [],
  );

  // Split out of signInWithGoogle because the web redirect can land in a tab
  // that has no pending auth session to resolve — /auth-callback finishes the
  // exchange itself in that case.
  const completeGoogleSignIn = useCallback(async (accessToken: string) => {
    // The backend re-verifies this token with Supabase before trusting it.
    const r = await api<AuthResult>("/auth/google", {
      method: "POST",
      auth: false,
      body: { access_token: accessToken },
    });
    await setToken(r.session_token);
    setUser(r.user);
    return r.user;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    // Read the URL from the server rather than a bundled env var, so rotating the
    // Supabase project does not need an app release.
    const config =
      providers ?? (await api<Providers>("/auth/providers", { auth: false }));
    if (!config.google || !config.supabase_url) {
      throw new ApiError("Google sign-in is not available right now.", 503);
    }

    const redirectUri = Linking.createURL("auth-callback");
    const authorizeUrl =
      `${config.supabase_url.replace(/\/$/, "")}/auth/v1/authorize` +
      `?provider=google&redirect_to=${encodeURIComponent(redirectUri)}`;

    const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectUri);

    if (result.type === "cancel" || result.type === "dismiss") {
      // Not an error: the person backed out. Callers check for this message.
      throw new ApiError("Sign-in cancelled.", 0);
    }
    if (result.type !== "success" || !result.url) {
      throw new ApiError("Could not complete Google sign-in.", 0);
    }

    const accessToken = accessTokenFromRedirect(result.url);
    if (!accessToken) {
      throw new ApiError("Google did not return a usable sign-in.", 0);
    }

    return await completeGoogleSignIn(accessToken);
  }, [providers, completeGoogleSignIn]);

  const signOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // Local sign-out must succeed even if the revoke call fails.
    }
    await clearToken();
    setUser(null);
  }, []);

  const signOutEverywhere = useCallback(async () => {
    try {
      await api("/auth/sign-out-everywhere", { method: "POST" });
    } catch {
      // Fall through to clearing locally regardless.
    }
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        user,
        loading,
        providers,
        requestCode,
        verifyCode,
        signInWithGoogle,
        completeGoogleSignIn,
        signOut,
        signOutEverywhere,
        refresh,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}
