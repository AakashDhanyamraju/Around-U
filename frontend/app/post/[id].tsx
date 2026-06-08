import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, Creator, Post } from "@/src/api";
import { colors, fonts, radii } from "@/src/theme";
import { useSocial } from "@/src/social";
import { MasonryGrid } from "@/src/components/MasonryGrid";

const HERO_H = Math.round(Dimensions.get("window").height * 0.55);

export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { bookmarkIds, toggleBookmark, followIds, toggleFollow } = useSocial();
  const [post, setPost] = useState<Post | null>(null);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [related, setRelated] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api<{ post: Post; creator: Creator; related: Post[] }>(`/posts/${id}`, { auth: false })
      .then((r) => {
        setPost(r.post);
        setCreator(r.creator);
        setRelated(r.related);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading || !post) {
    return (
      <View style={styles.loadWrap}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const saved = bookmarkIds.has(post.post_id);
  const following = creator ? followIds.has(creator.creator_id) : false;

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} testID="post-scroll">
        <View style={{ height: HERO_H }}>
          <Image source={{ uri: post.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient
            colors={["rgba(0,0,0,0.45)", "transparent", "rgba(28,25,23,0.0)"]}
            locations={[0, 0.3, 1]}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView edges={["top"]} style={styles.topBar}>
            <Pressable testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
            <Pressable
              testID="save-btn"
              onPress={() => toggleBookmark(post.post_id)}
              style={styles.iconBtn}
            >
              <Ionicons name={saved ? "bookmark" : "bookmark-outline"} size={20} color="#fff" />
            </Pressable>
          </SafeAreaView>
        </View>

        <View style={styles.body}>
          <View style={styles.chipsRow}>
            <View style={styles.metaChip}>
              <Ionicons name="location-outline" size={12} color={colors.primary} />
              <Text style={styles.metaChipText}>{post.neighborhood}</Text>
            </View>
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>{post.category}</Text>
            </View>
          </View>

          <Text style={styles.caption}>{post.caption}</Text>

          {post.category === "Events" ? (
            <View style={styles.interestRow}>
              <View style={styles.interestAvatars}>
                <Image source={{ uri: "https://i.pravatar.cc/40?img=12" }} style={[styles.iAvatar, { marginLeft: 0 }]} />
                <Image source={{ uri: "https://i.pravatar.cc/40?img=32" }} style={styles.iAvatar} />
                <Image source={{ uri: "https://i.pravatar.cc/40?img=45" }} style={styles.iAvatar} />
              </View>
              <Text style={styles.interestText}>+{120 + (post.likes % 200)} neighbors interested</Text>
              <Pressable testID="interested-btn" style={styles.interestBtn}>
                <Text style={styles.interestBtnText}>I'm in</Text>
              </Pressable>
            </View>
          ) : null}

          {post.location_name ? (
            <View style={styles.locationCard}>
              <Ionicons name="pin" size={16} color={colors.primary} />
              <Text style={styles.locationText}>{post.location_name}</Text>
            </View>
          ) : null}

          {creator ? (
            <Pressable
              testID="creator-card"
              onPress={() => router.push(`/creator/${creator.creator_id}`)}
              style={styles.creatorCard}
            >
              <Image source={{ uri: creator.avatar }} style={styles.creatorAvatar} />
              <View style={{ flex: 1 }}>
                <Text style={styles.creatorName}>{creator.name}</Text>
                <Text style={styles.creatorHandle}>{creator.handle}</Text>
              </View>
              <Pressable
                testID="follow-btn"
                onPress={(e) => {
                  e.stopPropagation();
                  toggleFollow(creator.creator_id);
                }}
                style={[styles.followBtn, following && styles.followBtnActive]}
              >
                <Text style={[styles.followText, following && styles.followTextActive]}>
                  {following ? "Following" : "Follow"}
                </Text>
              </Pressable>
            </Pressable>
          ) : null}

          {related.length > 0 ? (
            <View style={{ marginTop: 28 }}>
              <Text style={styles.relatedTitle}>More in {post.category.toLowerCase()}</Text>
              <View style={{ marginHorizontal: -12, marginTop: 12 }}>
                <MasonryGrid posts={related} />
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loadWrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 60,
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -28,
  },
  chipsRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  metaChipText: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.textSecondary, letterSpacing: 0.5 },
  caption: { fontFamily: fonts.display, fontSize: 22, color: colors.textPrimary, lineHeight: 32 },
  interestRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg, padding: 10, marginTop: 18,
  },
  interestAvatars: { flexDirection: "row" },
  iAvatar: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: "#fff", marginLeft: -10 },
  interestText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 12, color: colors.textPrimary },
  interestBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.primary },
  interestBtnText: { color: "#fff", fontFamily: fonts.bodyBold, fontSize: 12 },
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radii.md,
    marginTop: 18,
  },
  locationText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.textPrimary },
  creatorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    borderRadius: radii.lg,
    marginTop: 16,
  },
  creatorAvatar: { width: 48, height: 48, borderRadius: 24 },
  creatorName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.textPrimary },
  creatorHandle: { fontFamily: fonts.body, fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  followBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  followBtnActive: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  followText: { color: "#fff", fontFamily: fonts.bodyBold, fontSize: 12 },
  followTextActive: { color: colors.textPrimary },
  relatedTitle: { fontFamily: fonts.displayXL, fontSize: 20, color: colors.textPrimary },
});
