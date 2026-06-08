import { api, Post, Creator } from "@/src/api";
import { storage } from "@/src/utils/storage";

const ADMIN_KEY_STORE = "around_you_admin_key";

export type AdminStats = {
  total_posts: number;
  total_creators: number;
  video_count: number;
  sponsored_count: number;
  by_category: { category: string; count: number }[];
  by_creator: { creator_id: string; name: string; count: number }[];
};

export type PostPayload = {
  creator_id: string;
  image: string;
  caption: string;
  category: string;
  neighborhood: string;
  location_name?: string | null;
  media_type?: string;
  video_url?: string | null;
  hashtags?: string[];
  is_sponsored?: boolean;
};

export type CreatorPayload = {
  handle: string;
  name: string;
  bio: string;
  avatar: string;
  categories?: string[];
};

// --- admin key (shared across the dashboard) ---
export const getAdminKey = () => storage.secureGet<string>(ADMIN_KEY_STORE, "");
export const setAdminKey = (k: string) => storage.secureSet(ADMIN_KEY_STORE, k);
export const clearAdminKey = () => storage.secureRemove(ADMIN_KEY_STORE);

// --- reads (public, no key needed) ---
export const adminListPosts = () => api<Post[]>("/posts?limit=500", { auth: false });
export const adminListCreators = () => api<Creator[]>("/creators", { auth: false });
export const adminGetPost = (id: string) =>
  api<{ post: Post; creator: Creator | null }>(`/posts/${id}`, { auth: false });
export const adminGetCreator = (id: string) =>
  api<{ creator: Creator; posts: Post[] }>(`/creators/${id}`, { auth: false });

// --- writes (require key) ---
export const adminStats = (k: string) =>
  api<AdminStats>("/admin/stats", { auth: false, adminKey: k });

export const adminCreatePost = (k: string, body: PostPayload) =>
  api<Post>("/admin/posts", { method: "POST", auth: false, adminKey: k, body });
export const adminUpdatePost = (k: string, id: string, body: Partial<PostPayload>) =>
  api<Post>(`/admin/posts/${id}`, { method: "PATCH", auth: false, adminKey: k, body });
export const adminDeletePost = (k: string, id: string) =>
  api(`/admin/posts/${id}`, { method: "DELETE", auth: false, adminKey: k });

export const adminCreateCreator = (k: string, body: CreatorPayload) =>
  api<Creator>("/admin/creators", { method: "POST", auth: false, adminKey: k, body });
export const adminUpdateCreator = (k: string, id: string, body: Partial<CreatorPayload>) =>
  api<Creator>(`/admin/creators/${id}`, { method: "PATCH", auth: false, adminKey: k, body });
export const adminDeleteCreator = (k: string, id: string) =>
  api(`/admin/creators/${id}`, { method: "DELETE", auth: false, adminKey: k });

export const isAuthError = (e: any) =>
  typeof e?.message === "string" && (e.message.includes("401") || e.message.includes("503"));
