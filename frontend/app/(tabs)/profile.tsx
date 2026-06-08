import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api, Creator } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useSocial } from "@/src/social";
import { colors, fonts, radii } from "@/src/theme";

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { followIds, bookmarkIds } = useSocial();
  const router = useRouter();
  const [creators, setCreators] = useState<Creator[]>([]);

  useEffect(() => {
    api<Creator[]>("/creators", { auth: false }).then(setCreators).catch(() => {});
  }, []);

  const followed = creators.filter((c) => followIds.has(c.creator_id));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} testID="profile-scroll">
        <View style={styles.header}>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" }]}>
              <Ionicons name="person" size={32} color={colors.textSecondary} />
            </View>
          )}
          <Text style={styles.name}>{user?.name || "Guest"}</Text>
          <Text style={styles.email}>{user?.email || ""}</Text>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{bookmarkIds.size}</Text>
              <Text style={styles.statLabel}>Saved</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statNum}>{followIds.size}</Text>
              <Text style={styles.statLabel}>Following</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Creators you follow</Text>
          {followed.length === 0 ? (
            <Text style={styles.emptyText}>
              No follows yet. Open a creator and tap follow to get their posts at the top of your feed.
            </Text>
          ) : (
            followed.map((c) => (
              <Pressable
                key={c.creator_id}
                testID={`follow-row-${c.creator_id}`}
                onPress={() => router.push(`/creator/${c.creator_id}`)}
                style={styles.creatorRow}
              >
                <Image source={{ uri: c.avatar }} style={styles.creatorAvatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.creatorName}>{c.name}</Text>
                  <Text style={styles.creatorHandle}>{c.handle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Pressable
            testID="open-admin-btn"
            onPress={() => router.push("/admin")}
            style={styles.linkRow}
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.textPrimary} />
            <Text style={styles.linkText}>Submit a creator / post</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          <Pressable testID="logout-btn" onPress={signOut} style={styles.linkRow}>
            <Ionicons name="log-out-outline" size={20} color={colors.primary} />
            <Text style={[styles.linkText, { color: colors.primary }]}>Sign out</Text>
            <View style={{ width: 18 }} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { alignItems: "center", paddingVertical: 24, gap: 6 },
  avatar: { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: colors.surface },
  name: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.textPrimary, marginTop: 6 },
  email: { fontFamily: fonts.sans, fontSize: 13, color: colors.textSecondary },
  statsRow: {
    marginTop: 14,
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 28,
    gap: 28,
  },
  stat: { alignItems: "center" },
  statNum: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.textPrimary },
  statLabel: { fontFamily: fonts.sansSemi, fontSize: 11, color: colors.textSecondary, letterSpacing: 1, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: colors.border },
  section: { paddingHorizontal: 20, marginTop: 14, gap: 8 },
  sectionTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.textPrimary, marginBottom: 4 },
  emptyText: { fontFamily: fonts.sans, fontSize: 13, color: colors.textSecondary, lineHeight: 20 },
  creatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  creatorAvatar: { width: 44, height: 44, borderRadius: 22 },
  creatorName: { fontFamily: fonts.sansBold, fontSize: 14, color: colors.textPrimary },
  creatorHandle: { fontFamily: fonts.sans, fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  linkText: { flex: 1, fontFamily: fonts.sansSemi, fontSize: 14, color: colors.textPrimary },
});
