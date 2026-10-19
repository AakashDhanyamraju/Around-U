/**
 * Communities API.
 *
 * Payloads are sent in snake_case, matching the backend exactly — this client
 * deliberately does no case conversion anywhere, so screens map to camelCase at
 * the call site if they want to.
 */
import {
  api,
  type Comment,
  type Community,
  type CommunityMember,
  type CommunityPost,
  type CommunityRole,
  type MemberStatus,
  type ReactionSummary,
  type Region,
  type ReportReason,
} from "@/src/api";

// ---------- regions ----------
export function listRegions(): Promise<Region[]> {
  return api<Region[]>("/regions", { auth: false });
}

// ---------- discovery ----------
export function listCommunities(params: {
  regionId?: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ communities: Community[] }> {
  const q = new URLSearchParams();
  if (params.regionId) q.set("region_id", params.regionId);
  if (params.category && params.category !== "All") q.set("category", params.category);
  if (params.search) q.set("search", params.search);
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset != null) q.set("offset", String(params.offset));

  const qs = q.toString();
  return api(`/communities${qs ? `?${qs}` : ""}`);
}

export function myCommunities(): Promise<{ communities: Community[] }> {
  return api("/communities/mine");
}

export function getCommunity(communityId: string): Promise<Community> {
  return api(`/communities/${communityId}`);
}

export function createCommunity(input: {
  region_id: string;
  name: string;
  description?: string;
  category?: string;
  visibility?: "public" | "private";
  join_policy?: "open" | "request" | "invite";
  avatar?: string;
  cover?: string;
}): Promise<Community> {
  return api("/communities", { method: "POST", body: input });
}

export function updateCommunity(
  communityId: string,
  input: Partial<{
    name: string;
    description: string;
    category: string;
    visibility: "public" | "private";
    join_policy: "open" | "request" | "invite";
    avatar: string;
    cover: string;
  }>,
): Promise<Community> {
  return api(`/communities/${communityId}`, { method: "PATCH", body: input });
}

export function deleteCommunity(communityId: string): Promise<{ ok: boolean }> {
  return api(`/communities/${communityId}`, { method: "DELETE" });
}

// ---------- membership ----------
export function joinCommunity(
  communityId: string,
): Promise<{ status: MemberStatus; role: CommunityRole }> {
  return api(`/communities/${communityId}/join`, { method: "POST" });
}

export function leaveCommunity(communityId: string): Promise<{ ok: boolean }> {
  return api(`/communities/${communityId}/leave`, { method: "POST" });
}

export function listMembers(
  communityId: string,
  memberStatus: MemberStatus = "active",
): Promise<{ members: CommunityMember[] }> {
  return api(`/communities/${communityId}/members?member_status=${memberStatus}`);
}

export function approveMember(communityId: string, userId: string) {
  return api(`/communities/${communityId}/members/${userId}/approve`, {
    method: "POST",
  });
}

export function setMemberRole(
  communityId: string,
  userId: string,
  role: "member" | "manager",
) {
  return api(`/communities/${communityId}/members/${userId}/role`, {
    method: "POST",
    body: { role },
  });
}

export function transferOwnership(communityId: string, userId: string) {
  return api(`/communities/${communityId}/members/${userId}/transfer-ownership`, {
    method: "POST",
  });
}

export function banMember(communityId: string, userId: string, reason?: string) {
  return api(`/communities/${communityId}/members/${userId}/ban`, {
    method: "POST",
    body: { reason },
  });
}

export function muteMember(
  communityId: string,
  userId: string,
  muteMinutes = 60,
) {
  return api(`/communities/${communityId}/members/${userId}/mute`, {
    method: "POST",
    body: { mute_minutes: muteMinutes },
  });
}

// ---------- posts ----------
export function listPosts(
  communityId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<{ posts: CommunityPost[] }> {
  const q = new URLSearchParams();
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset != null) q.set("offset", String(params.offset));
  const qs = q.toString();
  return api(`/communities/${communityId}/posts${qs ? `?${qs}` : ""}`);
}

export function createPost(
  communityId: string,
  input: { body: string; media?: string[]; media_type?: "none" | "image" | "video" },
): Promise<CommunityPost> {
  return api(`/communities/${communityId}/posts`, { method: "POST", body: input });
}

export function getPost(postId: string): Promise<CommunityPost> {
  return api(`/community-posts/${postId}`);
}

export function deletePost(postId: string): Promise<{ ok: boolean }> {
  return api(`/community-posts/${postId}`, { method: "DELETE" });
}

export function pinPost(postId: string, pinned: boolean): Promise<CommunityPost> {
  return api(`/community-posts/${postId}/pin?pinned=${pinned}`, { method: "POST" });
}

// ---------- comments ----------
export function listComments(postId: string): Promise<{ comments: Comment[] }> {
  return api(`/community-posts/${postId}/comments`);
}

export function addComment(
  postId: string,
  body: string,
  parentCommentId?: string,
): Promise<Comment> {
  return api(`/community-posts/${postId}/comments`, {
    method: "POST",
    body: { body, parent_comment_id: parentCommentId },
  });
}

export function deleteComment(commentId: string): Promise<{ ok: boolean }> {
  return api(`/comments/${commentId}`, { method: "DELETE" });
}

// ---------- reactions ----------
export function addReaction(
  postId: string,
  emoji: string,
): Promise<{ reactions: ReactionSummary[] }> {
  return api(`/community-posts/${postId}/reactions`, {
    method: "POST",
    body: { emoji },
  });
}

export function removeReaction(
  postId: string,
  emoji: string,
): Promise<{ reactions: ReactionSummary[] }> {
  return api(
    `/community-posts/${postId}/reactions?emoji=${encodeURIComponent(emoji)}`,
    { method: "DELETE" },
  );
}

// ---------- moderation ----------
export function reportContent(input: {
  target_type: "community_post" | "comment" | "event" | "user" | "community";
  target_id: string;
  reason: ReportReason;
  note?: string;
}) {
  return api("/reports", { method: "POST", body: input });
}

export function blockUser(userId: string) {
  return api(`/blocks/${userId}`, { method: "POST" });
}

export function unblockUser(userId: string) {
  return api(`/blocks/${userId}`, { method: "DELETE" });
}

/** The emoji set offered in the reaction bar. */
export const REACTION_EMOJI = ["🔥", "❤️", "😂", "👀", "🙌", "😮"];

/** Ordered so UI can compare ranks without duplicating the backend's logic. */
const ROLE_RANK: Record<CommunityRole, number> = {
  member: 1,
  manager: 2,
  head: 3,
};

export function atLeast(
  role: CommunityRole | null | undefined,
  min: CommunityRole,
): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
