/**
 * Post — design panel `1d`.
 *
 * Media fills the top third, then the person, then the words. The place sits in
 * its own card rather than as a line of meta, because "where is this" is the
 * question the screen exists to answer.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, ApiError, Creator, Post } from "@/src/api";
import { useAuth } from "@/src/auth";
import {
  Avatar,
  Hatch,
  Loading,
  Mono,
  PillButton,
  SectionHeading,
  Tag,
} from "@/src/components/organic";
import { MediaTile } from "@/src/components/MediaTile";
import { ReportSheet } from "@/src/components/organic/ReportSheet";
import { useSocial } from "@/src/social";
import { fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

export default function PostDetail() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { bookmarkIds, toggleBookmark, followIds, toggleFollow } = useSocial();

  const [post, setPost] = useState<Post | null>(null);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [related, setRelated] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api<{ post: Post; creator: Creator | null; related: Post[] }>(`/posts/${id}`, {
      auth: false,
    })
      .then((r) => {
        setPost(r.post);
        setCreator(r.creator ?? r.post.creator ?? null);
        setRelated(r.related ?? []);
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Could not load this post."),
      )
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <View style={s.root}>
        <Loading />
      </View>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <View style={{ padding: 26, gap: 12 }}>
          <Text style={s.title}>Not here</Text>
          <Text style={s.caption}>{error || "That post has gone."}</Text>
          <PillButton
            label="Back"
            variant="ghost"
            onPress={() => router.back()}
            style={{ alignSelf: "flex-start" }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const saved = bookmarkIds.has(post.post_id);
  const following = creator ? followIds.has(creator.creator_id) : false;
  const requireAuth = (fn: () => void) => () =>
    user ? fn() : router.push("/login");

  const share = async () => {
    try {
      await Share.share({
        message: post.location_name
          ? `${post.location_name} — ${post.caption}`
          : post.caption,
      });
    } catch {
      // The sheet was dismissed, or the platform declined. Nothing to report.
    }
  };

  return (
    <View style={s.root}>
      <ScrollView showsVerticalScrollIndicator={false} testID="post-scroll">
        <View style={s.hero}>
          {post.image || post.video_url ? (
            <MediaTile post={post} contentFit="cover" showMute autoPlay />
          ) : (
            <Hatch tone="accent" style={StyleSheet.absoluteFill} />
          )}

          <SafeAreaView edges={["top"]} style={s.heroBar}>
            <Pressable
              testID="back-btn"
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={s.overlayBtn}
            >
              <Ionicons name="chevron-back" size={20} color="#fff" />
            </Pressable>
            <Pressable
              testID="report-btn"
              onPress={requireAuth(() => setReporting(true))}
              accessibilityRole="button"
              accessibilityLabel="More options"
              style={s.overlayBtn}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color="#fff" />
            </Pressable>
          </SafeAreaView>
        </View>

        <View style={s.body}>
          <View style={s.creatorRow}>
            <Pressable
              onPress={() =>
                creator && router.push(`/creator/${creator.creator_id}`)
              }
              disabled={!creator}
              accessibilityRole="button"
              style={s.creatorWho}
            >
              <Avatar
                name={creator?.name}
                uri={creator?.avatar}
                size={40}
                seed={creator?.creator_id}
              />
              <View style={{ gap: 2, flexShrink: 1 }}>
                <Text style={s.creatorName} numberOfLines={1}>
                  {creator?.name ?? "Around You"}
                </Text>
                <Mono numberOfLines={1}>
                  {[creator?.handle, creator && `${creator.followers} followers`]
                    .filter(Boolean)
                    .join(" · ")}
                </Mono>
              </View>
            </Pressable>
            {creator && (
              <PillButton
                label={following ? "Following" : "Follow"}
                variant={following ? "ghost" : "primary"}
                size="sm"
                onPress={requireAuth(() => toggleFollow(creator.creator_id))}
              />
            )}
          </View>

          <Text style={s.caption}>{post.caption}</Text>

          <View style={s.tagRow}>
            <Tag label={post.category} tone="accent" />
            {post.hashtags?.map((h) => (
              <Tag key={h} label={h.startsWith("#") ? h : `#${h}`} tone="outline" />
            ))}
          </View>

          {(post.location_name || post.neighborhood) && (
            <View style={s.placeCard}>
              <Ionicons name="location" size={18} color={t.accentRamp[700]} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.placeName} numberOfLines={1}>
                  {post.location_name || post.neighborhood}
                </Text>
                <Mono numberOfLines={1}>
                  {[post.neighborhood, post.lat && post.lng ? "pin dropped" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </Mono>
              </View>
              <PillButton
                label="Map"
                variant="soft"
                size="sm"
                onPress={() => router.push("/(tabs)/nearby")}
              />
            </View>
          )}

          {post.source ? (
            <Mono>
              via {post.source}
              {post.is_sponsored ? " · sponsored" : ""}
            </Mono>
          ) : post.is_sponsored ? (
            <Tag label="Sponsored" tone="accent2" style={{ alignSelf: "flex-start" }} />
          ) : null}

          {related.length > 0 && (
            <View style={{ gap: 9, marginTop: 6 }}>
              <SectionHeading>{`More ${post.category} near here`}</SectionHeading>
              <View style={{ flexDirection: "row", gap: 9 }}>
                {related.slice(0, 3).map((r) => (
                  <Pressable
                    key={r.post_id}
                    onPress={() => router.push(`/post/${r.post_id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={r.caption}
                    style={s.relatedTile}
                  >
                    {r.image ? (
                      <Image
                        source={{ uri: r.image }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={180}
                      />
                    ) : (
                      <Hatch style={StyleSheet.absoluteFill} />
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={s.actionBar}>
        <Text style={s.likes}>{post.likes} likes</Text>
        <PillButton label="Share" variant="ghost" size="sm" onPress={share} />
        <PillButton
          testID="save-btn"
          label={saved ? "Saved" : "Save"}
          variant="dark"
          size="sm"
          icon={saved ? "bookmark" : "bookmark-outline"}
          onPress={requireAuth(() => toggleBookmark(post.post_id))}
        />
      </SafeAreaView>

      <ReportSheet
        visible={reporting}
        onClose={() => setReporting(false)}
        targetType="post"
        targetId={post.post_id}
        targetLabel="this post"
      />
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    hero: { height: 430, backgroundColor: t.neutral[200] },
    heroBar: {
      position: "absolute",
      left: 16,
      right: 16,
      top: 0,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    overlayBtn: {
      width: 36,
      height: 36,
      borderRadius: radii.pill,
      backgroundColor: "rgba(32,30,29,0.6)",
      alignItems: "center",
      justifyContent: "center",
      marginTop: 8,
    },

    body: { padding: 20, gap: 13, paddingBottom: 28 },
    title: { fontFamily: fonts.heading, fontSize: type.h3, color: t.text },
    creatorRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    creatorWho: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
    creatorName: { fontFamily: fonts.bodyBold, fontSize: type.bodySm, color: t.text },

    caption: {
      fontFamily: fonts.body,
      fontSize: type.body,
      lineHeight: 23,
      color: t.text,
    },
    tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },

    placeCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      backgroundColor: t.surface,
      borderRadius: radii.card,
      paddingHorizontal: 15,
      paddingVertical: 13,
    },
    placeName: { fontFamily: fonts.bodyBold, fontSize: type.meta, color: t.text },

    relatedTile: {
      flex: 1,
      height: 82,
      borderRadius: radii.md,
      overflow: "hidden",
      backgroundColor: t.neutral[200],
    },

    actionBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: space[2],
      borderTopWidth: 1,
      borderTopColor: t.divider,
      backgroundColor: t.bg,
    },
    likes: {
      marginRight: "auto",
      fontFamily: fonts.bodySemi,
      fontSize: 12,
      color: t.ink(58),
    },
  });
}
