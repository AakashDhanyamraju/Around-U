/**
 * Rank — design panel `2d`.
 *
 * Reached from the account screen, not a sixth tab.
 *
 * The progress line states the actual rule rather than a percentage: what moves
 * you up the ladder is *other people going to spots you found*, not spots posted
 * and not appreciations received. If the copy blurs that, people optimise for
 * the wrong thing, and the ladder stops meaning anything.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { RankProgress } from "@/src/api";
import { useAuth } from "@/src/auth";
import {
  Avatar,
  Card,
  Loading,
  Mono,
  PillButton,
  Screen,
  SectionHeading,
  StatColumn,
  TierChip,
} from "@/src/components/organic";
import {
  TIER_LABEL,
  TIER_ORDER,
  TIER_THRESHOLD,
  myRank,
  tierProgressLine,
} from "@/src/spots";
import { fonts, radii, space, type } from "@/src/theme";
import { Theme, useActiveRegion, useTheme } from "@/src/theme-context";

export default function RankScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const { user } = useAuth();
  const region = useActiveRegion();

  const [rank, setRank] = useState<RankProgress | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setRank(await myRank(region?.region_id));
  }, [user, region]);

  useEffect(() => {
    load()
      .catch(() => setRank(null))
      .finally(() => setLoading(false));
  }, [load]);

  if (!user) {
    // On web the URL is directly reachable, so this needs a real answer rather
    // than a spinner that never resolves.
    return (
      <Screen>
        <TopBar />
        <View style={s.guest}>
          <Text style={s.name}>Not signed in</Text>
          <Text style={s.body}>
            Rank is what you earn for finding places other people go to.
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

  const city = rank?.region_name ?? t.cityName;
  const credited = rank?.credited_spots ?? 0;

  return (
    <Screen>
      <TopBar />
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        testID="rank-scroll"
      >
        {loading ? (
          <Loading />
        ) : (
          <>
            <View style={s.identity}>
              <Avatar name={user.name} uri={user.picture} size={56} seed={user.user_id} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.name} numberOfLines={1}>
                  {user.name}
                </Text>
                <Mono>{city}</Mono>
              </View>
              <TierChip tier={rank?.tier} label={rank?.tier_label} size="lg" />
            </View>

            <Card>
              <Text style={s.progress}>{progressCopy(rank)}</Text>
              {rank?.next_tier ? (
                <>
                  <ProgressBar
                    value={credited}
                    target={TIER_THRESHOLD[rank.next_tier]}
                  />
                  <Mono>
                    {`${credited} of ${TIER_THRESHOLD[rank.next_tier]}`}
                  </Mono>
                </>
              ) : null}
            </Card>

            <View style={s.stats}>
              <StatColumn value={rank?.spots_found ?? 0} label="spots found" />
              <StatColumn value={rank?.people_sent ?? 0} label="people sent" />
              <StatColumn
                value={rank?.appreciations_received ?? 0}
                label="appreciations"
              />
            </View>

            <SectionHeading>The ladder</SectionHeading>
            <View style={{ gap: 8 }}>
              {TIER_ORDER.map((tier) => {
                const reached = credited >= TIER_THRESHOLD[tier];
                const current = rank?.tier === tier;
                return (
                  <View
                    key={tier}
                    style={[
                      s.rung,
                      current && { borderColor: t.accent, backgroundColor: t.accentRamp[100] },
                    ]}
                  >
                    <Ionicons
                      name={reached ? "checkmark-circle" : "ellipse-outline"}
                      size={18}
                      color={reached ? t.accent : t.ink(45)}
                    />
                    <Text style={[s.rungName, current && { color: t.accentRamp[800] }]}>
                      {TIER_LABEL[tier]}
                    </Text>
                    <Mono>
                      {TIER_THRESHOLD[tier] === 1
                        ? "1 spot"
                        : `${TIER_THRESHOLD[tier]} spots`}
                    </Mono>
                  </View>
                );
              })}
            </View>

            <Text style={s.footnote}>
              Rank is per city — yours in {city} doesn&apos;t follow you anywhere
              else. Spots you keep quiet don&apos;t count.
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** Four real cases, including the singular and the top of the ladder. */
function progressCopy(rank: RankProgress | null): string {
  if (!rank) return "Nothing to show yet.";
  if (!rank.next_tier) {
    return "You're a Keeper of the City. There's nothing above this.";
  }
  if (!rank.tier) {
    return "Add one spot someone actually visits and you're a Wanderer.";
  }
  return tierProgressLine(rank) ?? "";
}

function ProgressBar({ value, target }: { value: number; target: number }) {
  const t = useTheme();
  const pct = Math.max(0, Math.min(1, target > 0 ? value / target : 0));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: target, now: value }}
      style={{
        height: 8,
        borderRadius: radii.pill,
        backgroundColor: t.neutral[200],
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${pct * 100}%`,
          height: "100%",
          borderRadius: radii.pill,
          backgroundColor: t.accent,
        }}
      />
    </View>
  );
}

function TopBar() {
  const t = useTheme();
  const router = useRouter();
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={22} color={t.text} />
      </Pressable>
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    identity: { flexDirection: "row", alignItems: "center", gap: 12 },
    name: { fontFamily: fonts.heading, fontSize: 22, color: t.text },
    body: {
      fontFamily: fonts.body,
      fontSize: type.body,
      lineHeight: 22,
      color: t.ink(62),
    },
    guest: { paddingHorizontal: 22, paddingTop: 12, gap: 12, alignItems: "flex-start" },
    progress: {
      fontFamily: fonts.bodyBold,
      fontSize: type.h5,
      lineHeight: 23,
      color: t.text,
    },
    stats: { flexDirection: "row", gap: space[6], marginTop: space[1] },
    rung: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: t.divider,
    },
    rungName: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.bodySm, color: t.text },
    footnote: {
      fontFamily: fonts.bodySemi,
      fontSize: type.micro,
      lineHeight: 17,
      color: t.ink(55),
      marginTop: space[2],
    },
  });
}
