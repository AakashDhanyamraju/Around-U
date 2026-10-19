/**
 * Landing spot for the Supabase OAuth redirect (`Linking.createURL("auth-callback")`).
 *
 * On web `WebBrowser.openAuthSessionAsync` opens a popup and waits for that popup
 * to post its final URL back to the opener. That only happens if the redirect
 * target is a real route calling `maybeCompleteAuthSession()` — without this
 * screen the popup just parks on Expo Router's "Unmatched Route" and the promise
 * in `signInWithGoogle` never settles.
 *
 * Native never renders this: the OS hands the deep link straight to the auth
 * session. The route exists so the redirect URI resolves on every platform.
 */
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";

import { ApiError } from "@/src/api";
import { accessTokenFromRedirect, useAuth } from "@/src/auth";
import { AuthShell, FooterLink } from "@/src/components/AuthKit";
import { colors, fonts, spacing } from "@/src/theme";

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { completeGoogleSignIn } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    if (Platform.OS !== "web") {
      router.replace("/");
      return;
    }

    // Popup case: hand the URL to the window that started the flow. It resolves
    // the pending promise and closes this one, so there is nothing left to do.
    try {
      if (WebBrowser.maybeCompleteAuthSession().type === "success") return;
    } catch {
      // Thrown when the opener is gone (parent reloaded mid-flow). Fall through
      // and finish the exchange here instead.
    }

    // Same-tab case: popup blocked, or the browser reused the tab. Nobody is
    // listening for a message, so complete the sign-in on this page.
    (async () => {
      const accessToken = accessTokenFromRedirect(window.location.href);
      if (!accessToken) {
        setError("Google did not return a usable sign-in.");
        return;
      }
      try {
        await completeGoogleSignIn(accessToken);
        router.replace("/");
      } catch (e) {
        setError(
          e instanceof ApiError ? e.message : "Could not complete Google sign-in.",
        );
      }
    })();
  }, [completeGoogleSignIn, router]);

  return (
    <AuthShell>
      <View style={styles.center}>
        {error ? (
          <>
            <Text style={styles.error}>{error}</Text>
            <FooterLink
              prefix="Back to"
              action="sign in"
              onPress={() => router.replace("/login")}
            />
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.label}>Signing you in…</Text>
          </>
        )}
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  label: {
    fontFamily: fonts.bodyMed,
    fontSize: 15,
    color: colors.textSecondary,
  },
  error: {
    fontFamily: fonts.bodyMed,
    fontSize: 15,
    color: colors.primaryDeep,
    textAlign: "center",
  },
});
