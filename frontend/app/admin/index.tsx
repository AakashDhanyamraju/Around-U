import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { Post, Creator } from "@/src/api";
import { colors, fonts, radii, shadow, CATEGORIES } from "@/src/theme";
import {
  AdminStats,
  getAdminKey,
  setAdminKey as persistAdminKey,
  clearAdminKey,
  adminStats,
  adminListPosts,
  adminListCreators,
  adminDeletePost,
  adminDeleteCreator,
  adminCreatePost,
  adminCreateCreator,
  isAuthError,
} from "@/src/admin";
import { Label, Field, ChipRow, ToggleRow, PrimaryButton, StatusText } from "@/src/components/admin/Fields";

type Tab = "overview" | "posts" | "creators" | "add";
const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "overview", label: "Overview", icon: "stats-chart" },
  { key: "posts", label: "Posts", icon: "grid" },
  { key: "creators", label: "Creators", icon: "people" },
  { key: "add", label: "Add", icon: "add-circle" },
];

export default function AdminDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [keyInput, setKeyInput] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [gateError, setGateError] = useState("");

  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(
    async (key: string) => {
      const [s, p, c] = await Promise.all([adminStats(key), adminListPosts(), adminListCreators()]);
      setStats(s);
      setPosts(p);
      setCreators(c);
    },
    [],
  );

  // boot: try saved key
  useEffect(() => {
    (async () => {
      const saved = (await getAdminKey()) || "";
      if (saved) {
        try {
          await loadAll(saved);
          setAdminKey(saved);
          setKeyInput(saved);
          setUnlocked(true);
        } catch {
          // saved key invalid; stay on gate
        }
      }
      setBootLoading(false);
    })();
  }, [loadAll]);

  useFocusEffect(
    useCallback(() => {
      if (unlocked && adminKey) {
        loadAll(adminKey).catch(() => {});
      }
    }, [unlocked, adminKey, loadAll]),
  );

  const unlock = async () => {
    const k = keyInput.trim();
    if (!k) {
      setGateError("Enter your admin key.");
      return;
    }
    setUnlocking(true);
    setGateError("");
    try {
      await loadAll(k);
      await persistAdminKey(k);
      setAdminKey(k);
      setUnlocked(true);
    } catch (e: any) {
      setGateError(isAuthError(e) ? "Invalid admin key." : "Couldn't connect. Try again.");
    } finally {
      setUnlocking(false);
    }
  };

  const lock = async () => {
    await clearAdminKey();
    setUnlocked(false);
    setAdminKey("");
    setKeyInput("");
    setStats(null);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadAll(adminKey);
    } catch {
      /* ignore */
    }
    setRefreshing(false);
  };

  const confirmDeletePost = (p: Post) => {
    Alert.alert("Delete post", `Remove "${p.caption.slice(0, 40)}…"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await adminDeletePost(adminKey, p.post_id);
            await loadAll(adminKey);
          } catch (e: any) {
            Alert.alert("Failed", e.message || "Could not delete");
          }
        },
      },
    ]);
  };

  const confirmDeleteCreator = (c: Creator) => {
    Alert.alert(
      "Delete creator",
      `Remove ${c.name}? This also deletes all of their posts.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await adminDeleteCreator(adminKey, c.creator_id);
              await loadAll(adminKey);
            } catch (e: any) {
              Alert.alert("Failed", e.message || "Could not delete");
            }
          },
        },
      ],
    );
  };

  // ---------- gate ----------
  if (bootLoading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!unlocked) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Header title="Admin Dashboard" onBack={() => router.back()} />
        <View style={[styles.center, { flex: 1, paddingHorizontal: 24 }]}>
          <View style={styles.gateCard}>
            <View style={styles.lockBadge}>
              <Ionicons name="lock-closed" size={26} color={colors.primary} />
            </View>
            <Text style={styles.gateTitle}>Enter admin key</Text>
            <Text style={styles.gateSub}>
              Your key unlocks content management. It is stored securely on this device.
            </Text>
            <Field
              testID="admin-key"
              value={keyInput}
              onChangeText={setKeyInput}
              placeholder="Paste your admin secret"
              secureTextEntry
              autoCapitalize="none"
            />
            <StatusText text={gateError} />
            <View style={{ height: 18 }} />
            <PrimaryButton label="Unlock" onPress={unlock} loading={unlocking} testID="unlock-btn" />
          </View>
        </View>
      </View>
    );
  }

  // ---------- dashboard ----------
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Header
        title="Admin Dashboard"
        onBack={() => router.back()}
        right={
          <Pressable onPress={lock} hitSlop={10} style={styles.lockBtn}>
            <Ionicons name="lock-open-outline" size={20} color={colors.primaryDeep} />
          </Pressable>
        }
      />

      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable
              key={t.key}
              testID={`tab-${t.key}`}
              onPress={() => setTab(t.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Ionicons name={t.icon} size={16} color={active ? "#fff" : colors.textSecondary} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {tab === "overview" && <Overview stats={stats} />}
        {tab === "posts" && (
          <PostsList
            posts={posts}
            onEdit={(p) => router.push(`/admin/post/${p.post_id}`)}
            onDelete={confirmDeletePost}
          />
        )}
        {tab === "creators" && (
          <CreatorsList
            creators={creators}
            stats={stats}
            onEdit={(c) => router.push(`/admin/creator/${c.creator_id}`)}
            onDelete={confirmDeleteCreator}
          />
        )}
        {tab === "add" && (
          <AddForms
            adminKey={adminKey}
            creators={creators}
            onCreated={() => loadAll(adminKey)}
          />
        )}
      </ScrollView>
    </View>
  );
}

// ===================== sub-views =====================

function Header({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerRight}>{right}</View>
    </View>
  );
}

function Overview({ stats }: { stats: AdminStats | null }) {
  if (!stats) return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  const cards = [
    { label: "Posts", value: stats.total_posts, icon: "grid" as const, tint: colors.primary },
    { label: "Creators", value: stats.total_creators, icon: "people" as const, tint: "#7C5CFF" },
    { label: "Videos", value: stats.video_count, icon: "videocam" as const, tint: "#1FA2A6" },
    { label: "Sponsored", value: stats.sponsored_count, icon: "megaphone" as const, tint: "#E0A100" },
  ];
  const maxCat = Math.max(...stats.by_category.map((c) => c.count), 1);
  return (
    <View>
      <View style={styles.statGrid}>
        {cards.map((c) => (
          <View key={c.label} style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: c.tint + "22" }]}>
              <Ionicons name={c.icon} size={18} color={c.tint} />
            </View>
            <Text style={styles.statValue}>{c.value}</Text>
            <Text style={styles.statLabel}>{c.label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>By category</Text>
      <View style={styles.panel}>
        {stats.by_category.map((c) => (
          <View key={c.category} style={styles.barRow}>
            <Text style={styles.barLabel}>{c.category}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${(c.count / maxCat) * 100}%` }]} />
            </View>
            <Text style={styles.barCount}>{c.count}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>By creator</Text>
      <View style={styles.panel}>
        {stats.by_creator.map((c) => (
          <View key={c.creator_id} style={styles.creatorStatRow}>
            <Text style={styles.barLabel}>{c.name}</Text>
            <Text style={styles.barCount}>{c.count} posts</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function PostsList({
  posts,
  onEdit,
  onDelete,
}: {
  posts: Post[];
  onEdit: (p: Post) => void;
  onDelete: (p: Post) => void;
}) {
  if (posts.length === 0) return <Empty text="No posts yet." />;
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.listHint}>{posts.length} posts</Text>
      {posts.map((p) => (
        <View key={p.post_id} style={styles.row}>
          <Image source={{ uri: p.image }} style={styles.thumb} contentFit="cover" />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={2} style={styles.rowTitle}>
              {p.caption}
            </Text>
            <View style={styles.rowMeta}>
              <Text style={styles.rowMetaText}>{p.category}</Text>
              <Text style={styles.rowMetaDot}>·</Text>
              <Text style={styles.rowMetaText}>{p.creator?.name || p.creator_id}</Text>
            </View>
            <View style={styles.badgeRow}>
              {p.media_type === "video" && <Badge text="VIDEO" color="#1FA2A6" />}
              {p.is_sponsored && <Badge text="SPONSORED" color="#E0A100" />}
            </View>
          </View>
          <View style={styles.rowActions}>
            <Pressable onPress={() => onEdit(p)} hitSlop={8} style={styles.iconBtn}>
              <Ionicons name="create-outline" size={20} color={colors.primaryDeep} />
            </Pressable>
            <Pressable onPress={() => onDelete(p)} hitSlop={8} style={styles.iconBtn}>
              <Ionicons name="trash-outline" size={19} color="#D14E22" />
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

function CreatorsList({
  creators,
  stats,
  onEdit,
  onDelete,
}: {
  creators: Creator[];
  stats: AdminStats | null;
  onEdit: (c: Creator) => void;
  onDelete: (c: Creator) => void;
}) {
  if (creators.length === 0) return <Empty text="No creators yet." />;
  const countFor = (id: string) => stats?.by_creator.find((x) => x.creator_id === id)?.count ?? 0;
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.listHint}>{creators.length} creators</Text>
      {creators.map((c) => (
        <View key={c.creator_id} style={styles.row}>
          <Image source={{ uri: c.avatar }} style={styles.avatar} contentFit="cover" />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{c.name}</Text>
            <Text style={styles.rowMetaText}>{c.handle}</Text>
            <Text style={[styles.rowMetaText, { marginTop: 2 }]}>{countFor(c.creator_id)} posts</Text>
          </View>
          <View style={styles.rowActions}>
            <Pressable onPress={() => onEdit(c)} hitSlop={8} style={styles.iconBtn}>
              <Ionicons name="create-outline" size={20} color={colors.primaryDeep} />
            </Pressable>
            <Pressable onPress={() => onDelete(c)} hitSlop={8} style={styles.iconBtn}>
              <Ionicons name="trash-outline" size={19} color="#D14E22" />
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

function AddForms({
  adminKey,
  creators,
  onCreated,
}: {
  adminKey: string;
  creators: Creator[];
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<"post" | "creator">("post");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  // post fields
  const [creatorId, setCreatorId] = useState(creators[0]?.creator_id || "");
  const [image, setImage] = useState("");
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState("Food");
  const [neighborhood, setNeighborhood] = useState("");
  const [locationName, setLocationName] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [videoUrl, setVideoUrl] = useState("");
  const [sponsored, setSponsored] = useState(false);

  // creator fields
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");

  useEffect(() => {
    if (!creatorId && creators[0]) setCreatorId(creators[0].creator_id);
  }, [creators, creatorId]);

  const submitPost = async () => {
    setStatus("");
    if (!creatorId || !image || !caption || !neighborhood) {
      setStatus("Fill creator, image, caption and neighborhood.");
      return;
    }
    if (mediaType === "video" && !videoUrl) {
      setStatus("Add a video URL for video posts.");
      return;
    }
    setSaving(true);
    try {
      await adminCreatePost(adminKey, {
        creator_id: creatorId,
        image,
        caption,
        category,
        neighborhood,
        location_name: locationName || null,
        media_type: mediaType,
        video_url: mediaType === "video" ? videoUrl : null,
        is_sponsored: sponsored,
      });
      setStatus("✓ Post published.");
      setImage("");
      setCaption("");
      setNeighborhood("");
      setLocationName("");
      setVideoUrl("");
      setSponsored(false);
      setMediaType("image");
      onCreated();
    } catch (e: any) {
      setStatus(isAuthError(e) ? "Invalid admin key." : "Failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const submitCreator = async () => {
    setStatus("");
    if (!handle || !name || !avatar) {
      setStatus("Fill handle, name and avatar.");
      return;
    }
    setSaving(true);
    try {
      const c = await adminCreateCreator(adminKey, { handle, name, bio, avatar, categories: [category] });
      setStatus("✓ Creator added: " + c.name);
      setHandle("");
      setName("");
      setBio("");
      setAvatar("");
      onCreated();
    } catch (e: any) {
      setStatus(isAuthError(e) ? "Invalid admin key." : "Failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <View style={styles.modeRow}>
        <Pressable
          onPress={() => setMode("post")}
          style={[styles.modeBtn, mode === "post" && styles.modeBtnActive]}
        >
          <Text style={[styles.modeText, mode === "post" && styles.modeTextActive]}>New post</Text>
        </Pressable>
        <Pressable
          onPress={() => setMode("creator")}
          style={[styles.modeBtn, mode === "creator" && styles.modeBtnActive]}
        >
          <Text style={[styles.modeText, mode === "creator" && styles.modeTextActive]}>New creator</Text>
        </Pressable>
      </View>

      {mode === "post" ? (
        <>
          <Label>Creator</Label>
          <ChipRow
            options={creators.map((c) => ({ label: c.name, value: c.creator_id }))}
            selected={creatorId}
            onSelect={setCreatorId}
          />
          <Label>Media type</Label>
          <ChipRow
            options={[
              { label: "Image", value: "image" },
              { label: "Video", value: "video" },
            ]}
            selected={mediaType}
            onSelect={(v) => setMediaType(v as "image" | "video")}
          />
          <Label>{mediaType === "video" ? "Poster image URL" : "Image URL"}</Label>
          <Field value={image} onChangeText={setImage} placeholder="https://..." autoCapitalize="none" />
          {mediaType === "video" && (
            <>
              <Label>Video URL (mp4)</Label>
              <Field value={videoUrl} onChangeText={setVideoUrl} placeholder="https://...mp4" autoCapitalize="none" />
            </>
          )}
          <Label>Caption</Label>
          <Field value={caption} onChangeText={setCaption} placeholder="What's the story?" multiline />
          <Label>Category</Label>
          <ChipRow
            options={CATEGORIES.filter((c) => c !== "All").map((c) => ({ label: c, value: c }))}
            selected={category}
            onSelect={setCategory}
          />
          <Label>Neighborhood</Label>
          <Field value={neighborhood} onChangeText={setNeighborhood} placeholder="e.g. Montrose" />
          <Label>Location name (optional)</Label>
          <Field value={locationName} onChangeText={setLocationName} placeholder="e.g. Discovery Green" />
          <ToggleRow label="Sponsored post" value={sponsored} onValueChange={setSponsored} />
          <StatusText text={status} />
          <View style={{ height: 18 }} />
          <PrimaryButton label="Publish post" onPress={submitPost} loading={saving} testID="publish-post" />
        </>
      ) : (
        <>
          <Label>Handle</Label>
          <Field value={handle} onChangeText={setHandle} placeholder="@handle" autoCapitalize="none" />
          <Label>Name</Label>
          <Field value={name} onChangeText={setName} placeholder="Creator name" />
          <Label>Bio</Label>
          <Field value={bio} onChangeText={setBio} placeholder="Short bio" multiline />
          <Label>Avatar URL</Label>
          <Field value={avatar} onChangeText={setAvatar} placeholder="https://..." autoCapitalize="none" />
          <Label>Primary category</Label>
          <ChipRow
            options={CATEGORIES.filter((c) => c !== "All").map((c) => ({ label: c, value: c }))}
            selected={category}
            onSelect={setCategory}
          />
          <StatusText text={status} />
          <View style={{ height: 18 }} />
          <PrimaryButton label="Add creator" onPress={submitCreator} loading={saving} testID="add-creator" />
        </>
      )}
    </View>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color + "22" }]}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontFamily: fonts.display, fontSize: 18, color: colors.textPrimary },
  headerRight: { width: 40, alignItems: "flex-end" },
  lockBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },

  gateCard: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: 24,
    ...shadow,
  },
  lockBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  gateTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.textPrimary },
  gateSub: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary, marginTop: 6, marginBottom: 8, lineHeight: 20 },

  tabBar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.textSecondary },
  tabTextActive: { color: "#fff" },

  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard: {
    width: "47%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  statValue: { fontFamily: fonts.displayXL, fontSize: 28, color: colors.textPrimary },
  statLabel: { fontFamily: fonts.bodyMed, fontSize: 13, color: colors.textSecondary, marginTop: 2 },

  sectionTitle: { fontFamily: fonts.display, fontSize: 16, color: colors.textPrimary, marginTop: 26, marginBottom: 12 },
  panel: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 12 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  barLabel: { width: 92, fontFamily: fonts.bodyMed, fontSize: 13, color: colors.textPrimary },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  barCount: { width: 56, textAlign: "right", fontFamily: fonts.bodySemi, fontSize: 13, color: colors.textSecondary },
  creatorStatRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },

  listHint: { fontFamily: fonts.bodyMed, fontSize: 13, color: colors.textMuted },
  row: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  thumb: { width: 60, height: 60, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceAlt },
  rowTitle: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.textPrimary },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  rowMetaText: { fontFamily: fonts.body, fontSize: 12, color: colors.textSecondary },
  rowMetaDot: { color: colors.textMuted },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 0.5 },
  rowActions: { gap: 6 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },

  modeRow: { flexDirection: "row", gap: 10, marginBottom: 4 },
  modeBtn: { flex: 1, paddingVertical: 12, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: "center" },
  modeBtnActive: { backgroundColor: colors.primary },
  modeText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.textSecondary },
  modeTextActive: { color: "#fff" },

  emptyText: { fontFamily: fonts.body, fontSize: 15, color: colors.textMuted, marginTop: 50 },
});
