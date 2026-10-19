/**
 * Creator profile — design panel `1e`.
 *
 * The case for following someone. Followers / Posts / Hoods sit together
 * because breadth of coverage is what separates a local from a tourist —
 * "Hoods" is the count of distinct neighbourhoods they've actually posted from,
 * derived from their posts rather than claimed in a bio.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, ApiError, Creator, Post } from "@/src/api";
import { useAuth } from "@/src/auth";
import {
  Avatar,
  Hatch,
  Loading,
  Mono,
  OverlayPill,
  PillButton,
  StatColumn,
  Tag,
  UnderlineTabs,
} from "@/src/components/organic";
import { ReportSheet } from "@/src/components/organic/ReportSheet";
import { useSocial } from "@/src/social";
import { fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

const TABS = ["Posts", "Map", "About"];

export default function CreatorScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { followIds, toggleFollow } = useSocial();

  const [creator, setCreator] = useState<Creator | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [tab, setTab] = useState("Posts");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api<{ creator: Creator; posts: Post[] }>(`/creators/${id}`, { auth: false })
      .then((r) => {
        setCreator(r.creator);
        setPosts((r.posts ?? []).map((p) => ({ ...p, creator: r.creator })));
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Could not load this profile."),
      )
      .finally(() => setLoading(false));
  }, [id]);

  const hoods = useMemo(() => {
    const set = new Set(
      posts.map((p) => p.neighborhood?.trim()).filter(Boolean) as string[],
    );
    return Array.from(set);
  }, [posts]);

  if (loading) {
    return (
      <View style={s.root}>
        <Loading />
      </View>
    );
  }

  if (!creator) {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <View style={{ padding: 26, gap: 12 }}>
          <Text style={s.name}>Not here</Text>
          <Text style={s.bio}>{error || "That profile has gone."}</Text>
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

  const following = followIds.has(creator.creator_id);

  return (
    <View style={s.root}>
      <ScrollView showsVerticalScrollIndicator={false} testID="creator-scroll">
        <View style={s.cover}>
          {creator.cover ? (
            <Image
              source={{ uri: creator.cover }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={180}
            />
          ) : (
            <Hatch tone="accent" style={StyleSheet.absoluteFill} />
          )}
          <SafeAreaView edges={["top"]} style={s.coverBar}>
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
              onPress={() => (user ? setReporting(true) : router.push("/login"))}
              accessibilityRole="button"
              accessibilityLabel="More options"
              style={s.overlayBtn}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color="#fff" />
            </Pressable>
          </SafeAreaView>
        </View>

        <View style={s.identity}>
          <Avatar
            name={creator.name}
            uri={creator.avatar}
            size={76}
            seed={creator.creator_id}
            ring
          />

          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.name} accessibilityRole="header">
                {creator.name}
              </Text>
              <Mono>
                {creator.handle} · {creator.city || t.cityName}
              </Mono>
            </View>
            <PillButton
              testID="follow-btn"
              label={following ? "Following" : "Follow"}
              variant={following ? "ghost" : "primary"}
              onPress={() =>
                user ? toggleFollow(creator.creator_id) : router.push("/login")
              }
            />
          </View>

          {!!creator.bio && <Text style={s.bio}>{creator.bio}</Text>}

          {creator.categories?.length > 0 && (
            <View style={s.tagRow}>
              {creator.categories.map((c, i) => (
                <Tag key={c} label={c} tone={i % 2 === 0 ? "accent" : "accent2"} />
              ))}
            </View>
          )}

          <View style={s.stats}>
            <StatColumn value={compact(creator.followers)} label="Followers" />
            <StatColumn value={posts.length} label="Posts" />
            <StatColumn value={hoods.length} label="Hoods" />
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          <UnderlineTabs tabs={TABS} value={tab} onChange={setTab} />
        </View>

        {tab === "Posts" && (
          <View style={s.grid}>
            {posts.length === 0 ? (
              <Text style={s.empty}>Nothing published yet.</Text>
            ) : (
              posts.map((p) => (
                <Pressable
                  key={p.post_id}
                  testID={`creator-post-${p.post_id}`}
                  onPress={() => router.push(`/post/${p.post_id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={p.caption}
                  style={s.gridTile}
                >
                  {p.image ? (
                    <Image
                      source={{ uri: p.image }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={180}
                    />
                  ) : (
                    <Hatch style={StyleSheet.absoluteFill} />
                  )}
                  {p.media_type === "video" && (
                    <OverlayPill style={{ position: "absolute", bottom: 8, left: 8 }}>
                      <Ionicons name="play" size={9} color="#fff" />
                    </OverlayPill>
                  )}
                </Pressable>
              ))
            )}
          </View>
        )}

        {tab === "Map" && (
          <View style={s.pane}>
            {hoods.length === 0 ? (
              <Text style={s.empty}>No places tagged yet.</Text>
            ) : (
              hoods.map((hood) => {
                const inHood = posts.filter((p) => p.neighborhood === hood);
                return (
                  <Pressable
                    key={hood}
                    onPress={() => router.push("/(tabs)/nearby")}
                    accessibilityRole="button"
                    style={s.hoodRow}
                  >
                    <Ionicons name="location" size={16} color={t.accentRamp[700]} />
                    <Text style={s.hoodName}>{hood}</Text>
                    <Mono style={{ marginLeft: "auto" }}>
                      {inHood.length} post{inHood.length === 1 ? "" : "s"}
                    </Mono>
                  </Pressable>
                );
              })
            )}
          </View>
        )}

        {tab === "About" && (
          <View style={s.pane}>
            <Text style={s.bio}>{creator.bio || "No bio yet."}</Text>
            <View style={s.aboutRow}>
              <Text style={s.aboutKey}>Covers</Text>
              <Text style={s.aboutVal}>{creator.categories?.join(", ") || "—"}</Text>
            </View>
            <View style={s.aboutRow}>
              <Text style={s.aboutKey}>Based in</Text>
              <Text style={s.aboutVal}>{creator.city || t.cityName}</Text>
            </View>
            <View style={s.aboutRow}>
              <Text style={s.aboutKey}>Neighbourhoods</Text>
              <Text style={s.aboutVal}>{hoods.join(", ") || "—"}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <ReportSheet
        visible={reporting}
        onClose={() => setReporting(false)}
        targetType="user"
        targetId={creator.creator_id}
        targetLabel={creator.name}
      />
    </View>
  );
}

/** 3200 -> "3.2k". Follower counts are display values, not arithmetic. */
function compact(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    cover: { height: 168, backgroundColor: t.neutral[200] },
    coverBar: {
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

    identity: { paddingHorizontal: 20, marginTop: -34, gap: 11 },
    name: { fontFamily: fonts.heading, fontSize: type.h3, color: t.text },
    bio: {
      fontFamily: fonts.body,
      fontSize: type.bodySm,
      lineHeight: 21,
      color: t.text,
    },
    tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    stats: { flexDirection: "row", gap: 26, paddingTop: 4, paddingBottom: 2 },

    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 9,
      padding: 20,
      paddingTop: 14,
    },
    gridTile: {
      width: "48%",
      height: 132,
      borderRadius: radii.md,
      overflow: "hidden",
      backgroundColor: t.neutral[200],
    },

    pane: { padding: 20, paddingTop: 16, gap: 12 },
    hoodRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: t.divider,
    },
    hoodName: { fontFamily: fonts.bodyBold, fontSize: type.bodySm, color: t.text },
    aboutRow: {
      flexDirection: "row",
      gap: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: t.divider,
    },
    aboutKey: {
      width: 120,
      fontFamily: fonts.bodySemi,
      fontSize: type.meta,
      color: t.ink(58),
    },
    aboutVal: {
      flex: 1,
      fontFamily: fonts.bodySemi,
      fontSize: type.meta,
      color: t.text,
    },
    empty: {
      fontFamily: fonts.body,
      fontSize: type.bodySm,
      color: t.ink(62),
      paddingVertical: space[6],
    },
  });
}
