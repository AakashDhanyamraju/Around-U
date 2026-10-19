/**
 * Feed — design panel `1a`. What the people you follow posted.
 *
 * A rail of creators sits above the posts so the first decision you make is
 * *who*, not *what*; posts below are single-column and editorial rather than a
 * grid. Signed out, the third post fades into a soft wall — you can read, you
 * just can't keep anything.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { api, Creator, Post } from "@/src/api";
import { useAuth } from "@/src/auth";
import {
  Avatar,
  ChipRow,
  Hatch,
  Loading,
  Mono,
  OverlayPill,
  PillButton,
  Screen,
  ScreenTitle,
  SectionHeading,
} from "@/src/components/organic";
import { useSocial } from "@/src/social";
import { FILTER_CATEGORIES, fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

/** How many posts a signed-out visitor reads before the wall appears. */
const FREE_READS = 3;

export default function FeedScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const { user } = useAuth();
  const { followIds, bookmarkIds, toggleFollow, toggleBookmark } = useSocial();

  const [posts, setPosts] = useState<Post[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // Signed out there is no follow graph, so the public feed stands in — the
    // wall below is what makes the difference visible, not an empty screen.
    const [p, c] = await Promise.all([
      user
        ? api<Post[]>(`/feed?category=${encodeURIComponent(category)}`)
        : api<Post[]>(`/posts?category=${encodeURIComponent(category)}`, {
            auth: false,
          }),
      api<Creator[]>("/creators", { auth: false }),
    ]);
    setPosts(p);
    setCreators(c);
  }, [user, category]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, [load]);

  // Following someone from the rail should change the feed on the way back.
  useFocusEffect(
    useCallback(() => {
      if (user) load().catch(() => {});
    }, [user, load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } catch {
      // Leave the current posts up rather than blanking a working screen.
    } finally {
      setRefreshing(false);
    }
  };

  const suggestions = useMemo(
    () => creators.filter((c) => !followIds.has(c.creator_id)).slice(0, 8),
    [creators, followIds],
  );

  const walled = !user;
  const visible = walled ? posts.slice(0, FREE_READS) : posts;

  return (
    <Screen>
      <View style={s.header}>
        <ScreenTitle
          trailing={
            <View style={s.cityPill}>
              <Ionicons name="location" size={13} color={t.accentRamp[700]} />
              <Text style={s.cityText}>{t.cityName}</Text>
            </View>
          }
        >
          Around You
        </ScreenTitle>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        testID="feed-scroll"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.accent}
          />
        }
      >
        {suggestions.length > 0 && (
          <View style={{ paddingBottom: 12 }}>
            <View style={{ paddingHorizontal: 20, paddingBottom: 9 }}>
              <SectionHeading
                action="See all"
                onAction={() => router.push("/(tabs)")}
              >
                People worth following
              </SectionHeading>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={142}
              decelerationRate="fast"
              contentContainerStyle={{ gap: 10, paddingHorizontal: 20 }}
            >
              {suggestions.map((c) => (
                <View key={c.creator_id} style={s.railCard}>
                  <Pressable
                    onPress={() => router.push(`/creator/${c.creator_id}`)}
                    accessibilityRole="button"
                    style={{ alignItems: "center", gap: 7 }}
                  >
                    <Avatar
                      name={c.name}
                      uri={c.avatar}
                      size={52}
                      seed={c.creator_id}
                    />
                    <Text style={s.railName} numberOfLines={2}>
                      {c.name}
                    </Text>
                    <Mono numberOfLines={1}>{c.handle}</Mono>
                    <Text style={s.railBeat} numberOfLines={1}>
                      {c.categories?.slice(0, 2).join(" · ") || c.city}
                    </Text>
                  </Pressable>
                  <PillButton
                    label="Follow"
                    size="sm"
                    block
                    onPress={() =>
                      user ? toggleFollow(c.creator_id) : router.push("/login")
                    }
                    style={{ marginTop: 2 }}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={{ paddingBottom: 12 }}>
          <ChipRow
            items={FILTER_CATEGORIES}
            selected={category}
            onSelect={setCategory}
          />
        </View>

        {loading ? (
          <Loading />
        ) : visible.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>
              {user ? "Quiet in here" : "Nothing published yet"}
            </Text>
            <Text style={s.emptyBody}>
              {user
                ? `Follow a few people covering ${t.cityName} and their posts land here.`
                : `As creators publish in ${t.cityName}, their posts show up here.`}
            </Text>
            {user ? (
              <PillButton
                label="Find people to follow"
                variant="outline"
                onPress={() => router.push("/(tabs)")}
                style={{ alignSelf: "flex-start", marginTop: 4 }}
              />
            ) : null}
          </View>
        ) : (
          <View style={s.stream}>
            {visible.map((post) => (
              <FeedPost
                key={post.post_id}
                post={post}
                following={
                  !!post.creator_id && followIds.has(post.creator_id)
                }
                saved={bookmarkIds.has(post.post_id)}
                onFollow={() =>
                  user && post.creator_id
                    ? toggleFollow(post.creator_id)
                    : router.push("/login")
                }
                onSave={() =>
                  user ? toggleBookmark(post.post_id) : router.push("/login")
                }
                onOpen={() => router.push(`/post/${post.post_id}`)}
                onOpenCreator={() =>
                  post.creator_id && router.push(`/creator/${post.creator_id}`)
                }
              />
            ))}

            {walled && posts.length > FREE_READS && (
              <LinearGradient
                colors={["rgba(245,234,216,0)", t.bg, t.bg]}
                locations={[0, 0.46, 1]}
                style={s.wall}
              >
                <Text style={s.wallTitle}>Keep reading, keep them</Text>
                <Text style={s.wallBody}>
                  You&apos;ve read {FREE_READS}. Sign in to save spots and follow the
                  people covering {t.cityName}.
                </Text>
                <PillButton
                  label="Continue with email"
                  size="lg"
                  block
                  onPress={() => router.push("/login")}
                />
                <Pressable
                  onPress={() => router.push("/(tabs)")}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={s.wallDismiss}>Not now — keep browsing</Text>
                </Pressable>
              </LinearGradient>
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function FeedPost({
  post,
  following,
  saved,
  onFollow,
  onSave,
  onOpen,
  onOpenCreator,
}: {
  post: Post;
  following: boolean;
  saved: boolean;
  onFollow: () => void;
  onSave: () => void;
  onOpen: () => void;
  onOpenCreator: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const when = relativeTime(post.created_at);

  return (
    <View style={{ gap: 9 }}>
      <View style={s.postHead}>
        <Pressable
          onPress={onOpenCreator}
          accessibilityRole="button"
          style={s.postWho}
        >
          <Avatar
            name={post.creator?.name}
            uri={post.creator?.avatar}
            size={32}
            seed={post.creator_id}
          />
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Text style={s.postName} numberOfLines={1}>
              {post.creator?.name ?? "Around You"}
            </Text>
            <Mono numberOfLines={1}>
              {[post.creator?.handle, when, post.neighborhood]
                .filter(Boolean)
                .join(" · ")}
            </Mono>
          </View>
        </Pressable>
        {!following && (
          <Pressable
            onPress={onFollow}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Follow ${post.creator?.name ?? "this creator"}`}
            style={s.followPill}
          >
            <Text style={s.followPillText}>Follow</Text>
          </Pressable>
        )}
      </View>

      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={post.caption}
        style={s.media}
      >
        {post.image ? (
          <Image
            source={{ uri: post.image }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={180}
          />
        ) : (
          <Hatch style={StyleSheet.absoluteFill} tone="accent" />
        )}
        {post.media_type === "video" && (
          <OverlayPill style={{ position: "absolute", top: 11, left: 11 }}>
            <Ionicons name="play" size={10} color="#fff" />
            <Text style={s.videoText}>Video</Text>
          </OverlayPill>
        )}
        {post.is_sponsored && (
          <View style={s.sponsored}>
            <Text style={s.sponsoredText}>Sponsored</Text>
          </View>
        )}
      </Pressable>

      <Text style={s.caption}>{post.caption}</Text>

      <View style={s.metaRow}>
        {post.location_name ? (
          <View style={s.metaItem}>
            <Ionicons name="location" size={12} color={t.ink(58)} />
            <Text style={s.metaText} numberOfLines={1}>
              {post.location_name}
            </Text>
          </View>
        ) : null}
        <Text style={s.metaText}>· {post.likes} likes</Text>
        <Pressable
          onPress={onSave}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={saved ? "Remove from saved" : "Save"}
          accessibilityState={{ selected: saved }}
          style={{ marginLeft: "auto" }}
        >
          <Ionicons
            name={saved ? "bookmark" : "bookmark-outline"}
            size={16}
            color={saved ? t.accent : t.ink(58)}
          />
        </Pressable>
      </View>
    </View>
  );
}

/** "2h", "5d" — the compact form the design uses in post meta lines. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 },
    cityPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      backgroundColor: t.accentRamp[100],
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: radii.pill,
    },
    cityText: { fontFamily: fonts.bodySemi, fontSize: 12, color: t.accentRamp[700] },

    railCard: {
      width: 132,
      backgroundColor: t.surface,
      borderRadius: radii.card,
      padding: 12,
      paddingTop: 14,
      gap: 7,
    },
    railName: {
      fontFamily: fonts.bodyBold,
      fontSize: type.meta,
      lineHeight: 16,
      textAlign: "center",
      color: t.text,
    },
    railBeat: {
      fontFamily: fonts.bodySemi,
      fontSize: 10,
      color: t.accent2Ramp[700],
    },

    stream: { paddingHorizontal: 20, gap: 16 },
    postHead: { flexDirection: "row", alignItems: "center", gap: 9 },
    postWho: { flexDirection: "row", alignItems: "center", gap: 9, flex: 1 },
    postName: { fontFamily: fonts.bodyBold, fontSize: type.meta, color: t.text },
    followPill: {
      borderWidth: 1,
      borderColor: t.accentRamp[300],
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radii.pill,
    },
    followPillText: {
      fontFamily: fonts.bodyBold,
      fontSize: type.micro,
      color: t.accentRamp[700],
    },

    media: {
      height: 230,
      borderRadius: radii.card,
      overflow: "hidden",
      backgroundColor: t.neutral[200],
    },
    videoText: { fontFamily: fonts.bodyBold, fontSize: 10, color: "#fff" },
    sponsored: {
      position: "absolute",
      top: 11,
      right: 11,
      backgroundColor: t.accent2Ramp[100],
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: radii.pill,
    },
    sponsoredText: {
      fontFamily: fonts.bodyBold,
      fontSize: 10,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: t.accent2Ramp[700],
    },

    caption: {
      fontFamily: fonts.body,
      fontSize: type.bodySm,
      lineHeight: 20,
      color: t.text,
    },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    metaItem: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
    metaText: {
      fontFamily: fonts.bodySemi,
      fontSize: type.micro,
      color: t.ink(58),
    },

    wall: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      paddingTop: 90,
      paddingBottom: 18,
      alignItems: "center",
      gap: 9,
    },
    wallTitle: { fontFamily: fonts.heading, fontSize: type.h4, color: t.text },
    wallBody: {
      fontFamily: fonts.body,
      fontSize: 12.5,
      lineHeight: 18,
      maxWidth: 260,
      textAlign: "center",
      color: t.ink(62),
    },
    wallDismiss: {
      fontFamily: fonts.bodySemi,
      fontSize: 12,
      color: t.ink(55),
    },

    empty: { paddingHorizontal: 20, paddingVertical: space[8], gap: 8 },
    emptyTitle: { fontFamily: fonts.heading, fontSize: type.h4, color: t.text },
    emptyBody: {
      fontFamily: fonts.body,
      fontSize: type.bodySm,
      lineHeight: 21,
      color: t.ink(62),
    },
  });
}
