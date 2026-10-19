/**
 * Saved — design panel `1j`.
 *
 * Empty is the normal condition at launch, so the empty state does work rather
 * than apologising: it hands you three people to follow and a way back into the
 * city. Once there is something here it groups by neighbourhood, because that
 * is the shape a shortlist gets used in — you're standing somewhere.
 */
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { api, Creator, Post, Spot } from "@/src/api";
import { useAuth } from "@/src/auth";
import {
  Card,
  EmptyState,
  Hatch,
  Loading,
  Mono,
  PersonRow,
  PillButton,
  Screen,
  ScreenTitle,
  SectionHeading,
  Tag,
} from "@/src/components/organic";
import { useSocial } from "@/src/social";
import { savedSpots } from "@/src/spots";
import { fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

export default function SavedScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const { user } = useAuth();
  const { reload, followIds, toggleFollow } = useSocial();

  const [posts, setPosts] = useState<Post[]>([]);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setPosts([]);
      setSpots([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Spots and posts are saved separately — bookmarks is post-shaped and
      // live, and widening it would have meant migrating a table this feature
      // does not need to touch.
      const [r, sp] = await Promise.all([
        api<{ posts: Post[] }>("/bookmarks"),
        savedSpots().catch(() => ({ spots: [] })),
      ]);
      setPosts(r.posts ?? []);
      setSpots(sp.spots ?? []);
    } catch {
      setPosts([]);
      setSpots([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    api<Creator[]>("/creators", { auth: false })
      .then(setCreators)
      .catch(() => setCreators([]));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      reload();
    }, [load, reload]),
  );

  /** Grouped by neighbourhood — usable when you're actually out. */
  const groups = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const p of posts) {
      const key = p.neighborhood?.trim() || "Elsewhere";
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [posts]);

  const suggestions = useMemo(
    () => creators.filter((c) => !followIds.has(c.creator_id)).slice(0, 3),
    [creators, followIds],
  );

  return (
    <Screen>
      <View style={s.header}>
        <ScreenTitle>Saved</ScreenTitle>
        <Text style={s.sub}>{savedSummary(posts.length, spots.length, groups.length)}</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        testID="saved-scroll"
      >
        {loading ? (
          <Loading />
        ) : posts.length === 0 && spots.length === 0 ? (
          <View style={{ paddingHorizontal: 22 }}>
            <EmptyState
              icon="bookmark"
              title="Your shortlist starts here"
              body="Tap the bookmark on anything and it lands here — grouped by neighbourhood, so it's usable when you're actually out."
            >
              <View style={{ gap: 18 }}>
                {suggestions.length > 0 && (
                  <Card>
                    <SectionHeading>Start with three people</SectionHeading>
                    <View style={{ gap: 12, marginTop: 4 }}>
                      {suggestions.map((c) => (
                        <PersonRow
                          key={c.creator_id}
                          name={c.name}
                          sub={`${c.categories?.[0] ?? "Around You"} · ${c.city}`}
                          uri={c.avatar}
                          seed={c.creator_id}
                          size={38}
                          onPress={() => router.push(`/creator/${c.creator_id}`)}
                          action={
                            <PillButton
                              label="Follow"
                              size="sm"
                              onPress={() =>
                                user
                                  ? toggleFollow(c.creator_id)
                                  : router.push("/login")
                              }
                            />
                          }
                        />
                      ))}
                    </View>
                  </Card>
                )}
                <PillButton
                  label={`Browse ${t.cityName} instead`}
                  variant="ghost"
                  size="lg"
                  block
                  onPress={() => router.push("/(tabs)")}
                />
              </View>
            </EmptyState>
          </View>
        ) : (
          <View style={{ gap: 20, paddingTop: 6 }}>
            {/* Spots first: a shortlisted place is something you intend to go
                to, which is more actionable than a post you meant to reread. */}
            {spots.length > 0 && (
              <View style={{ gap: 10 }}>
                <View style={{ paddingHorizontal: 22 }}>
                  <SectionHeading>{`Spots · ${spots.length}`}</SectionHeading>
                </View>
                <View style={{ paddingHorizontal: 22, gap: 12 }}>
                  {spots.map((spot) => (
                    <Pressable
                      key={spot.spot_id}
                      onPress={() => router.push(`/spot/${spot.spot_id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={spot.name}
                      style={s.row}
                    >
                      <View style={s.thumb}>
                        {spot.hero_photo_url ? (
                          <Image
                            source={{ uri: spot.hero_photo_url }}
                            style={StyleSheet.absoluteFill}
                            contentFit="cover"
                            transition={180}
                          />
                        ) : (
                          <Hatch style={StyleSheet.absoluteFill} />
                        )}
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={s.rowTitle} numberOfLines={2}>
                          {spot.name}
                        </Text>
                        <Mono numberOfLines={1}>
                          {[spot.address, spot.best_time].filter(Boolean).join(" · ") ||
                            "A spot"}
                        </Mono>
                        {!!spot.category && (
                          <Tag
                            label={spot.category}
                            tone="accent2"
                            style={{ alignSelf: "flex-start" }}
                          />
                        )}
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {groups.map(([hood, list]) => (
              <View key={hood} style={{ gap: 10 }}>
                <View style={{ paddingHorizontal: 22 }}>
                  <SectionHeading>{`${hood} · ${list.length}`}</SectionHeading>
                </View>
                <View style={{ paddingHorizontal: 22, gap: 12 }}>
                  {list.map((post) => (
                    <Pressable
                      key={post.post_id}
                      onPress={() => router.push(`/post/${post.post_id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={post.caption}
                      style={s.row}
                    >
                      <View style={s.thumb}>
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
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={s.rowTitle} numberOfLines={2}>
                          {post.location_name || post.caption}
                        </Text>
                        <Mono numberOfLines={1}>
                          {post.creator?.handle ?? "Around You"}
                        </Mono>
                        <Tag
                          label={post.category}
                          tone="accent"
                          style={{ alignSelf: "flex-start" }}
                        />
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

/** "3 spots · 4 posts across 2 neighbourhoods", with every part optional. */
function savedSummary(posts: number, spots: number, hoods: number): string {
  if (posts === 0 && spots === 0) return "Nothing yet";
  const parts: string[] = [];
  if (spots > 0) parts.push(`${spots} spot${spots === 1 ? "" : "s"}`);
  if (posts > 0) {
    parts.push(
      `${posts} post${posts === 1 ? "" : "s"} across ${hoods} neighbourhood${
        hoods === 1 ? "" : "s"
      }`,
    );
  }
  return parts.join(" · ");
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    header: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 8, gap: 6 },
    sub: { fontFamily: fonts.bodySemi, fontSize: 12, color: t.ink(55) },
    row: { flexDirection: "row", alignItems: "center", gap: 11 },
    thumb: {
      width: 78,
      height: 78,
      borderRadius: radii.md,
      overflow: "hidden",
      backgroundColor: t.neutral[200],
    },
    rowTitle: {
      fontFamily: fonts.bodyBold,
      fontSize: type.bodySm,
      lineHeight: 18,
      color: t.text,
    },
    spacer: { height: space[6] },
  });
}
