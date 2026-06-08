import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, Post } from "@/src/api";
import { colors, fonts, CATEGORIES } from "@/src/theme";
import { CategoryChips } from "@/src/components/CategoryChips";
import { MasonryGrid } from "@/src/components/MasonryGrid";

export default function DiscoverScreen() {
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
    try {
      await load(category);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>HOUSTON · TODAY</Text>
          <Text style={styles.title}>Around You</Text>
        </View>
        <Text style={styles.sub}>What's actually happening, told by locals.</Text>
      </View>

      <CategoryChips categories={CATEGORIES} selected={category} onSelect={setCategory} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        testID="discover-scroll"
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.empty}>No posts in this category yet.</Text>
          </View>
        ) : (
          <MasonryGrid posts={posts} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  eyebrow: { color: colors.primary, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 2.5 },
  title: { fontFamily: fonts.serifBold, fontSize: 32, color: colors.textPrimary, marginTop: 2 },
  sub: { fontFamily: fonts.sans, fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  scroll: { paddingTop: 14, paddingBottom: 40 },
  center: { paddingVertical: 60, alignItems: "center" },
  empty: { color: colors.textSecondary, fontFamily: fonts.sans },
});
