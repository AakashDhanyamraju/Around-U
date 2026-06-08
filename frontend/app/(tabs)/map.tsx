import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api, Post } from "@/src/api";
import { colors, fonts, radii } from "@/src/theme";

const HOUSTON_MAP =
  "https://images.unsplash.com/photo-1569959220744-ff553533f492?w=1200&q=80";

export default function MapScreen() {
  const [posts, setPosts] = useState<Post[]>([]);
  const router = useRouter();

  useEffect(() => {
    api<Post[]>("/posts", { auth: false }).then(setPosts).catch(() => {});
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, Post[]>();
    posts.forEach((p) => {
      const list = m.get(p.neighborhood) || [];
      list.push(p);
      m.set(p.neighborhood, list);
    });
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [posts]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} testID="map-scroll">
        <View style={styles.hero}>
          <Image source={{ uri: HOUSTON_MAP }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient
            colors={["rgba(28,25,23,0.1)", "rgba(28,25,23,0.85)"]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroInner}>
            <Text style={styles.eyebrow}>NEIGHBORHOODS</Text>
            <Text style={styles.heroTitle}>Houston by{"\n"}its corners.</Text>
            <Text style={styles.heroSub}>{posts.length} posts · {grouped.length} neighborhoods</Text>
          </View>
          {/* Dot pins overlay */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {grouped.slice(0, 7).map((_, i) => {
              const positions = [
                { top: "35%", left: "30%" },
                { top: "55%", left: "55%" },
                { top: "40%", left: "70%" },
                { top: "65%", left: "25%" },
                { top: "25%", left: "55%" },
                { top: "70%", left: "75%" },
                { top: "50%", left: "15%" },
              ] as const;
              return (
                <View key={i} style={[styles.pinWrap, positions[i] as any]}>
                  <View style={styles.pinDot} />
                  <View style={styles.pinRing} />
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.list}>
          <Text style={styles.sectionTitle}>Hot neighborhoods</Text>
          {grouped.map(([n, list]) => (
            <Pressable
              key={n}
              testID={`neighborhood-${n.toLowerCase().replace(/\s+/g, "-")}`}
              onPress={() => router.push(`/post/${list[0].post_id}`)}
              style={styles.row}
            >
              <Image source={{ uri: list[0].image }} style={styles.thumb} />
              <View style={styles.rowMid}>
                <Text style={styles.rowTitle}>{n}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {list.length} {list.length === 1 ? "post" : "posts"} · {list.map((p) => p.category).slice(0, 2).join(" · ")}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  hero: { height: 320, justifyContent: "flex-end", overflow: "hidden" },
  heroInner: { padding: 20 },
  eyebrow: { color: colors.accent, fontFamily: fonts.bodyBold, letterSpacing: 2.5, fontSize: 11 },
  heroTitle: { color: "#fff", fontFamily: fonts.displayXL, fontSize: 34, lineHeight: 38, marginTop: 4 },
  heroSub: { color: "rgba(255,255,255,0.8)", marginTop: 8, fontFamily: fonts.body },
  pinWrap: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  pinDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary, borderWidth: 2, borderColor: "#fff" },
  pinRing: { position: "absolute", width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: "rgba(255,255,255,0.5)" },
  list: { padding: 16, gap: 10 },
  sectionTitle: { fontFamily: fonts.displayXL, fontSize: 22, color: colors.textPrimary, marginBottom: 6 },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: { width: 60, height: 60, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  rowMid: { flex: 1 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.textPrimary },
  rowSub: { fontFamily: fonts.body, fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
