import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Community, CommunityMember } from "@/src/api";
import { useAuth } from "@/src/auth";
import * as communitiesApi from "@/src/communities";
import { atLeast } from "@/src/communities";
import { colors, fonts, radii, shadow, spacing } from "@/src/theme";

const ROLE_LABEL: Record<string, string> = {
  head: "Head",
  manager: "Manager",
  member: "Member",
};

export default function MembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [community, setCommunity] = useState<Community | null>(null);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [pending, setPending] = useState<CommunityMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const myRole = community?.viewer_role ?? null;
  const isManager = atLeast(myRole, "manager");
  const isHead = myRole === "head";

  const load = useCallback(async () => {
    try {
      const c = await communitiesApi.getCommunity(id);
      setCommunity(c);

      const active = await communitiesApi.listMembers(id, "active");
      setMembers(active?.members ?? []);

      // Only managers may read the pending queue; for everyone else the
      // request 403s, which is expected rather than an error to surface.
      if (atLeast(c.viewer_role ?? null, "manager")) {
        const p = await communitiesApi
          .listMembers(id, "pending")
          .catch(() => ({ members: [] }));
        setPending(p?.members ?? []);
      } else {
        setPending([]);
      }
    } catch {
      setCommunity(null);
      setMembers([]);
      setPending([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const act = async (fn: () => Promise<unknown>, failure: string) => {
    try {
      await fn();
      await load();
    } catch (e: any) {
      Alert.alert(failure, e?.message ?? "Please try again.");
    }
  };

  const onManage = (m: CommunityMember) => {
    const options: { text: string; style?: "destructive" | "cancel"; onPress?: () => void }[] = [];

    if (isHead && m.role === "member") {
      options.push({
        text: "Make manager",
        onPress: () =>
          act(
            () => communitiesApi.setMemberRole(id, m.user_id, "manager"),
            "Couldn't update role",
          ),
      });
    }
    if (isHead && m.role === "manager") {
      options.push({
        text: "Remove as manager",
        onPress: () =>
          act(
            () => communitiesApi.setMemberRole(id, m.user_id, "member"),
            "Couldn't update role",
          ),
      });
      options.push({
        text: "Transfer ownership",
        onPress: () =>
          Alert.alert(
            "Transfer ownership?",
            `${m.name ?? "This person"} becomes head and you become a manager. This cannot be undone by you.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Transfer",
                style: "destructive",
                onPress: () =>
                  act(
                    () => communitiesApi.transferOwnership(id, m.user_id),
                    "Couldn't transfer",
                  ),
              },
            ],
          ),
      });
    }
    if (isManager && m.role !== "head" && m.user_id !== user?.user_id) {
      options.push({
        text: "Mute for an hour",
        onPress: () =>
          act(() => communitiesApi.muteMember(id, m.user_id, 60), "Couldn't mute"),
      });
      options.push({
        text: "Remove from community",
        style: "destructive",
        onPress: () =>
          act(() => communitiesApi.banMember(id, m.user_id), "Couldn't remove"),
      });
    }

    if (options.length === 0) return;
    options.push({ text: "Cancel", style: "cancel" });
    Alert.alert(m.name ?? "Member", ROLE_LABEL[m.role], options);
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.topTitle}>Members</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
          />
        }
      >
        {pending.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              Requests ({pending.length})
            </Text>
            {pending.map((m) => (
              <View key={m.user_id} style={styles.row}>
                <Avatar name={m.name} />
                <Text style={styles.rowName} numberOfLines={1}>
                  {m.name ?? "Someone"}
                </Text>
                <Pressable
                  onPress={() =>
                    act(
                      () => communitiesApi.approveMember(id, m.user_id),
                      "Couldn't approve",
                    )
                  }
                  style={({ pressed }) => [
                    styles.approveBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.approveText}>Approve</Text>
                </Pressable>
              </View>
            ))}
          </>
        )}

        <Text style={styles.sectionTitle}>
          {members.length} {members.length === 1 ? "member" : "members"}
        </Text>

        {members.map((m) => {
          const manageable =
            isManager && m.role !== "head" && m.user_id !== user?.user_id;
          const promotable = isHead && m.user_id !== user?.user_id;
          return (
            <Pressable
              key={m.user_id}
              onPress={() => onManage(m)}
              disabled={!manageable && !promotable}
              style={({ pressed }) => [
                styles.row,
                pressed && (manageable || promotable) && styles.pressed,
              ]}
            >
              <Avatar name={m.name} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {m.name ?? "Someone"}
                  {m.user_id === user?.user_id ? " (you)" : ""}
                </Text>
                {!!m.muted_until && new Date(m.muted_until) > new Date() && (
                  <Text style={styles.mutedNote}>Muted</Text>
                )}
              </View>

              {m.role !== "member" && (
                <View style={styles.roleBadge}>
                  <Text style={styles.roleBadgeText}>{ROLE_LABEL[m.role]}</Text>
                </View>
              )}
              {(manageable || promotable) && (
                <Ionicons
                  name="ellipsis-horizontal"
                  size={18}
                  color={colors.textMuted}
                />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Avatar({ name }: { name?: string | null }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>
        {(name ?? "?").slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  topTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 16,
    color: colors.textPrimary,
  },
  body: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl * 2 },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadow,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.primary,
  },
  rowName: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.textPrimary,
  },
  mutedNote: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  roleBadge: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  roleBadgeText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.primaryDeep,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  approveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  approveText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.surface,
  },
  pressed: { transform: [{ scale: 0.99 }], opacity: 0.9 },
});
