/**
 * Inside a community — design panel `1h`.
 *
 * The pinned post sits above the stream as its own object, reactions are emoji
 * pills with live counts, and comment threads are indented in place rather than
 * hidden behind a tap-through. The composer is pinned to the bottom because
 * posting is the point of being in here.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import type { Comment, Community, CommunityPost } from "@/src/api";
import { useAuth } from "@/src/auth";
import * as communitiesApi from "@/src/communities";
import { atLeast, REACTION_EMOJI } from "@/src/communities";
import { useCommunities } from "@/src/community-context";
import {
  Avatar,
  Hatch,
  Loading,
  Mono,
  OrganicInput,
  PillButton,
} from "@/src/components/organic";
import { ReportSheet } from "@/src/components/organic/ReportSheet";
import { SignInPrompt, useSignInPrompt } from "@/src/components/SignInPrompt";
import { fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

/** Replies shown before the thread collapses behind "show more". */
const VISIBLE_REPLIES = 2;

export default function CommunityScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { standing, join, leave } = useCommunities();
  const signIn = useSignInPrompt();

  const [community, setCommunity] = useState<Community | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [posting, setPosting] = useState(false);
  const [reportTarget, setReportTarget] = useState<CommunityPost | null>(null);

  // Context is the live source of truth; the fetched row is the fallback for a
  // first render before context has loaded.
  const role = standing[id]?.role ?? community?.viewer_role ?? null;
  const memberStatus = standing[id]?.status ?? community?.viewer_status ?? null;
  const isMember = memberStatus === "active";
  const isManager = atLeast(role, "manager");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, p] = await Promise.all([
        communitiesApi.getCommunity(id),
        communitiesApi.listPosts(id).catch(() => ({ posts: [] })),
      ]);
      setCommunity(c);
      setPosts(p?.posts ?? []);
    } catch (e) {
      setCommunity(null);
      setPosts([]);
      setError(
        e instanceof Error ? e.message : "Could not load this community.",
      );
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

  const onJoin = async () => {
    if (!user) return signIn.prompt("join this community");
    try {
      const result = await join(id);
      if (result?.status === "pending") {
        Alert.alert("Request sent", "A manager will review your request to join.");
      }
      load();
    } catch (e) {
      Alert.alert(
        "Couldn't join",
        e instanceof Error ? e.message : "Please try again.",
      );
    }
  };

  const onLeave = () => {
    Alert.alert("Leave community?", "You can join again later.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: async () => {
          try {
            await leave(id);
            load();
          } catch (e) {
            Alert.alert(
              "Couldn't leave",
              e instanceof Error ? e.message : "Please try again.",
            );
          }
        },
      },
    ]);
  };

  const onPost = async () => {
    const body = composer.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      const created = await communitiesApi.createPost(id, { body });
      // Prepend rather than refetch, so the stream doesn't flash.
      setPosts((prev) => [created, ...prev]);
      setComposer("");
    } catch (e) {
      Alert.alert(
        "Couldn't post",
        e instanceof Error ? e.message : "Please try again.",
      );
    } finally {
      setPosting(false);
    }
  };

  const onReact = async (post: CommunityPost, emoji: string) => {
    if (!user) return signIn.prompt("react to posts");
    if (!isMember) return;

    const had = post.viewer_reactions?.includes(emoji);
    // Optimistic — the reaction bar has to feel instant.
    setPosts((prev) =>
      prev.map((p) =>
        p.community_post_id === post.community_post_id
          ? {
              ...p,
              viewer_reactions: had
                ? (p.viewer_reactions ?? []).filter((e) => e !== emoji)
                : [...(p.viewer_reactions ?? []), emoji],
              reaction_count: p.reaction_count + (had ? -1 : 1),
              reactions: bumpSummary(p.reactions, emoji, had ? -1 : 1),
            }
          : p,
      ),
    );

    try {
      if (had) await communitiesApi.removeReaction(post.community_post_id, emoji);
      else await communitiesApi.addReaction(post.community_post_id, emoji);
    } catch {
      load();
    }
  };

  const onDeletePost = (post: CommunityPost) => {
    Alert.alert("Delete post?", "It stops being visible. It isn't erased.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setPosts((prev) =>
            prev.filter((p) => p.community_post_id !== post.community_post_id),
          );
          try {
            await communitiesApi.deletePost(post.community_post_id);
          } catch {
            load();
          }
        },
      },
    ]);
  };

  const onPin = async (post: CommunityPost) => {
    try {
      await communitiesApi.pinPost(post.community_post_id, !post.is_pinned);
      load();
    } catch (e) {
      Alert.alert(
        "Couldn't pin",
        e instanceof Error ? e.message : "Please try again.",
      );
    }
  };

  if (loading) {
    return (
      <View style={s.root}>
        <Loading />
      </View>
    );
  }

  // A private community you're not in is indistinguishable from one that never
  // existed. That is the server's behaviour and the copy must not undo it.
  if (error || !community) {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <View style={{ padding: 26, gap: 12, alignItems: "flex-start" }}>
          <Text style={s.emptyTitle}>Not available</Text>
          <Text style={s.emptyBody}>
            {error ?? "This community is private or no longer exists."}
          </Text>
          <PillButton label="Go back" variant="ghost" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const pinned = posts.filter((p) => p.is_pinned);
  const stream = posts.filter((p) => !p.is_pinned);

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.bottom}
    >
      <View style={s.cover}>
        {community.cover ? (
          <Image
            source={{ uri: community.cover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={180}
          />
        ) : (
          <Hatch tone="accent" style={StyleSheet.absoluteFill} />
        )}
        <SafeAreaView edges={["top"]} style={s.coverBar}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={s.overlayBtn}
          >
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </Pressable>
        </SafeAreaView>
      </View>

      <View style={s.identity}>
        <Avatar
          name={community.name}
          uri={community.avatar}
          size={44}
          seed={community.community_id}
          square
          ring
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.title} numberOfLines={1}>
            {community.name}
          </Text>
          <Mono numberOfLines={1}>
            {community.member_count.toLocaleString()} member
            {community.member_count === 1 ? "" : "s"}
            {role ? ` · you're a ${role}` : ""}
          </Mono>
        </View>
        {isMember ? (
          <Pressable
            onPress={() =>
              isManager
                ? router.push(`/community/${id}/members`)
                : role !== "head"
                  ? onLeave()
                  : undefined
            }
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={isManager ? "Manage members" : "Leave community"}
          >
            <Ionicons
              name={isManager ? "settings-outline" : "ellipsis-horizontal"}
              size={20}
              color={t.ink(55)}
            />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 12, gap: 14 }}
        showsVerticalScrollIndicator={false}
        testID="community-scroll"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={t.accent}
          />
        }
      >
        {!isMember && (
          <View style={s.joinCard}>
            {!!community.description && (
              <Text style={s.joinBody}>{community.description}</Text>
            )}
            {memberStatus === "pending" ? (
              <View style={s.pending}>
                <View style={s.pendingDot} />
                <Text style={s.pendingText}>Waiting on a manager</Text>
              </View>
            ) : (
              <PillButton
                label={
                  community.join_policy === "request"
                    ? "Ask to join — a manager reviews it"
                    : community.join_policy === "invite"
                      ? "Invite only — ask a member"
                      : "Join — you're in right away"
                }
                variant={community.join_policy === "open" ? "primary" : "outline"}
                block
                disabled={community.join_policy === "invite"}
                onPress={onJoin}
              />
            )}
          </View>
        )}

        {pinned.map((post) => (
          <View key={post.community_post_id} style={s.pinnedCard}>
            <View style={s.pinnedHead}>
              <Ionicons name="pin" size={12} color={t.accentRamp[700]} />
              <Text style={s.pinnedLabel}>
                Pinned{post.author_name ? ` by ${post.author_name.split(" ")[0]}` : ""}
              </Text>
              {isManager && (
                <Pressable
                  onPress={() => onPin(post)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Unpin"
                  style={{ marginLeft: "auto" }}
                >
                  <Text style={s.unpin}>Unpin</Text>
                </Pressable>
              )}
            </View>
            <Text style={s.pinnedBody}>{post.body}</Text>
          </View>
        ))}

        {stream.length === 0 && pinned.length === 0 ? (
          <View style={{ paddingVertical: space[8], gap: 8 }}>
            <Text style={s.emptyTitle}>No posts yet</Text>
            <Text style={s.emptyBody}>
              {isMember
                ? "Start the conversation."
                : "Join to see what people are saying."}
            </Text>
          </View>
        ) : (
          stream.map((post) => (
            <PostCard
              key={post.community_post_id}
              post={post}
              isOwn={post.author_user_id === user?.user_id}
              isManager={isManager}
              canReact={isMember}
              onReact={(emoji) => onReact(post, emoji)}
              onDelete={() => onDeletePost(post)}
              onPin={() => onPin(post)}
              onReport={() =>
                user ? setReportTarget(post) : signIn.prompt("report a post")
              }
              onNeedsAuth={() => signIn.prompt("join the conversation")}
              signedIn={!!user}
            />
          ))
        )}
      </ScrollView>

      {isMember && (
        <SafeAreaView edges={["bottom"]} style={s.composerBar}>
          <OrganicInput
            value={composer}
            onChangeText={setComposer}
            placeholder={`Post to ${community.name}…`}
            multiline
            style={s.composerInput}
          />
          <Pressable
            onPress={onPost}
            disabled={!composer.trim() || posting}
            accessibilityRole="button"
            accessibilityLabel="Post"
            style={[
              s.composerBtn,
              (!composer.trim() || posting) && { opacity: 0.45 },
            ]}
          >
            <Ionicons name={posting ? "hourglass-outline" : "add"} size={20} color="#fff" />
          </Pressable>
        </SafeAreaView>
      )}

      <SignInPrompt
        visible={signIn.visible}
        action={signIn.action}
        onClose={signIn.close}
      />
      <ReportSheet
        visible={!!reportTarget}
        onClose={() => setReportTarget(null)}
        targetType="community_post"
        targetId={reportTarget?.community_post_id ?? ""}
        targetLabel="this post"
      />
    </KeyboardAvoidingView>
  );
}

function PostCard({
  post,
  isOwn,
  isManager,
  canReact,
  signedIn,
  onReact,
  onDelete,
  onPin,
  onReport,
  onNeedsAuth,
}: {
  post: CommunityPost;
  isOwn: boolean;
  isManager: boolean;
  canReact: boolean;
  signedIn: boolean;
  onReact: (emoji: string) => void;
  onDelete: () => void;
  onPin: () => void;
  onReport: () => void;
  onNeedsAuth: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  const [showPicker, setShowPicker] = useState(false);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [reply, setReply] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const openComments = async () => {
    setExpanded((v) => !v);
    if (comments) return;
    try {
      const r = await communitiesApi.listComments(post.community_post_id);
      setComments(r.comments ?? []);
    } catch {
      setComments([]);
    }
  };

  const send = async () => {
    const body = reply.trim();
    if (!body || sending) return;
    if (!signedIn) return onNeedsAuth();
    setSending(true);
    try {
      const created = await communitiesApi.addComment(
        post.community_post_id,
        body,
        replyTo ?? undefined,
      );
      setComments((prev) => [...(prev ?? []), created]);
      setReply("");
      setReplyTo(null);
    } catch (e) {
      Alert.alert(
        "Couldn't comment",
        e instanceof Error ? e.message : "Please try again.",
      );
    } finally {
      setSending(false);
    }
  };

  const summary = post.reactions ?? [];
  const roots = (comments ?? []).filter((c) => !c.parent_comment_id);
  const repliesOf = (parentId: string) =>
    (comments ?? []).filter((c) => c.parent_comment_id === parentId);
  const shownRoots = showAll ? roots : roots.slice(0, VISIBLE_REPLIES);
  const hiddenCount = roots.length - shownRoots.length;

  return (
    <View style={{ gap: 9 }}>
      <View style={s.postHead}>
        <Avatar
          name={post.author_name}
          uri={post.author_picture}
          size={32}
          seed={post.author_user_id}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.postAuthor} numberOfLines={1}>
            {post.author_name ?? "Member"}
          </Text>
          <Mono>member · {shortAgo(post.created_at)}</Mono>
        </View>
        {(isOwn || isManager) && (
          <Pressable
            onPress={() =>
              Alert.alert(post.author_name ?? "Post", undefined, [
                ...(isManager
                  ? [{ text: post.is_pinned ? "Unpin" : "Pin", onPress: onPin }]
                  : []),
                {
                  text: "Delete",
                  style: "destructive" as const,
                  onPress: onDelete,
                },
                { text: "Cancel", style: "cancel" as const },
              ])
            }
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Post options"
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={t.ink(45)} />
          </Pressable>
        )}
        {!isOwn && !isManager && (
          <Pressable
            onPress={onReport}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Report this post"
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={t.ink(45)} />
          </Pressable>
        )}
      </View>

      <Text style={s.postBody}>{post.body}</Text>

      {post.media?.length > 0 && (
        <View style={{ flexDirection: "row", gap: 7 }}>
          {post.media.slice(0, 2).map((uri) => (
            <View key={uri} style={s.postMedia}>
              <Image
                source={{ uri }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={180}
              />
            </View>
          ))}
        </View>
      )}

      <View style={s.reactionRow}>
        {summary
          .filter((r) => r.count > 0)
          .map((r) => (
            <Pressable
              key={r.emoji}
              onPress={() => (canReact ? onReact(r.emoji) : onNeedsAuth())}
              accessibilityRole="button"
              accessibilityLabel={`${r.emoji} ${r.count}`}
              accessibilityState={{ selected: r.reacted }}
              style={[s.reaction, r.reacted && s.reactionOn]}
            >
              <Text style={s.reactionText}>
                {r.emoji} {r.count}
              </Text>
            </Pressable>
          ))}
        <Pressable
          onPress={() => (canReact ? setShowPicker((v) => !v) : onNeedsAuth())}
          accessibilityRole="button"
          accessibilityLabel="Add a reaction"
          style={s.reactionAdd}
        >
          <Text style={s.reactionText}>+</Text>
        </Pressable>
        <Pressable
          onPress={openComments}
          hitSlop={8}
          accessibilityRole="button"
          style={{ marginLeft: "auto" }}
        >
          <Text style={s.commentCount}>
            {post.comment_count} comment{post.comment_count === 1 ? "" : "s"}
          </Text>
        </Pressable>
      </View>

      {showPicker && (
        <View style={s.picker}>
          {REACTION_EMOJI.map((e) => (
            <Pressable
              key={e}
              onPress={() => {
                onReact(e);
                setShowPicker(false);
              }}
              accessibilityRole="button"
              accessibilityLabel={e}
              style={s.pickerItem}
            >
              <Text style={{ fontSize: 18 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {expanded && (
        <View style={s.thread}>
          {comments === null ? (
            <Mono>Loading…</Mono>
          ) : roots.length === 0 ? (
            <Mono>No comments yet.</Mono>
          ) : (
            <>
              {shownRoots.map((c) => (
                <View key={c.comment_id} style={{ gap: 9 }}>
                  <CommentLine comment={c} onReply={() => setReplyTo(c.comment_id)} />
                  {repliesOf(c.comment_id).map((r) => (
                    <View key={r.comment_id} style={{ paddingLeft: 22 }}>
                      <CommentLine comment={r} />
                    </View>
                  ))}
                </View>
              ))}
              {hiddenCount > 0 && (
                <Pressable
                  onPress={() => setShowAll(true)}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={s.showMore}>
                    Show {hiddenCount} more {hiddenCount === 1 ? "reply" : "replies"}
                  </Text>
                </Pressable>
              )}
            </>
          )}

          {canReact && (
            <View style={s.replyRow}>
              <OrganicInput
                value={reply}
                onChangeText={setReply}
                onSubmitEditing={send}
                placeholder={replyTo ? "Write a reply…" : "Add a comment…"}
                returnKeyType="send"
                style={{ paddingVertical: 10 }}
              />
              <Pressable
                onPress={send}
                disabled={!reply.trim() || sending}
                accessibilityRole="button"
                accessibilityLabel="Send comment"
                style={[s.replySend, (!reply.trim() || sending) && { opacity: 0.45 }]}
              >
                <Ionicons name="arrow-up" size={16} color="#fff" />
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function CommentLine({
  comment,
  onReply,
}: {
  comment: Comment;
  onReply?: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const first = comment.author_name?.split(" ")[0] ?? "Member";

  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Avatar
        name={comment.author_name}
        uri={comment.author_picture}
        size={24}
        seed={comment.author_user_id}
      />
      <Pressable
        onPress={onReply}
        disabled={!onReply}
        accessibilityRole={onReply ? "button" : undefined}
        style={{ flex: 1 }}
      >
        <Text style={s.comment}>
          <Text style={s.commentName}>{first} </Text>
          {comment.body}
        </Text>
      </Pressable>
    </View>
  );
}

/** Applies an optimistic +1/-1 to the per-emoji summary the server sent. */
function bumpSummary(
  summary: CommunityPost["reactions"],
  emoji: string,
  delta: number,
): CommunityPost["reactions"] {
  const list = summary ?? [];
  const found = list.find((r) => r.emoji === emoji);
  if (!found) {
    return delta > 0 ? [...list, { emoji, count: 1, reacted: true }] : list;
  }
  return list.map((r) =>
    r.emoji === emoji
      ? { ...r, count: Math.max(0, r.count + delta), reacted: delta > 0 }
      : r,
  );
}

/** "40m ago" — the community stream uses a chattier form than the feed. */
function shortAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    cover: { height: 112, backgroundColor: t.neutral[200] },
    coverBar: { position: "absolute", left: 16, right: 16, top: 0 },
    overlayBtn: {
      width: 36,
      height: 36,
      borderRadius: radii.pill,
      backgroundColor: "rgba(32,30,29,0.6)",
      alignItems: "center",
      justifyContent: "center",
      marginTop: 8,
    },

    identity: {
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: t.divider,
    },
    title: { fontFamily: fonts.bodyBold, fontSize: type.h5 - 1, color: t.text },

    joinCard: {
      backgroundColor: t.surface,
      borderRadius: radii.card,
      padding: 15,
      gap: 11,
    },
    joinBody: {
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
    pendingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.accent2 },
    pendingText: {
      fontFamily: fonts.bodyBold,
      fontSize: type.meta,
      color: t.accent2Ramp[700],
    },

    pinnedCard: {
      backgroundColor: t.accentRamp[100],
      borderRadius: radii.card,
      padding: 14,
      gap: 8,
    },
    pinnedHead: { flexDirection: "row", alignItems: "center", gap: 7 },
    pinnedLabel: {
      fontFamily: fonts.bodyBold,
      fontSize: 10,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: t.accentRamp[700],
    },
    unpin: {
      fontFamily: fonts.bodySemi,
      fontSize: type.micro,
      color: t.accentRamp[700],
    },
    pinnedBody: {
      fontFamily: fonts.body,
      fontSize: 13.5,
      lineHeight: 20,
      color: t.text,
    },

    postHead: { flexDirection: "row", alignItems: "center", gap: 9 },
    postAuthor: { fontFamily: fonts.bodyBold, fontSize: type.meta, color: t.text },
    postBody: {
      fontFamily: fonts.body,
      fontSize: type.bodySm,
      lineHeight: 20,
      color: t.text,
    },
    postMedia: {
      flex: 1,
      height: 104,
      borderRadius: radii.md,
      overflow: "hidden",
      backgroundColor: t.neutral[200],
    },

    reactionRow: { flexDirection: "row", alignItems: "center", gap: 7 },
    reaction: {
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: radii.pill,
      backgroundColor: t.surface,
    },
    reactionOn: {
      backgroundColor: t.accentRamp[100],
      borderWidth: 1.5,
      borderColor: t.accentRamp[300],
    },
    reactionAdd: {
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: t.divider,
    },
    reactionText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.text },
    commentCount: {
      fontFamily: fonts.bodySemi,
      fontSize: type.micro,
      color: t.ink(55),
    },
    picker: {
      flexDirection: "row",
      gap: 4,
      alignSelf: "flex-start",
      backgroundColor: t.surface,
      borderRadius: radii.pill,
      padding: 6,
    },
    pickerItem: { paddingHorizontal: 6, paddingVertical: 2 },

    thread: {
      gap: 9,
      paddingLeft: 12,
      borderLeftWidth: 2,
      borderLeftColor: t.divider,
    },
    comment: {
      fontFamily: fonts.body,
      fontSize: type.meta,
      lineHeight: 18,
      color: t.text,
    },
    commentName: { fontFamily: fonts.bodyBold },
    showMore: {
      fontFamily: fonts.bodySemi,
      fontSize: type.micro,
      color: t.accentRamp[700],
      paddingLeft: 32,
    },
    replyRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2 },
    replySend: {
      width: 34,
      height: 34,
      borderRadius: radii.pill,
      backgroundColor: t.accent,
      alignItems: "center",
      justifyContent: "center",
    },

    composerBar: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 9,
      paddingHorizontal: 20,
      paddingTop: 11,
      paddingBottom: space[2],
      borderTopWidth: 1,
      borderTopColor: t.divider,
      backgroundColor: t.bg,
    },
    composerInput: { maxHeight: 96, paddingVertical: 13 },
    composerBtn: {
      width: 44,
      height: 44,
      borderRadius: radii.pill,
      backgroundColor: t.accent,
      alignItems: "center",
      justifyContent: "center",
    },

    emptyTitle: { fontFamily: fonts.heading, fontSize: type.h4, color: t.text },
    emptyBody: {
      fontFamily: fonts.body,
      fontSize: type.bodySm,
      lineHeight: 21,
      color: t.ink(62),
    },
  });
}
