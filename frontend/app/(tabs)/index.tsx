import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  ActivityIndicator, Pressable,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api, Post } from "@/src/api";
import { colors, fonts, radii, shadow, CATEGORIES } from "@/src/theme";
import { CategoryChips } from "@/src/components/CategoryChips";
import { MasonryGrid } from "@/src/components/MasonryGrid";
import { useAuth } from "@/src/auth";

export default function DiscoverScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (cat: string) => {
    const data = await api<Post[]>(`/posts?category=${encodeURIComponent(cat)}`, { auth: false });
    setPosts(data);
  }, []);

  useEffect(() => {
    setLoading(true);
    load(category).finally(() => setLoading(false));
  }, [category, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(category); } finally { setRefreshing(false); }
  };

  const featured = posts[0];
  const rest = posts.slice(1);
  const firstName = user?.name?.split(" ")[0] || "friend";

  return (
    <View style={styles.root}>
      {/* peach blobs in background */}
      <View style={[styles.blob, { top: -120, right: -120, backgroundColor: colors.blob, opacity: 0.55 }]} />
      <View style={[styles.blob, { top: 220, left: -160, width: 320, height: 320, backgroundColor: colors.blobSoft, opacity: 0.6 }]} />

      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <View style={styles.header}>
          <View style={styles.logoPill}>
            <View style={styles.logoIcon}>
              <Ionicons name="location" size={14} color="#fff" />
            </View>
            <View>
              <Text style={styles.logoText}>around you</Text>
              <Text style={styles.logoCity}>· Houston</Text>
            </View>
          </View>
          <Pressable style={styles.bellBtn}>
            <Ionicons name="notifications-outline" size={18} color={colors.textPrimary} />
            <View style={styles.bellDot} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          testID="discover-scroll"
          stickyHeaderIndices={[1]}
        >
          <View style={styles.greetingBlock}>
            <Text style={styles.greeting}>
              Good day, <Text style={{ color: colors.primary, fontFamily: fonts.displayXL }}>{firstName}</Text> 👋
            </Text>
            <Text style={styles.greetingSub}>
              {posts.length} fresh stories from your neighborhood today
            </Text>
          </View>

          <View style={styles.chipsSticky}>
            <CategoryChips categories={CATEGORIES} selected={category} onSelect={setCategory} />
          </View>

          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <>
              {featured && (
                <Animated.View entering={FadeInDown.duration(500)} style={styles.featuredSection}>
                  <View style={styles.sectionHead}>
                    <View style={styles.sectionAccent} />
                    <Text style={styles.sectionTitle}>Featured Today</Text>
                    <Pressable><Text style={styles.seeAll}>See all →</Text></Pressable>
                  </View>
                  <Pressable
                    testID={`featured-${featured.post_id}`}
                    onPress={() => router.push(`/post/${featured.post_id}`)}
                    style={({ pressed }) => [styles.featuredCard, pressed && { transform: [{ scale: 0.99 }] }]}
                  >
                    <Image source={{ uri: featured.image }} style={styles.featuredImage} contentFit="cover" />
                    {/* Droplet-style date tab (inspired by community event cards) */}
                    <View style={styles.dateDroplet}>
                      <Text style={styles.dateDay}>{new Date(featured.created_at).getDate()}</Text>
                      <Text style={styles.dateMon}>{new Date(featured.created_at).toLocaleString("en", { month: "short" }).toUpperCase()}</Text>
                    </View>
                    <View style={styles.featuredTopRow}>
                      <View style={styles.featuredChipRow}>
                        <View style={styles.featuredStar}>
                          <Ionicons name="star" size={10} color="#fff" />
                          <Text style={styles.featuredStarText}>Featured</Text>
                        </View>
                        <View style={styles.featuredCatChip}>
                          <Text style={styles.featuredCatText}>{featured.category}</Text>
                        </View>
                      </View>
                      <View style={styles.featuredSave}>
                        <Ionicons name="bookmark-outline" size={16} color={colors.textPrimary} />
                      </View>
                    </View>
                    <View style={styles.featuredBottom}>
                      {featured.creator && (
                        <View style={styles.creatorBlob}>
                          <Image source={{ uri: featured.creator.avatar }} style={styles.creatorAvatar} />
                          <Text style={styles.creatorVia}>via {featured.creator.handle}</Text>
                        </View>
                      )}
                      <Text style={styles.featuredTitle} numberOfLines={2}>{featured.caption}</Text>
                      <View style={styles.featuredMetaRow}>
                        <View style={styles.metaPill}>
                          <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
                          <Text style={styles.metaPillText}>{featured.neighborhood}</Text>
                        </View>
                        <View style={styles.metaPill}>
                          <Ionicons name="heart-outline" size={12} color={colors.textSecondary} />
                          <Text style={styles.metaPillText}>{featured.likes}</Text>
                        </View>
                      </View>
                    </View>
                  </Pressable>
                </Animated.View>
              )}

              <View style={styles.localHead}>
                <View style={styles.sectionAccent} />
                <Text style={styles.sectionTitle}>Local Highlights</Text>
              </View>

              {rest.length > 0 ? (
                <View style={{ marginTop: 4 }}>
                  <MasonryGrid posts={rest} />
                </View>
              ) : (
                <View style={styles.center}>
                  <Text style={styles.empty}>No stories in this category yet.</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  blob: { position: "absolute", width: 380, height: 380, borderRadius: 999 },
  header: {
    paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  logoPill: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingLeft: 4, paddingRight: 14, paddingVertical: 4, borderRadius: radii.pill,
    backgroundColor: colors.surface, ...shadow,
  },
  logoIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  logoText: { color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bodyBold },
  logoCity: { color: colors.textSecondary, fontSize: 10, fontFamily: fonts.bodyMed, marginTop: -2 },
  bellBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center", ...shadow,
  },
  bellDot: { position: "absolute", top: 10, right: 11, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, borderWidth: 1.5, borderColor: colors.surface },
  greetingBlock: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18 },
  greeting: { fontFamily: fonts.display, fontSize: 26, color: colors.textPrimary, letterSpacing: -0.5 },
  greetingSub: { fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  chipsSticky: { backgroundColor: colors.background },
  featuredSection: { paddingTop: 16 },
  sectionHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, marginBottom: 12, gap: 8 },
  sectionAccent: { width: 3, height: 16, backgroundColor: colors.primary, borderRadius: 2 },
  sectionTitle: { flex: 1, fontFamily: fonts.displayXL, fontSize: 18, color: colors.textPrimary, letterSpacing: -0.3 },
  seeAll: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.primary },
  featuredCard: {
    marginHorizontal: 20, height: 380, borderRadius: radii.xl, overflow: "hidden",
    backgroundColor: colors.surfaceAlt, ...shadow,
  },
  featuredImage: { ...StyleSheet.absoluteFillObject },
  dateDroplet: {
    position: "absolute", top: 20, left: 0,
    backgroundColor: colors.primary,
    paddingVertical: 8, paddingHorizontal: 12,
    borderTopRightRadius: 14, borderBottomRightRadius: 14,
    borderTopLeftRadius: 4, borderBottomLeftRadius: 4,
    alignItems: "center", minWidth: 48,
    shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 2, height: 4 }, elevation: 6,
  },
  dateDay: { color: "#fff", fontFamily: fonts.displayXL, fontSize: 18, lineHeight: 20, letterSpacing: -0.5 },
  dateMon: { color: "rgba(255,255,255,0.9)", fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 1.2, marginTop: 1 },
  featuredTopRow: { position: "absolute", top: 14, left: 14, right: 14, flexDirection: "row", justifyContent: "space-between" },
  featuredChipRow: { flexDirection: "row", gap: 6 },
  featuredStar: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill },
  featuredStarText: { color: "#fff", fontFamily: fonts.bodyBold, fontSize: 11 },
  featuredCatChip: { backgroundColor: "rgba(255,255,255,0.95)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill },
  featuredCatText: { color: colors.textPrimary, fontFamily: fonts.bodySemi, fontSize: 11 },
  featuredSave: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.95)", alignItems: "center", justifyContent: "center" },
  featuredBottom: { position: "absolute", left: 14, right: 14, bottom: 14, backgroundColor: "rgba(255,255,255,0.96)", borderRadius: radii.lg, padding: 14, gap: 8 },
  creatorBlob: { flexDirection: "row", alignItems: "center", gap: 6 },
  creatorAvatar: { width: 24, height: 24, borderRadius: 12 },
  creatorVia: { color: colors.textSecondary, fontFamily: fonts.bodySemi, fontSize: 12 },
  featuredTitle: { fontFamily: fonts.displayXL, fontSize: 17, color: colors.textPrimary, lineHeight: 22, letterSpacing: -0.3 },
  featuredMetaRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  metaPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: colors.surfaceAlt, borderRadius: radii.pill },
  metaPillText: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.textSecondary },
  localHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, marginTop: 28, marginBottom: 14, gap: 8 },
  center: { paddingVertical: 60, alignItems: "center" },
  empty: { color: colors.textSecondary, fontFamily: fonts.body },
});
