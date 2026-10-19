/**
 * Super admin portal.
 *
 * Gated on `platform_role === "superadmin"`. That check is a courtesy so the UI
 * doesn't offer buttons that would 403 — the server enforces every action
 * independently and does not trust anything sent from here.
 */
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { PlatformRole } from "@/src/api";
import { useAuth } from "@/src/auth";
import * as sa from "@/src/superadmin";
import { PLATFORM_ROLES, ROLE_BLURB } from "@/src/superadmin";
import { colors, fonts, radii, shadow, spacing } from "@/src/theme";

type Tab = "users" | "creators" | "audit";

const ROLE_COLOR: Record<PlatformRole, string> = {
  user: colors.textMuted,
  creator: colors.accent,
  staff: colors.primary,
  superadmin: colors.primaryDeep,
};

export default function SuperAdminScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [tab, setTab] = useState<Tab>("users");
  const [overview, setOverview] = useState<sa.Overview | null>(null);
  const [users, setUsers] = useState<sa.AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [creators, setCreators] = useState<sa.AdminCreator[]>([]);
  const [audit, setAudit] = useState<sa.RoleAuditEntry[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<PlatformRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const isSuperAdmin = user?.platform_role === "superadmin";

  const load = useCallback(async () => {
    if (!isSuperAdmin) {
      setLoading(false);
      return;
    }
    try {
      const [o, u] = await Promise.all([
        sa.overview(),
        sa.listUsers({
          q: search.trim() || undefined,
          platformRole: roleFilter ?? undefined,
          limit: 100,
        }),
      ]);
      setOverview(o);
      setUsers(u?.users ?? []);
      setTotal(u?.total ?? 0);
    } catch {
      // Keep whatever was on screen; a transient failure shouldn't blank the
      // portal mid-task.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isSuperAdmin, search, roleFilter]);

  const loadTab = useCallback(
    async (next: Tab) => {
      setTab(next);
      if (next === "creators" && creators.length === 0) {
        const r = await sa.listCreators().catch(() => ({ creators: [] }));
        setCreators(r?.creators ?? []);
      }
      if (next === "audit") {
        const r = await sa.auditLog().catch(() => ({ entries: [] }));
        setAudit(r?.entries ?? []);
      }
    },
    [creators.length],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const act = async (fn: () => Promise<unknown>, failure: string) => {
    try {
      await fn();
      await load();
      if (tab === "audit") {
        const r = await sa.auditLog().catch(() => ({ entries: [] }));
        setAudit(r?.entries ?? []);
      }
    } catch (e: any) {
      Alert.alert(failure, e?.message ?? "Please try again.");
    }
  };

  const onChangeRole = (target: sa.AdminUser) => {
    const isBootstrap = overview?.super_admin_emails.includes(
      target.email.toLowerCase(),
    );
    const options = PLATFORM_ROLES.filter((r) => r !== target.platform_role).map(
      (role) => ({
        text: `${role} — ${ROLE_BLURB[role]}`,
        onPress: () =>
          act(() => sa.setRole(target.user_id, role), "Couldn't change role"),
      }),
    );

    Alert.alert(
      target.name,
      isBootstrap
        ? `${target.email}\n\nThis address is configured as a superadmin in SUPER_ADMIN_EMAILS, so demoting it won't stick — it's restored on next sign-in.`
        : `${target.email}\n\nCurrently: ${target.platform_role}`,
      [...options, { text: "Cancel", style: "cancel" }],
    );
  };

  const onManage = (target: sa.AdminUser) => {
    const isSelf = target.user_id === user?.user_id;
    const options: {
      text: string;
      style?: "destructive" | "cancel";
      onPress?: () => void;
    }[] = [
      { text: "Change role", onPress: () => onChangeRole(target) },
      {
        text: "Link creator profile",
        onPress: () => onLinkCreator(target),
      },
    ];

    if (!target.email_verified) {
      options.push({
        text: "Mark email verified",
        onPress: () =>
          act(() => sa.verifyEmail(target.user_id), "Couldn't verify"),
      });
    }
    options.push({
      text: "Send password reset link",
      onPress: () =>
        act(() => sa.sendResetLink(target.user_id), "Couldn't send link"),
    });
    if (!isSelf) {
      options.push({
        text: "Revoke all sessions",
        onPress: () =>
          act(() => sa.revokeSessions(target.user_id), "Couldn't revoke"),
      });
      options.push({
        text: "Delete account",
        style: "destructive",
        onPress: () =>
          Alert.alert("Delete account?", `${target.email} will lose access.`, [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: () =>
                act(() => sa.deleteUser(target.user_id), "Couldn't delete"),
            },
          ]),
      });
    }
    options.push({ text: "Cancel", style: "cancel" });

    Alert.alert(target.name, target.email, options);
  };

  const onLinkCreator = async (target: sa.AdminUser) => {
    const list =
      creators.length > 0
        ? creators
        : (await sa.listCreators().catch(() => ({ creators: [] }))).creators ?? [];
    setCreators(list);

    const unlinked = list.filter(
      (c) => !c.linked_user || c.linked_user.user_id === target.user_id,
    );
    if (unlinked.length === 0) {
      Alert.alert(
        "No profiles available",
        "Every creator profile is already linked to another account.",
      );
      return;
    }

    const options: {
      text: string;
      style?: "destructive" | "cancel";
      onPress?: () => void;
    }[] = unlinked.slice(0, 8).map((c) => ({
      text: `${c.handle}${c.linked_user ? " (current)" : ""}`,
      onPress: () =>
        act(
          () => sa.linkCreator(target.user_id, c.creator_id),
          "Couldn't link profile",
        ),
    }));

    if (target.creator_id) {
      options.push({
        text: "Unlink current profile",
        style: "destructive",
        onPress: () =>
          act(() => sa.linkCreator(target.user_id, null), "Couldn't unlink"),
      });
    }
    options.push({ text: "Cancel", style: "cancel" });

    Alert.alert("Link creator profile", target.email, options);
  };

  // ---------- gate ----------
  if (!isSuperAdmin) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
        <Ionicons name="shield-outline" size={34} color={colors.primarySoft} />
        <Text style={styles.emptyTitle}>Not available</Text>
        <Text style={styles.emptyBody}>
          This area is limited to super admins.
        </Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: spacing.md }}>
          <Text style={styles.link}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle}>Super admin</Text>
          <Text style={styles.topSub}>{user?.email}</Text>
        </View>
        <Pressable
          onPress={() => setShowCreate((v) => !v)}
          style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
          hitSlop={6}
        >
          <Ionicons
            name={showCreate ? "close" : "person-add"}
            size={18}
            color={colors.surface}
          />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
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
        {showCreate && (
          <CreateUserForm
            onDone={() => {
              setShowCreate(false);
              load();
            }}
          />
        )}

        {overview && (
          <>
            <View style={styles.statRow}>
              {PLATFORM_ROLES.map((role) => (
                <Pressable
                  key={role}
                  onPress={() =>
                    setRoleFilter(roleFilter === role ? null : role)
                  }
                  style={[
                    styles.stat,
                    roleFilter === role && styles.statActive,
                  ]}
                >
                  <Text style={[styles.statNum, { color: ROLE_COLOR[role] }]}>
                    {overview.users[role] ?? 0}
                  </Text>
                  <Text style={styles.statLabel}>{role}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.healthRow}>
              <Health label="Redis" ok={overview.integrations.redis} />
              <Health label="Email" ok={overview.integrations.email} />
              <Health label="Uploads" ok={overview.integrations.uploads} />
            </View>
          </>
        )}

        <View style={styles.tabRow}>
          {(["users", "creators", "audit"] as Tab[]).map((t) => (
            <Pressable
              key={t}
              onPress={() => loadTab(t)}
              style={[styles.tab, tab === t && styles.tabOn]}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
                {t}
              </Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator
            color={colors.primary}
            style={{ marginTop: spacing.xxl }}
          />
        ) : tab === "users" ? (
          <>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={15} color={colors.textMuted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                onSubmitEditing={load}
                returnKeyType="search"
                placeholder="Search name or email"
                placeholderTextColor={colors.textMuted}
                style={styles.searchInput}
                autoCapitalize="none"
              />
              {(search.length > 0 || roleFilter) && (
                <Pressable
                  onPress={() => {
                    setSearch("");
                    setRoleFilter(null);
                  }}
                  hitSlop={8}
                >
                  <Ionicons name="close-circle" size={15} color={colors.textMuted} />
                </Pressable>
              )}
            </View>

            <Text style={styles.countLine}>
              {total} {total === 1 ? "account" : "accounts"}
              {roleFilter ? ` · ${roleFilter}` : ""}
            </Text>

            {users.map((u) => (
              <Pressable
                key={u.user_id}
                onPress={() => onManage(u)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {u.name.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {u.name}
                    {u.user_id === user?.user_id ? " (you)" : ""}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {u.email}
                  </Text>
                  <View style={styles.badgeRow}>
                    {!u.email_verified && (
                      <Text style={styles.warnBadge}>unverified</Text>
                    )}
                    {!!u.creator_id && (
                      <Text style={styles.infoBadge}>{u.creator_id}</Text>
                    )}
                  </View>
                </View>
                <View
                  style={[
                    styles.roleBadge,
                    { backgroundColor: `${ROLE_COLOR[u.platform_role]}1A` },
                  ]}
                >
                  <Text
                    style={[
                      styles.roleBadgeText,
                      { color: ROLE_COLOR[u.platform_role] },
                    ]}
                  >
                    {u.platform_role}
                  </Text>
                </View>
              </Pressable>
            ))}
          </>
        ) : tab === "creators" ? (
          creators.map((c) => (
            <View key={c.creator_id} style={styles.row}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {c.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{c.handle}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {c.linked_user
                    ? `linked to ${c.linked_user.email}`
                    : "not linked to any account"}
                </Text>
              </View>
              {!c.linked_user && (
                <Ionicons
                  name="unlink-outline"
                  size={16}
                  color={colors.textMuted}
                />
              )}
            </View>
          ))
        ) : audit.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={28} color={colors.primarySoft} />
            <Text style={styles.emptyBody}>No role changes recorded yet.</Text>
          </View>
        ) : (
          audit.map((e) => (
            <View key={e.audit_id} style={styles.auditRow}>
              <Text style={styles.auditMain}>
                {e.subject_name ?? e.subject_id}
                <Text style={styles.auditDim}>
                  {"  "}
                  {e.from_role ?? "—"} → {e.to_role}
                </Text>
              </Text>
              <Text style={styles.auditSub}>
                by {e.actor_name ?? e.actor_id} ·{" "}
                {new Date(e.created_at).toLocaleString()}
              </Text>
              {!!e.note && <Text style={styles.auditNote}>{e.note}</Text>}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function Health({ label, ok }: { label: string; ok: boolean }) {
  return (
    <View style={styles.health}>
      <View
        style={[
          styles.healthDot,
          { backgroundColor: ok ? colors.success : colors.textMuted },
        ]}
      />
      <Text style={styles.healthLabel}>{label}</Text>
    </View>
  );
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<PlatformRole>("user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await sa.createUser({
        email: email.trim(),
        name: name.trim(),
        password: password.trim() || undefined,
        platform_role: role,
      });
      Alert.alert(
        res.invited ? "Invite sent" : "Account created",
        res.invited
          ? "They'll get an email to set their own password."
          : "They can sign in with the password you set.",
      );
      setEmail("");
      setName("");
      setPassword("");
      setRole("user");
      onDone();
    } catch (e: any) {
      setError(e?.message ?? "Could not create the account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.formTitle}>Add a user</Text>

      {!!error && <Text style={styles.formError}>{error}</Text>}

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Name"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password (leave blank to send an invite)"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        autoCapitalize="none"
        secureTextEntry
      />

      <View style={styles.chipWrap}>
        {PLATFORM_ROLES.map((r) => (
          <Pressable
            key={r}
            onPress={() => setRole(r)}
            style={[styles.chip, role === r && styles.chipOn]}
          >
            <Text style={[styles.chipText, role === r && styles.chipTextOn]}>
              {r}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.formHint}>{ROLE_BLURB[role]}</Text>

      <Pressable
        onPress={submit}
        disabled={!email.trim() || !name.trim() || busy}
        style={({ pressed }) => [
          styles.formBtn,
          (!email.trim() || !name.trim() || busy) && styles.formBtnOff,
          pressed && styles.pressed,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={colors.surface} size="small" />
        ) : (
          <Text style={styles.formBtnText}>Create account</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center", gap: spacing.sm },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  topTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.textPrimary,
  },
  topSub: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl * 2 },
  statRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  statActive: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  statNum: { fontFamily: fonts.displayXL, fontSize: 20 },
  statLabel: {
    fontFamily: fonts.bodyMed,
    fontSize: 9,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 2,
  },
  healthRow: {
    flexDirection: "row",
    gap: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  health: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  healthDot: { width: 7, height: 7, borderRadius: radii.pill },
  healthLabel: {
    fontFamily: fonts.bodyMed,
    fontSize: 11,
    color: colors.textSecondary,
  },
  tabRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  tab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabOn: { backgroundColor: colors.primaryDeep, borderColor: colors.primaryDeep },
  tabText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.textSecondary,
    textTransform: "capitalize",
  },
  tabTextOn: { color: colors.surface },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textPrimary,
  },
  countLine: {
    fontFamily: fonts.bodyMed,
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
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
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.primary,
  },
  rowName: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.textPrimary,
  },
  rowSub: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted },
  badgeRow: { flexDirection: "row", gap: spacing.xs, marginTop: 3 },
  warnBadge: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    color: colors.primaryDeep,
    backgroundColor: "#FDECE7",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.pill,
    overflow: "hidden",
  },
  infoBadge: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: colors.textMuted,
  },
  roleBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  roleBadgeText: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  auditRow: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.primarySoft,
  },
  auditMain: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.textPrimary,
  },
  auditDim: { fontFamily: fonts.body, fontSize: 12, color: colors.textSecondary },
  auditSub: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  auditNote: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 3,
    fontStyle: "italic",
  },
  form: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.sm,
    ...shadow,
  },
  formTitle: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textPrimary,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.textSecondary,
  },
  chipTextOn: { color: colors.surface },
  formHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.textMuted,
  },
  formError: {
    fontFamily: fonts.bodyMed,
    fontSize: 12,
    color: colors.primaryDeep,
  },
  formBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  formBtnOff: { backgroundColor: colors.primarySoft },
  formBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.surface,
  },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.textPrimary,
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  link: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  pressed: { transform: [{ scale: 0.99 }], opacity: 0.9 },
});
