/**
 * Superadmin API.
 *
 * Everything here 403s for anyone below `superadmin`, including staff. The
 * frontend hides the UI as a courtesy; the server is what actually enforces it.
 */
import {
  api,
  type Creator,
  type PlatformRole,
  type Region,
  type Community,
} from "@/src/api";

export type AdminUser = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  email_verified: boolean;
  platform_role: PlatformRole;
  creator_id?: string | null;
  home_region_id?: string | null;
  last_login_at?: string | null;
  created_at: string;
};

export type AdminCreator = Creator & {
  linked_user: { user_id: string; email: string; name: string } | null;
};

export type RoleAuditEntry = {
  audit_id: string;
  target_type: string;
  target_id: string;
  subject_id: string;
  from_role?: string | null;
  to_role: string;
  actor_id: string;
  note?: string | null;
  created_at: string;
  subject_name?: string | null;
  subject_email?: string | null;
  actor_name?: string | null;
};

export type Overview = {
  users: Record<PlatformRole | "total", number>;
  content: {
    total_posts: number;
    total_creators: number;
    video_count: number;
    sponsored_count: number;
    by_category: Record<string, number>;
    by_creator: Record<string, number>;
  };
  super_admin_emails: string[];
  integrations: { redis: boolean; email: boolean; uploads: boolean };
};

export const PLATFORM_ROLES: PlatformRole[] = [
  "user",
  "creator",
  "staff",
  "superadmin",
];

export const ROLE_BLURB: Record<PlatformRole, string> = {
  user: "Browse, follow, join communities, RSVP.",
  creator: "Publish regional posts in granted regions.",
  staff: "Platform moderation across all communities.",
  superadmin: "Everything, plus assigning roles and managing accounts.",
};

export function overview(): Promise<Overview> {
  return api("/superadmin/overview");
}

export function auditLog(limit = 100): Promise<{ entries: RoleAuditEntry[] }> {
  return api(`/superadmin/audit?limit=${limit}`);
}

export function listUsers(params: {
  q?: string;
  platformRole?: PlatformRole;
  limit?: number;
  offset?: number;
} = {}): Promise<{ users: AdminUser[]; total: number }> {
  const p = new URLSearchParams();
  if (params.q) p.set("q", params.q);
  if (params.platformRole) p.set("platform_role", params.platformRole);
  if (params.limit != null) p.set("limit", String(params.limit));
  if (params.offset != null) p.set("offset", String(params.offset));
  const qs = p.toString();
  return api(`/superadmin/users${qs ? `?${qs}` : ""}`);
}

export function getUser(userId: string): Promise<{
  user: AdminUser;
  creator: Creator | null;
  creator_regions: Region[];
  communities: Community[];
}> {
  return api(`/superadmin/users/${userId}`);
}

export function createUser(input: {
  email: string;
  name: string;
  password?: string;
  platform_role?: PlatformRole;
  email_verified?: boolean;
}): Promise<{ user: AdminUser; invited: boolean }> {
  return api("/superadmin/users", { method: "POST", body: input });
}

export function setRole(
  userId: string,
  platformRole: PlatformRole,
  note?: string,
): Promise<{ user: AdminUser; changed: boolean }> {
  return api(`/superadmin/users/${userId}/role`, {
    method: "POST",
    body: { platform_role: platformRole, note },
  });
}

export function linkCreator(
  userId: string,
  creatorId: string | null,
): Promise<{ user: AdminUser; creator: Creator | null }> {
  return api(`/superadmin/users/${userId}/creator-link`, {
    method: "POST",
    body: { creator_id: creatorId },
  });
}

export function grantRegion(
  userId: string,
  regionId: string,
): Promise<{ creator_regions: Region[] }> {
  return api(`/superadmin/users/${userId}/regions`, {
    method: "POST",
    body: { region_id: regionId },
  });
}

export function revokeRegion(
  userId: string,
  regionId: string,
): Promise<{ creator_regions: Region[] }> {
  return api(`/superadmin/users/${userId}/regions/${regionId}`, {
    method: "DELETE",
  });
}

export function verifyEmail(userId: string): Promise<{ user: AdminUser }> {
  return api(`/superadmin/users/${userId}/verify-email`, { method: "POST" });
}

export function revokeSessions(userId: string): Promise<{ ok: boolean }> {
  return api(`/superadmin/users/${userId}/revoke-sessions`, { method: "POST" });
}

export function sendResetLink(userId: string): Promise<{ ok: boolean }> {
  return api(`/superadmin/users/${userId}/reset-link`, { method: "POST" });
}

export function deleteUser(userId: string): Promise<{ ok: boolean }> {
  return api(`/superadmin/users/${userId}`, { method: "DELETE" });
}

export function listCreators(): Promise<{ creators: AdminCreator[] }> {
  return api("/superadmin/creators");
}
