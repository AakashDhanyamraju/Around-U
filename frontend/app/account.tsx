/**
 * Account — design panel `2e`.
 *
 * Reached from the avatar in the Explore header rather than a tab, because it
 * is a destination you visit rarely. Two things the design is deliberate about:
 * signing out everywhere is a plainly-worded action rather than a buried
 * security setting, and the copy is honest that leaving does not erase what you
 * wrote — the backend soft-deletes, so saying otherwise would be a lie.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { LOGOUT } from "@/constants/testIds";
import { api, RankProgress } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Avatar, PillButton, Screen } from "@/src/components/organic";
import { useSocial } from "@/src/social";
import { myRank } from "@/src/spots";
import { useSpots } from "@/src/spots-context";
import { fonts, space, type } from "@/src/theme";
import { Theme, useActiveRegion, useTheme } from "@/src/theme-context";

export default function AccountScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const { user, signOut, signOutEverywhere } = useAuth();
  const { followIds, bookmarkIds } = useSocial();
  const { budget, unread } = useSpots();
  const region = useActiveRegion();
  const [blocked, setBlocked] = useState<number | null>(null);
  const [rank, setRank] = useState<RankProgress | null>(null);

  useEffect(() => {
    if (!user) return;
    api<{ user_ids: string[] }>("/blocks")
      .then((r) => setBlocked(r.user_ids.length))
      .catch(() => setBlocked(null));
  }, [user]);

  // Not in the provider: nothing else mutates rank, so a one-shot read here is
  // simpler than another piece of shared state to keep honest.
  useEffect(() => {
    if (!user) return;
    myRank(region?.region_id)
      .then(setRank)
      .catch(() => setRank(null));
  }, [user, region]);

  const leave = useCallback(
    async (everywhere: boolean) => {
      if (everywhere) await signOutEverywhere();
      else await signOut();
      router.replace("/login");
    },
    [router, signOut, signOutEverywhere],
  );

  const joined = user?.created_at
    ? new Date(user.created_at).toLocaleString(undefined, {
        month: "short",
        year: "numeric",
      })
    : null;

  const isCreator = user?.platform_role === "creator" || !!user?.creator_id;
  const isStaff =
    user?.platform_role === "staff" || user?.platform_role === "superadmin";

  // The Explore avatar sends guests to /login, but on web the URL is reachable
  // directly. Offering "Sign out" to someone who is not signed in is nonsense,
  // so guests get the way in instead.
  if (!user) {
    return (
      <Screen>
        <View style={s.topBar}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color={t.text} />
          </Pressable>
        </View>
        <View style={s.guest}>
          <Text style={s.name} accessibilityRole="header">
            Not signed in
          </Text>
          <Text style={s.guestBody}>
            There&apos;s no account to show yet. A code makes one.
          </Text>
          <PillButton
            label="Continue with email"
            size="lg"
            onPress={() => router.replace("/login")}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={s.topBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={t.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        testID="profile-scroll"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.identity}>
          <Avatar name={user?.name} uri={user?.picture} size={56} seed={user?.user_id} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.name} accessibilityRole="header">
              {user?.name || "Guest"}
            </Text>
            <Text style={s.mono} numberOfLines={1}>
              {user?.email}
              {joined ? ` · joined ${joined}` : ""}
            </Text>
          </View>
        </View>

        <View style={s.rows}>
          <LinkRow
            testID="open-notifications-btn"
            icon="notifications-outline"
            label={unread > 0 ? `Notifications · ${unread} new` : "Notifications"}
            onPress={() => router.push("/notifications")}
          />
        </View>

        <View style={s.rows}>
          <Row label="Saved" value={bookmarkIds.size} onPress={() => router.push("/(tabs)/saved")} />
          <Row label="Following" value={followIds.size} />
          <Row
            label="Spots found"
            value={rank?.spots_found ?? "—"}
            onPress={() => router.push("/spot/rank")}
          />
          <Row
            label="Appreciations left"
            value={budget ? `${budget.remaining} of ${budget.limit}` : "—"}
          />
          <Row label="Blocked accounts" value={blocked ?? "—"} />
          <Row label="Region" value={t.cityName} />
        </View>

        {(isCreator || isStaff) && (
          <View style={s.rows}>
            {isCreator && (
              <LinkRow
                testID="open-creator-publish-btn"
                icon="camera-outline"
                label="Publish a post"
                onPress={() => router.push("/creator/publish")}
              />
            )}
            {isStaff && (
              <LinkRow
                testID="open-staff-reports-btn"
                icon="flag-outline"
                label="Reports queue"
                onPress={() => router.push("/staff/reports")}
              />
            )}
            {user?.platform_role === "superadmin" && (
              <LinkRow
                testID="open-superadmin-btn"
                icon="shield-checkmark-outline"
                label="Super admin"
                onPress={() => router.push("/superadmin")}
              />
            )}
            <LinkRow
              testID="open-admin-btn"
              icon="add-circle-outline"
              label="Submit a creator / post"
              onPress={() => router.push("/admin")}
            />
          </View>
        )}

        <View style={s.outBlock}>
          <PillButton
            testID={LOGOUT.button}
            label="Sign out"
            variant="ghost"
            size="lg"
            block
            onPress={() => leave(false)}
          />
          <PillButton
            testID="logout-everywhere-btn"
            label="Sign out everywhere"
            variant="soft"
            size="lg"
            block
            onPress={() => leave(true)}
          />
          <Text style={s.footnote}>
            Ends every session on every device, including this one. You&apos;ll need a new
            code to get back in.
          </Text>
        </View>

        <Text style={[s.footnote, { paddingHorizontal: 22, marginTop: space[6] }]}>
          Deleting your account hides what you posted — it doesn&apos;t erase it. Ask us if
          you need it gone for good.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Row({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string | number;
  onPress?: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={s.row}
    >
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </Pressable>
  );
}

function LinkRow({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" style={s.row}>
      <Ionicons name={icon} size={18} color={t.accentRamp[700]} />
      <Text style={[s.rowLabel, { flex: 1, marginLeft: 10 }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={t.ink(45)} />
    </Pressable>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    topBar: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
    identity: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 22,
      paddingTop: 8,
      paddingBottom: 18,
    },
    name: { fontFamily: fonts.heading, fontSize: 22, color: t.text },
    mono: { fontFamily: fonts.mono, fontSize: type.mono, color: t.ink(55) },
    guest: { paddingHorizontal: 22, paddingTop: 12, gap: 12, alignItems: "flex-start" },
    guestBody: {
      fontFamily: fonts.body,
      fontSize: type.body,
      lineHeight: 22,
      color: t.ink(62),
    },
    rows: { paddingHorizontal: 22, marginTop: space[2] },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: t.divider,
    },
    rowLabel: { fontFamily: fonts.bodySemi, fontSize: type.bodySm, color: t.text },
    rowValue: {
      marginLeft: "auto",
      fontFamily: fonts.mono,
      fontSize: type.micro,
      color: t.ink(55),
    },
    outBlock: { paddingHorizontal: 22, marginTop: space[6], gap: 9 },
    footnote: {
      fontFamily: fonts.bodySemi,
      fontSize: type.micro,
      lineHeight: 17,
      textAlign: "center",
      color: t.ink(55),
    },
  });
}
