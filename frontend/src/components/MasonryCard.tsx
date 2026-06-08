import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInUp } from "react-native-reanimated";

import { Post } from "@/src/api";
import { colors, radii, fonts } from "@/src/theme";
import { useSocial } from "@/src/social";

type Props = { post: Post; height: number; index: number };

export function MasonryCard({ post, height, index }: Props) {
  const router = useRouter();
  const { bookmarkIds, toggleBookmark } = useSocial();
  const saved = bookmarkIds.has(post.post_id);

  return (
    <Animated.View entering={FadeInUp.delay(index * 40).duration(420)}>
      <Pressable
        testID={`post-card-${post.post_id}`}
        onPress={() => router.push(`/post/${post.post_id}`)}
        style={({ pressed }) => [styles.card, { height }, pressed && { transform: [{ scale: 0.97 }] }]}
      >
        <Image source={{ uri: post.image }} style={styles.image} contentFit="cover" transition={250} />
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.05)", "rgba(0,0,0,0.78)"]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          testID={`bookmark-${post.post_id}`}
          onPress={(e) => {
            e.stopPropagation();
            toggleBookmark(post.post_id);
          }}
          style={({ pressed }) => [styles.saveBtn, pressed && { transform: [{ scale: 0.9 }] }]}
          hitSlop={10}
        >
          <Ionicons
            name={saved ? "bookmark" : "bookmark-outline"}
            size={15}
            color={saved ? colors.primary : "#fff"}
          />
        </Pressable>

        <View style={styles.bottom}>
          <View style={styles.catChip}>
            <Text style={styles.catChipText} numberOfLines={1}>{post.category}</Text>
          </View>
          <Text style={styles.caption} numberOfLines={2}>{post.caption}</Text>
          <View style={styles.creatorRow}>
            {post.creator?.avatar ? (
              <Image source={{ uri: post.creator.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.surfaceAlt }]} />
            )}
            <Text style={styles.creatorName} numberOfLines={1}>
              {post.creator?.name || post.neighborhood}
            </Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    borderRadius: radii.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
    marginBottom: 14,
    shadowColor: "#1A1320", shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  image: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  saveBtn: {
    position: "absolute", top: 10, right: 10, width: 32, height: 32, borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.42)", alignItems: "center", justifyContent: "center",
  },
  bottom: { position: "absolute", left: 12, right: 12, bottom: 12 },
  catChip: {
    alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, marginBottom: 7,
  },
  catChipText: { fontSize: 10, color: colors.textPrimary, fontFamily: fonts.bodyBold, letterSpacing: 0.5 },
  caption: { color: "#fff", fontSize: 12.5, fontFamily: fonts.bodyMed, lineHeight: 17, marginBottom: 7 },
  creatorRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  avatar: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.8)" },
  creatorName: { color: "rgba(255,255,255,0.95)", fontSize: 11, fontFamily: fonts.bodySemi },
});
