import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import { useRouter } from "expo-router";

import { colors, fonts, radii, warmGradient } from "@/src/theme";
import { useAuth } from "@/src/auth";

export default function LoginScreen() {
  const { signIn, loading } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string>("");

  const handleSignIn = async () => {
    setBusy(true);
    setErr("");
    try {
      await signIn();
    } catch (e: any) {
      setErr(e?.message || "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root} testID="login-screen">
      <LinearGradient colors={warmGradient as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* Soft blob overlays for depth */}
      <View style={[styles.blob, { top: -80, right: -60, backgroundColor: "rgba(255,255,255,0.18)" }]} />
      <View style={[styles.blob, { bottom: 120, left: -70, width: 220, height: 220, backgroundColor: "rgba(255,255,255,0.12)" }]} />

      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <Animated.View entering={FadeIn.duration(500)} style={styles.topRow}>
          <View style={styles.logoPill}>
            <View style={styles.logoDot} />
            <Text style={styles.logoText}>around you</Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(150).duration(600)} style={styles.heroImageWrap}>
          <Image
            source={{
              uri: "https://images.pexels.com/photos/33089291/pexels-photo-33089291.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
            }}
            style={styles.heroImage}
            contentFit="cover"
          />
          <View style={styles.heroBadge}>
            <Ionicons name="location" size={12} color="#fff" />
            <Text style={styles.heroBadgeText}>HOUSTON · TONIGHT</Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(280).duration(600)} style={styles.bottom}>
          <Text style={styles.eyebrow}>community · est. 2026</Text>
          <Text style={styles.headline}>the city,{"\n"}told by locals.</Text>
          <Text style={styles.sub}>
            Hand-picked creators. Food, gatherings, hidden corners — the stuff that never makes the news.
          </Text>

          <Pressable
            testID="google-signin-btn"
            onPress={handleSignIn}
            disabled={busy || loading}
            style={({ pressed }) => [styles.btn, pressed && { transform: [{ scale: 0.97 }] }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color={colors.textPrimary} />
                <Text style={styles.btnText}>Continue with Google</Text>
              </>
            )}
          </Pressable>

          <Pressable
            testID="guest-btn"
            onPress={() => router.replace("/(tabs)")}
            style={({ pressed }) => [styles.guestBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.guestText}>Browse as guest →</Text>
          </Pressable>

          {err ? <Text style={styles.err}>{err}</Text> : null}
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  blob: { position: "absolute", width: 280, height: 280, borderRadius: 200 },
  safe: { flex: 1, justifyContent: "space-between", paddingHorizontal: 24 },
  topRow: { paddingTop: 12, flexDirection: "row" },
  logoPill: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.3)",
  },
  logoDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  logoText: { color: "#fff", fontSize: 13, fontFamily: fonts.bodyBold, letterSpacing: 1.5 },
  heroImageWrap: {
    marginTop: 24, alignSelf: "center", width: "92%", height: 280,
    borderRadius: radii.xl, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 12,
  },
  heroImage: { width: "100%", height: "100%" },
  heroBadge: {
    position: "absolute", top: 14, left: 14, flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill,
  },
  heroBadgeText: { color: "#fff", fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.5 },
  bottom: { paddingBottom: 16, gap: 12 },
  eyebrow: { color: "rgba(255,255,255,0.9)", fontFamily: fonts.bodySemi, letterSpacing: 3, fontSize: 11, textTransform: "uppercase" },
  headline: { color: "#fff", fontFamily: fonts.displayXL, fontSize: 44, lineHeight: 46, letterSpacing: -1 },
  sub: { color: "rgba(255,255,255,0.85)", fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  btn: {
    marginTop: 14, height: 58, backgroundColor: "#fff", borderRadius: radii.pill,
    alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10,
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  btnText: { color: colors.textPrimary, fontFamily: fonts.bodyBold, fontSize: 16 },
  guestBtn: { paddingVertical: 12, alignItems: "center" },
  guestText: { color: "rgba(255,255,255,0.95)", fontFamily: fonts.bodySemi, fontSize: 14 },
  err: { color: "#FFE0E0", textAlign: "center", fontFamily: fonts.body, fontSize: 12 },
});
