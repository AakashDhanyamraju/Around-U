import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, Creator, Post } from "@/src/api";
import { colors, fonts, radii } from "@/src/theme";
import { useSocial } from "@/src/social";
import { MasonryGrid } from "@/src/components/MasonryGrid";

export default function CreatorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { followIds, toggleFollow } = useSocial();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api<{ creator: Creator; posts: Post[] }>(`/creators/${id}`, { auth: false })
      .then((r) => {
        setCreator(r.creator);
        setPosts(r.posts.map((p) => ({ ...p, creator: r.creator })));
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading || !creator) {
    return (
      <View style={styles.loadWrap}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const following = followIds.has(creator.creator_id);

  return (
    <View style={styles.root}>
      <ScrollView testID="creator-scroll" showsVerticalScrollIndicator={false}>
        <View style={styles.cover}>
          <Image
            source={{ uri: creator.cover || creator.avatar }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          <LinearGradient
            colors={["rgba(0,0,0,0.3)", "rgba(28,25,23,0.85)"]}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView edges={["top"]} style={styles.topBar}>
            <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
          </SafeAreaView>
          <View style={styles.coverBottom}>
            <Image source={{ uri: creator.avatar }} style={styles.avatar} />
            <Text style={styles.name}>{creator.name}</Text>
            <Text style={styles.handle}>{creator.handle}</Text>
            <Text style={styles.bio}>{creator.bio}</Text>
            <View style={styles.statsRow}>
              <Text style={styles.statText}>
                <Text style={styles.statNum}>{creator.followers.toLocaleString()}</Text> followers
              </Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.statText}>
                <Text style={styles.statNum}>{posts.length}</Text> posts
              </Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.statText}>{creator.city}</Text>
            </View>
            <Pressable
              testID="follow-btn"
              onPress={() => toggleFollow(creator.creator_id)}
              style={[styles.followBtn, following && styles.followBtnActive]}
            >
              <Text style={[styles.followText, following && styles.followTextActive]}>
                {following ? "Following" : "Follow"}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={{ marginTop: 20 }}>
          <Text style={styles.sectionTitle}>Recent posts</Text>
          <View style={{ marginTop: 12 }}>
            <MasonryGrid posts={posts} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loadWrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  cover: { paddingBottom: 24 },
  topBar: { flexDirection: "row", paddingHorizontal: 16, paddingTop: 8 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  coverBottom: { paddingHorizontal: 20, paddingTop: 60, alignItems: "center" },
  avatar: { width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: "#fff" },
  name: { color: "#fff", fontFamily: fonts.displayXL, fontSize: 24, marginTop: 12 },
  handle: { color: "rgba(255,255,255,0.7)", fontFamily: fonts.bodyMed, marginTop: 2, fontSize: 13 },
  bio: { color: "rgba(255,255,255,0.85)", fontFamily: fonts.body, marginTop: 12, fontSize: 14, textAlign: "center", lineHeight: 20, paddingHorizontal: 12 },
  statsRow: { flexDirection: "row", gap: 6, marginTop: 14, alignItems: "center" },
  statText: { color: "rgba(255,255,255,0.85)", fontFamily: fonts.body, fontSize: 12 },
  statNum: { fontFamily: fonts.bodyBold, color: "#fff" },
  dot: { color: "rgba(255,255,255,0.5)" },
  followBtn: {
    marginTop: 18,
    paddingHorizontal: 32,
    paddingVertical: 11,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  followBtnActive: { backgroundColor: "rgba(255,255,255,0.15)", borderWidth: 1, borderColor: "rgba(255,255,255,0.4)" },
  followText: { color: "#fff", fontFamily: fonts.bodyBold, fontSize: 13 },
  followTextActive: { color: "#fff" },
  sectionTitle: { fontFamily: fonts.displayXL, fontSize: 20, color: colors.textPrimary, paddingHorizontal: 20 },
});
