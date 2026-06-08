import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = "around_you_token";

async function getToken(): Promise<string | null> {
  return await storage.secureGet<string>(TOKEN_KEY, "");
}

export async function setToken(token: string) {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken() {
  await storage.secureRemove(TOKEN_KEY);
}

export async function api<T = any>(
  path: string,
  options: { method?: string; body?: any; auth?: boolean; adminKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.auth !== false) {
    const t = await getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  if (options.adminKey) headers["X-Admin-Secret"] = options.adminKey;
  const res = await fetch(`${BASE}/api${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export type Creator = {
  creator_id: string;
  handle: string;
  name: string;
  bio: string;
  avatar: string;
  cover?: string;
  city: string;
  categories: string[];
  followers: number;
};

export type Post = {
  post_id: string;
  creator_id: string;
  image: string;
  caption: string;
  category: string;
  neighborhood: string;
  location_name?: string;
  lat?: number;
  lng?: number;
  likes: number;
  media_type?: "image" | "video";
  video_url?: string;
  hashtags?: string[];
  source?: string;
  original_url?: string;
  is_sponsored?: boolean;
  created_at: string;
  creator?: Creator;
};

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
};
