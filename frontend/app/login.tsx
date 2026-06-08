import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, fonts, radii } from "@/src/theme";
import { useAuth } from "@/src/auth";

export default function LoginScreen() {
  const { signIn, loading } = useAuth();
  const [busy, setBusy] = React.useState(false);

  const handleSignIn = async () => {
    setBusy(true);
    try {
      await signIn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root} testID="login-screen">
      <Image
        source={{
          uri: "https://images.unsplash.com/photo-1622007151631-25aa98ab394b?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzJ8MHwxfHNlYXJjaHwxfHxob3VzdG9uJTIwc2t5bGluZSUyMGRheXRpbWV8ZW58MHx8fHwxNzgwODkwMjY4fDA&ixlib=rb-4.1.0&q=85",
        }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <LinearGradient
        colors={["rgba(28,25,23,0.2)", "rgba(28,25,23,0.55)", "rgba(28,25,23,0.95)"]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.topRow}>
          <View style={styles.logoPill}>
            <View style={styles.logoDot} />
            <Text style={styles.logoText}>AROUND YOU</Text>
          </View>
        </View>
        <View style={styles.bottom}>
          <Text style={styles.eyebrow}>Houston · est. 2026</Text>
          <Text style={styles.headline}>The city,{"\n"}told by the locals who live it.</Text>
          <Text style={styles.sub}>
            Hand-picked creators sharing the food, gatherings, and quiet corners you won't find on the news.
          </Text>

          <Pressable
            testID="google-signin-btn"
            onPress={handleSignIn}
            disabled={busy || loading}
            style={({ pressed }) => [styles.btn, pressed && { transform: [{ scale: 0.98 }] }]}
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
          <Text style={styles.legal}>By continuing you agree to our terms & community guidelines.</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  safe: { flex: 1, justifyContent: "space-between", paddingHorizontal: 24 },
  topRow: { paddingTop: 12, flexDirection: "row" },
  logoPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  logoDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  logoText: { color: "#fff", fontSize: 12, fontFamily: fonts.sansBold, letterSpacing: 2 },
  bottom: { paddingBottom: 24, gap: 14 },
  eyebrow: { color: colors.accent, fontFamily: fonts.sansSemi, letterSpacing: 3, fontSize: 11, textTransform: "uppercase" },
  headline: { color: "#fff", fontFamily: fonts.serifBold, fontSize: 36, lineHeight: 42 },
  sub: { color: "rgba(255,255,255,0.78)", fontFamily: fonts.sans, fontSize: 15, lineHeight: 22 },
  btn: {
    marginTop: 18,
    height: 56,
    backgroundColor: "#fff",
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  btnText: { color: colors.textPrimary, fontFamily: fonts.sansBold, fontSize: 16 },
  legal: { color: "rgba(255,255,255,0.55)", fontFamily: fonts.sans, fontSize: 11, textAlign: "center", marginTop: 4 },
});
