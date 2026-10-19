/**
 * Communities — design panel `1g`.
 *
 * The button states what will happen, not what the policy is called: "you're in
 * right away" / "a manager reviews it" / "invite only". Nobody has to learn what
 * `join_policy: request` means to know whether they can walk in.
 *
 * Private communities are simply absent for non-members — there is no locked row
 * to notice. The server 404s them; the client must not invent a placeholder.
 */
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { Community, MemberStatus } from "@/src/api";
import { useAuth } from "@/src/auth";
import * as communitiesApi from "@/src/communities";
import { useCommunities } from "@/src/community-context";
import {
  Avatar,
  ChipRow,
  Loading,
  Mono,
  PillButton,
  Screen,
  ScreenTitle,
  SearchBar,
  SectionHeading,
} from "@/src/components/organic";
import { SignInPrompt, useSignInPrompt } from "@/src/components/SignInPrompt";
import { CATEGORIES, fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

export default function CommunitiesScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const { user } = useAuth();
  const { mine, standing, join, reload } = useCommunities();
  const signIn = useSignInPrompt();

  const [discover, setDiscover] = useState<Community[]>([]);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await communitiesApi.listCommunities({
        category,
        search: search.trim() || undefined,
      });
      setDiscover(res?.communities ?? []);
    } catch (e) {
      setDiscover([]);
      setError(e instanceof Error ? e.message : "Could not load communities.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [category, search]);

  useFocusEffect(
    useCallback(() => {
      load();
      reload();
    }, [load, reload]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
    reload();
  };

  const onJoin = async (community: Community) => {
    if (!user) return signIn.prompt(`join ${community.name}`);
    setJoining(community.community_id);
    try {
      await join(community.community_id);
      await load();
    } finally {
      setJoining(null);
    }
  };

  const onCreate = () => {
    if (!user) return signIn.prompt("start a community");
    router.push("/community/create");
  };

  // Already joined communities live in "Yours" — no need to repeat them below.
  const unjoined = discover.filter((c) => !standing[c.community_id]);

  return (
    <Screen>
      <View style={s.header}>
        <ScreenTitle>Communities</ScreenTitle>
        <SearchBar
          placeholder={`Search ${t.cityName} communities`}
          value={search}
          onChangeText={setSearch}
          active={search.length > 0}
        />
      </View>

      <View style={{ paddingBottom: 12 }}>
        <ChipRow items={CATEGORIES} selected={category} onSelect={setCategory} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 12 }}
        showsVerticalScrollIndicator={false}
        testID="communities-scroll"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.accent}
          />
        }
      >
        {mine.length > 0 && (
          <>
            <SectionHeading>Yours</SectionHeading>
            {mine.map((c) => (
              <CommunityCard
                key={c.community_id}
                community={c}
                viewerStatus={standing[c.community_id]?.status}
                viewerRole={standing[c.community_id]?.role}
                onOpen={() => router.push(`/community/${c.community_id}`)}
                onJoin={() => onJoin(c)}
                busy={joining === c.community_id}
              />
            ))}
            <SectionHeading>Discover more</SectionHeading>
          </>
        )}

        {loading ? (
          <Loading />
        ) : error ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>Couldn&apos;t load communities</Text>
            <Text style={s.emptyBody}>{error}</Text>
          </View>
        ) : unjoined.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>
              {search ? "No match" : "Nothing here yet"}
            </Text>
            <Text style={s.emptyBody}>
              {search
                ? `No communities in ${t.cityName} match “${search.trim()}”.`
                : "Be the first to start one in your area."}
            </Text>
          </View>
        ) : (
          unjoined.map((c) => (
            <CommunityCard
              key={c.community_id}
              community={c}
              onOpen={() => router.push(`/community/${c.community_id}`)}
              onJoin={() => onJoin(c)}
              busy={joining === c.community_id}
            />
          ))
        )}
      </ScrollView>

      <View style={s.footer}>
        <PillButton
          testID="start-community-btn"
          label="Start a community"
          variant="dark"
          size="lg"
          block
          icon="add"
          onPress={onCreate}
        />
      </View>

      <SignInPrompt
        visible={signIn.visible}
        action={signIn.action}
        onClose={signIn.close}
      />
    </Screen>
  );
}

/**
 * One card per community. The action is chosen from the join policy and the
 * viewer's standing, and it always describes the outcome.
 */
function CommunityCard({
  community,
  viewerStatus,
  viewerRole,
  onOpen,
  onJoin,
  busy,
}: {
  community: Community;
  viewerStatus?: MemberStatus;
  viewerRole?: string;
  onOpen: () => void;
  onJoin: () => void;
  busy?: boolean;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  const status = viewerStatus ?? community.viewer_status ?? undefined;
  const role = viewerRole ?? community.viewer_role ?? undefined;
  const inviteOnly = community.join_policy === "invite";

  return (
    <View style={[s.card, inviteOnly && !status && { opacity: 0.82 }]}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={community.name}
        style={s.cardHead}
      >
        <Avatar
          name={community.name}
          uri={community.avatar}
          size={46}
          seed={community.community_id}
          square
        />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.cardTitle} numberOfLines={1}>
            {community.name}
          </Text>
          <Mono numberOfLines={1}>
            {community.member_count.toLocaleString()} member
            {community.member_count === 1 ? "" : "s"} ·{" "}
            {activeAgo(community.last_activity_at)}
          </Mono>
        </View>
      </Pressable>

      {!!community.description && (
        <Text style={s.cardBody} numberOfLines={2}>
          {community.description}
        </Text>
      )}

      {status === "active" ? (
        <PillButton
          label={role && role !== "member" ? `Open — you're a ${role}` : "Open — you're a member"}
          variant="ghost"
          block
          onPress={onOpen}
        />
      ) : status === "pending" ? (
        <View style={{ gap: 7 }}>
          <View style={s.pending}>
            <View style={s.pendingDot} />
            <Text style={s.pendingText}>Waiting on a manager</Text>
          </View>
          <Text style={s.pendingNote}>
            You&apos;ll get in as soon as someone reviews it.
          </Text>
        </View>
      ) : status === "banned" ? (
        <View style={s.inviteOnly}>
          <Text style={s.inviteOnlyText}>You can&apos;t rejoin this one</Text>
        </View>
      ) : inviteOnly ? (
        <View style={s.inviteOnly}>
          <Text style={s.inviteOnlyText}>Invite only — ask a member</Text>
        </View>
      ) : community.join_policy === "request" ? (
        <PillButton
          label="Ask to join — a manager reviews it"
          variant="outline"
          block
          busy={busy}
          onPress={onJoin}
        />
      ) : (
        <PillButton
          label="Join — you're in right away"
          block
          busy={busy}
          onPress={onJoin}
        />
      )}
    </View>
  );
}

/** "active 12m ago" — the liveness signal people judge a group by. */
function activeAgo(iso?: string): string {
  if (!iso) return "quiet";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "quiet";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 2) return "active now";
  if (mins < 60) return `active ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `active ${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "active yesterday";
  if (days < 30) return `active ${days}d ago`;
  return "quiet lately";
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, gap: 11 },

    card: {
      backgroundColor: t.surface,
      borderRadius: radii.card,
      padding: 15,
      gap: 10,
    },
    cardHead: { flexDirection: "row", alignItems: "center", gap: 11 },
    cardTitle: {
      fontFamily: fonts.bodyBold,
      fontSize: type.h5 - 1,
      lineHeight: 17,
      color: t.text,
    },
    cardBody: {
      fontFamily: fonts.body,
      fontSize: type.meta,
      lineHeight: 19,
      color: t.text,
    },

    pending: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: t.accent2Ramp[100],
      paddingVertical: 13,
      borderRadius: radii.pill,
    },
    pendingDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.accent2,
    },
    pendingText: {
      fontFamily: fonts.bodyBold,
      fontSize: type.meta,
      color: t.accent2Ramp[700],
    },
    pendingNote: {
      fontFamily: fonts.bodySemi,
      fontSize: type.micro,
      textAlign: "center",
      color: t.ink(55),
    },

    inviteOnly: {
      alignItems: "center",
      paddingVertical: 13,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: t.neutral[400],
    },
    inviteOnlyText: {
      fontFamily: fonts.bodyBold,
      fontSize: type.meta,
      color: t.ink(58),
    },

    footer: {
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: space[2],
      borderTopWidth: 1,
      borderTopColor: t.divider,
    },

    empty: { paddingVertical: space[8], gap: 8 },
    emptyTitle: { fontFamily: fonts.heading, fontSize: type.h4, color: t.text },
    emptyBody: {
      fontFamily: fonts.body,
      fontSize: type.bodySm,
      lineHeight: 21,
      color: t.ink(62),
    },
  });
}
