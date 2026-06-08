import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";

import { api, Post } from "@/src/api";
import { colors, fonts } from "@/src/theme";
import { MasonryGrid } from "@/src/components/MasonryGrid";
import { useAuth } from "@/src/auth";
import { useSocial } from "@/src/social";

export default function SavedScreen() {
  const { user } = useAuth();
  const { reload } = useSocial();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await api<{ posts: Post[] }>("/bookmarks");
      setPosts(r.posts);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
      reload();
    }, [load, reload]),
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>YOUR LIBRARY</Text>
        <Text style={styles.title}>Saved</Text>
        <Text style={styles.sub}>The places, events, and stories you keep coming back to.</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingTop: 14, paddingBottom: 40 }} testID="saved-scroll">
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing saved yet</Text>
            <Text style={styles.emptyBody}>
              Tap the bookmark on any post and it'll live here — your own quiet map of the city.
            </Text>
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
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  eyebrow: { color: colors.primary, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 2.5 },
  title: { fontFamily: fonts.serifBold, fontSize: 32, color: colors.textPrimary, marginTop: 2 },
  sub: { fontFamily: fonts.sans, fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  center: { paddingVertical: 60, alignItems: "center" },
  empty: { paddingHorizontal: 30, paddingVertical: 60, alignItems: "center", gap: 8 },
  emptyTitle: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.textPrimary },
  emptyBody: { fontFamily: fonts.sans, fontSize: 14, color: colors.textSecondary, textAlign: "center", lineHeight: 20 },
});
