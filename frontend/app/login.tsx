import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import { useRouter } from "expo-router";

import { colors, fonts, radii, shadow } from "@/src/theme";
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
      {/* Soft peach blobs in background */}
      <View style={[styles.blob, { top: -120, right: -100, backgroundColor: colors.blob, opacity: 0.7 }]} />
      <View style={[styles.blob, { top: 120, left: -140, width: 320, height: 320, backgroundColor: colors.blobSoft, opacity: 0.8 }]} />
      <View style={[styles.blob, { bottom: -80, right: -80, width: 280, height: 280, backgroundColor: colors.blob, opacity: 0.5 }]} />

      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "space-between", paddingHorizontal: 24 }}>
          <Animated.View entering={FadeIn.duration(500)} style={styles.topRow}>
            <View style={styles.logoPill}>
              <View style={styles.logoIcon}>
                <Ionicons name="location" size={14} color="#fff" />
              </View>
              <Text style={styles.logoText}>around you</Text>
            </View>
            <Pressable testID="guest-btn-top" onPress={() => router.replace("/(tabs)")} style={styles.skipBtn}>
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(150).duration(600)} style={styles.heroImageWrap}>
            <Image
              source={{ uri: "https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=900&q=80" }}
              style={styles.heroImage}
              contentFit="cover"
            />
            <View style={styles.heroOverlay}>
              <View style={styles.heroBadge}>
                <View style={styles.heroBadgeIcon}>
                  <Ionicons name="flame" size={12} color="#fff" />
                </View>
                <View>
                  <Text style={styles.heroBadgeTitle}>Trending Near You</Text>
                  <Text style={styles.heroBadgeSub}>14 stories today</Text>
                </View>
              </View>
              <View style={styles.heroRating}>
                <Ionicons name="star" size={12} color={colors.primary} />
                <Text style={styles.heroRatingText}>4.9{"\n"}<Text style={styles.heroRatingSub}>Local picks</Text></Text>
              </View>
            </View>
            <View style={styles.heroFooter}>
              <View style={styles.avatarStack}>
                <Image source={{ uri: "https://i.pravatar.cc/40?img=12" }} style={[styles.stackedAvatar, { marginLeft: 0 }]} />
                <Image source={{ uri: "https://i.pravatar.cc/40?img=32" }} style={styles.stackedAvatar} />
                <Image source={{ uri: "https://i.pravatar.cc/40?img=45" }} style={styles.stackedAvatar} />
              </View>
              <Text style={styles.neighborsText}>2.4k neighbors{"\n"}exploring today</Text>
              <View style={styles.arrowBtn}>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </View>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(280).duration(600)} style={styles.bottom}>
            <View style={styles.welcomeRow}>
              <View style={styles.welcomeDot} />
              <Text style={styles.welcomeText}>WELCOME</Text>
            </View>
            <Text style={styles.headline}>
              Your neighborhood,{"\n"}<Text style={{ color: colors.primary, fontStyle: "italic" }}>beautifully curated.</Text>
            </Text>
            <Text style={styles.sub}>
              Discover hyper-local stories, hidden gems, and community happenings — sourced from the people who know your area best.
            </Text>

            <Pressable
              testID="google-signin-btn"
              onPress={handleSignIn}
              disabled={busy || loading}
              style={({ pressed }) => [styles.btn, pressed && { transform: [{ scale: 0.98 }] }]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="logo-google" size={18} color="#fff" />
                  <Text style={styles.btnText}>Get Started with Google</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </>
              )}
            </Pressable>

            <Pressable
              testID="guest-btn"
              onPress={() => router.replace("/(tabs)")}
              style={({ pressed }) => [styles.guestBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.guestText}>
                Or <Text style={{ color: colors.primary, fontFamily: fonts.bodyBold }}>browse as a guest</Text>
              </Text>
            </Pressable>

            {err ? <Text style={styles.err}>{err}</Text> : null}
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  blob: { position: "absolute", width: 360, height: 360, borderRadius: 999 },
  safe: { flex: 1 },
  topRow: { paddingTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  logoPill: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingLeft: 4, paddingRight: 14, paddingVertical: 4, borderRadius: radii.pill,
    backgroundColor: colors.surface, ...shadow,
  },
  logoIcon: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center",
  },
  logoText: { color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bodyBold },
  skipBtn: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: radii.pill,
    backgroundColor: colors.surface, ...shadow,
  },
  skipText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.textPrimary },
  heroImageWrap: {
    marginTop: 28, alignSelf: "center", width: "100%", height: 360,
    borderRadius: radii.xl, overflow: "hidden", backgroundColor: colors.surfaceAlt, ...shadow,
  },
  heroImage: { width: "100%", height: "100%" },
  heroOverlay: { position: "absolute", top: 14, left: 14, right: 14, flexDirection: "row", justifyContent: "space-between" },
  heroBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,255,255,0.95)", paddingLeft: 4, paddingRight: 12, paddingVertical: 4, borderRadius: radii.pill,
  },
  heroBadgeIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  heroBadgeTitle: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textPrimary },
  heroBadgeSub: { fontFamily: fonts.body, fontSize: 10, color: colors.textSecondary },
  heroRating: { backgroundColor: "rgba(255,255,255,0.95)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.md, flexDirection: "row", alignItems: "center", gap: 4 },
  heroRatingText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.textPrimary, lineHeight: 14 },
  heroRatingSub: { fontFamily: fonts.body, fontSize: 9, color: colors.textSecondary },
  heroFooter: {
    position: "absolute", bottom: 14, left: 14, right: 14, flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(255,255,255,0.95)", paddingHorizontal: 10, paddingVertical: 8, borderRadius: radii.lg,
  },
  avatarStack: { flexDirection: "row" },
  stackedAvatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "#fff", marginLeft: -10 },
  neighborsText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 11, color: colors.textPrimary, lineHeight: 13 },
  arrowBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  bottom: { paddingBottom: 20, paddingTop: 28, gap: 14 },
  welcomeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  welcomeDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  welcomeText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2, color: colors.primary },
  headline: { color: colors.textPrimary, fontFamily: fonts.displayXL, fontSize: 36, lineHeight: 40, letterSpacing: -0.8 },
  sub: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 14, lineHeight: 21 },
  btn: {
    marginTop: 10, height: 58, backgroundColor: colors.primary, borderRadius: radii.pill,
    alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10,
    shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  btnText: { color: "#fff", fontFamily: fonts.bodyBold, fontSize: 15 },
  guestBtn: { paddingVertical: 8, alignItems: "center" },
  guestText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 14 },
  err: { color: "#B23A3A", textAlign: "center", fontFamily: fonts.body, fontSize: 12 },
});
