/**
 * Explore — design panel `1c`. Where you land, signed in or not.
 *
 * The organising idea is the *beat*: a creator plus the category they own,
 * shown as a mosaic row of their work. Finding people is the point of the
 * product, so search sits at the top of the screen and the beats are the body —
 * a flat grid of posts would bury the person behind every recommendation.
 *
 * Beats are assembled client-side from /creators + /posts. That is honest at
 * current data volume; when a dedicated endpoint exists it drops in behind
 * `useBeats` without touching the layout.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
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
  Screen,
  ScreenTitle,
  SearchBar,
} from "@/src/components/organic";
import { useSocial } from "@/src/social";
import { useSpots } from "@/src/spots-context";
import { FILTER_CATEGORIES, fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

/** A creator and the posts of theirs that share one category. */
type Beat = {
  creator: Creator;
  category: string;
  posts: Post[];
};

/**
 * Groups posts by creator × category and keeps the busiest beat per creator, so
 * one person doesn't occupy four rows. Ordered by how much they've published,
 * which is the closest proxy we have for "who owns this beat".
 */
function buildBeats(creators: Creator[], posts: Post[]): Beat[] {
  const byCreator = new Map<string, Map<string, Post[]>>();

  for (const post of posts) {
    if (!post.creator_id) continue;
    const cats = byCreator.get(post.creator_id) ?? new Map<string, Post[]>();
    const list = cats.get(post.category) ?? [];
    list.push(post);
    cats.set(post.category, list);
    byCreator.set(post.creator_id, cats);
  }

  const beats: Beat[] = [];
  for (const creator of creators) {
    const cats = byCreator.get(creator.creator_id);
    if (!cats) continue;
    let best: Beat | null = null;
    for (const [category, list] of cats) {
      if (!best || list.length > best.posts.length) {
        best = { creator, category, posts: list };
      }
    }
    if (best) beats.push(best);
  }

  return beats.sort((a, b) => b.posts.length - a.posts.length);
}

export default function ExploreScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const { user } = useAuth();
  const { followIds, toggleFollow } = useSocial();
  const { unread, reloadUnread } = useSpots();

  // Explore is the landing screen, so it is the one place the dot is certain to
  // be seen. No polling — this is enough.
  useFocusEffect(
    useCallback(() => {
      reloadUnread();
    }, [reloadUnread]),
  );

  const [creators, setCreators] = useState<Creator[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([
      api<Creator[]>("/creators", { auth: false }),
      api<Post[]>("/posts", { auth: false }),
    ]);
    setCreators(c);
    setPosts(p);
  }, []);

  useEffect(() => {
    load()
      .catch(() => {
        setCreators([]);
        setPosts([]);
      })
      .finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } catch {
      // Keep whatever is on screen; a pull-to-refresh failure is not worth a
      // full-screen error when the previous data is still perfectly good.
    } finally {
      setRefreshing(false);
    }
  };

  const beats = useMemo(() => {
    const all = buildBeats(creators, posts);
    const q = query.trim().toLowerCase();
    return all.filter((b) => {
      if (category !== "All" && b.category !== category) return false;
      if (!q) return true;
      return (
        b.creator.name.toLowerCase().includes(q) ||
        b.creator.handle.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q) ||
        b.posts.some(
          (p) =>
            p.neighborhood?.toLowerCase().includes(q) ||
            p.location_name?.toLowerCase().includes(q) ||
            p.caption.toLowerCase().includes(q),
        )
      );
    });
  }, [creators, posts, category, query]);

  return (
    <Screen>
      <View style={s.header}>
        <ScreenTitle
          trailing={
            <Pressable
              onPress={() => router.push(user ? "/account" : "/login")}
              accessibilityRole="button"
              accessibilityLabel={
                user
                  ? unread > 0
                    ? `Your account, ${unread} new`
                    : "Your account"
                  : "Sign in"
              }
              hitSlop={8}
            >
              {user ? (
                <View>
                  <Avatar name={user.name} uri={user.picture} size={30} seed={user.user_id} />
                  {/* The dot rides the avatar rather than changing where it
                      goes: a control whose destination depends on invisible
                      state is unpredictable by construction. */}
                  {unread > 0 && <View style={s.unreadDot} />}
                </View>
              ) : (
                <View style={s.cityRow}>
                  <Ionicons name="location" size={12} color={t.accentRamp[700]} />
                  <Text style={s.cityText}>{t.cityName}</Text>
                </View>
              )}
            </Pressable>
          }
        >
          Explore
        </ScreenTitle>

        <SearchBar
          placeholder="Search people, places, hashtags"
          value={query}
          onChangeText={setQuery}
          active={query.length > 0}
        />
      </View>

      <View style={{ paddingBottom: 11 }}>
        <ChipRow items={FILTER_CATEGORIES} selected={category} onSelect={setCategory} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32, gap: 16 }}
        showsVerticalScrollIndicator={false}
        testID="discover-scroll"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.accent}
          />
        }
      >
        {loading ? (
          <Loading />
        ) : beats.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>
              {query ? "Nobody covering that yet" : "No beats in this category yet"}
            </Text>
            <Text style={s.emptyBody}>
              {query
                ? `Nothing in ${t.cityName} matches “${query.trim()}”. Try a neighbourhood or a dish.`
                : "As creators publish, the people who own each beat show up here."}
            </Text>
          </View>
        ) : (
          beats.map((beat) => (
            <BeatRow
              key={`${beat.creator.creator_id}-${beat.category}`}
              beat={beat}
              following={followIds.has(beat.creator.creator_id)}
              onFollow={() =>
                user
                  ? toggleFollow(beat.creator.creator_id)
                  : router.push("/login")
              }
              onOpenCreator={() => router.push(`/creator/${beat.creator.creator_id}`)}
              onOpenPost={(id) => router.push(`/post/${id}`)}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * One beat. The mosaic shape alternates by post count so the board doesn't read
 * as a uniform grid — the design uses a hero-plus-two, an even three, and a
 * two-up depending on what the creator has.
 */
function BeatRow({
  beat,
  following,
  onFollow,
  onOpenCreator,
  onOpenPost,
}: {
  beat: Beat;
  following: boolean;
  onFollow: () => void;
  onOpenCreator: () => void;
  onOpenPost: (postId: string) => void;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const shown = beat.posts.slice(0, 3);

  return (
    <View style={{ gap: 9, paddingHorizontal: 20 }}>
      <View style={s.beatHead}>
        <Pressable
          onPress={onOpenCreator}
          accessibilityRole="button"
          style={s.beatWho}
          hitSlop={6}
        >
          <Avatar
            name={beat.creator.name}
            uri={beat.creator.avatar}
            size={30}
            seed={beat.creator.creator_id}
          />
          <Text style={s.beatTitle} numberOfLines={1}>
            {beat.creator.name.split(" ")[0]} on {beat.category}
          </Text>
        </Pressable>
        <Mono>{beat.posts.length} posts</Mono>
        <Pressable
          onPress={onFollow}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            following
              ? `Unfollow ${beat.creator.name}`
              : `Follow ${beat.creator.name}`
          }
        >
          <Text style={[s.follow, following && { color: t.ink(55) }]}>
            {following ? "Following" : "Follow"}
          </Text>
        </Pressable>
      </View>

      <Mosaic posts={shown} onOpenPost={onOpenPost} />
    </View>
  );
}

/**
 * Hero-plus-stack when there are three, side by side when there are two, full
 * width when there is one. The design alternates these deliberately so the
 * board doesn't settle into a uniform grid.
 */
function Mosaic({
  posts,
  onOpenPost,
}: {
  posts: Post[];
  onOpenPost: (postId: string) => void;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  const tile = (post: Post, style?: object) => (
    <Pressable
      key={post.post_id}
      testID={`beat-tile-${post.post_id}`}
      onPress={() => onOpenPost(post.post_id)}
      accessibilityRole="button"
      accessibilityLabel={post.caption}
      style={[s.tile, style]}
    >
      <Tile post={post} />
    </Pressable>
  );

  if (posts.length >= 3) {
    return (
      <View style={s.mosaicHero}>
        {tile(posts[0], { flex: 1.6 })}
        <View style={{ flex: 1, gap: 7 }}>
          {tile(posts[1])}
          {tile(posts[2])}
        </View>
      </View>
    );
  }

  return (
    <View style={s.mosaicPair}>
      {posts.map((p, i) => tile(p, posts.length === 2 && i === 1 ? { flex: 1.6 } : undefined))}
    </View>
  );
}

function Tile({ post }: { post: Post }) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const isVideo = post.media_type === "video";

  return (
    <View style={{ flex: 1 }}>
      {post.image ? (
        <Image
          source={{ uri: post.image }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={180}
        />
      ) : (
        <Hatch style={StyleSheet.absoluteFill} />
      )}
      {isVideo ? (
        <OverlayPill style={s.tileBadge}>
          <Ionicons name="play" size={9} color="#fff" />
        </OverlayPill>
      ) : post.location_name ? (
        <View style={s.tileNote}>
          <Text style={s.tileNoteText} numberOfLines={1}>
            {post.location_name}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 11, gap: 10 },
    cityRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    unreadDot: {
      position: "absolute",
      top: -1,
      right: -1,
      width: 10,
      height: 10,
      borderRadius: radii.pill,
      backgroundColor: t.accent,
      // Ringed in the page colour so it reads against any avatar photo.
      borderWidth: 2,
      borderColor: t.bg,
    },
    cityText: {
      fontFamily: fonts.bodySemi,
      fontSize: 12,
      color: t.accentRamp[700],
    },
    beatHead: { flexDirection: "row", alignItems: "center", gap: 9 },
    beatWho: { flexDirection: "row", alignItems: "center", gap: 9, flexShrink: 1 },
    beatTitle: {
      fontFamily: fonts.bodyBold,
      fontSize: type.meta,
      color: t.text,
      flexShrink: 1,
    },
    follow: {
      marginLeft: "auto",
      fontFamily: fonts.bodyBold,
      fontSize: type.micro,
      color: t.accentRamp[700],
    },
    mosaicHero: { flexDirection: "row", gap: 7, height: 199 },
    mosaicPair: { flexDirection: "row", gap: 7, height: 110 },
    tile: {
      flex: 1,
      borderRadius: radii.md,
      overflow: "hidden",
      backgroundColor: t.neutral[200],
    },
    /** The hero tile is 1.6fr wide and spans both rows of the mosaic. */
    tileHero: { flex: 1.6 },
    tileBadge: { position: "absolute", bottom: 7, left: 7 },
    tileNote: {
      position: "absolute",
      bottom: 7,
      left: 7,
      right: 7,
      alignSelf: "flex-start",
      backgroundColor: t.bg,
      paddingHorizontal: 7,
      paddingVertical: 5,
      borderRadius: radii.pill,
    },
    tileNoteText: { fontFamily: fonts.mono, fontSize: 9, color: t.neutral[700] },
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
