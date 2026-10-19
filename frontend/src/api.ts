import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = "around_you_token";

if (!BASE) {
  console.warn(
    "EXPO_PUBLIC_BACKEND_URL is not set. Copy frontend/.env.example to " +
      "frontend/.env and restart the dev server (env vars are inlined at build time).",
  );
}

/**
 * Carries the backend's own message plus the HTTP status, so screens can show
 * something a person can act on instead of "Request failed with status 401".
 */
export class ApiError extends Error {
  status: number;
  fields?: { field: string; message: string }[];

  constructor(
    message: string,
    status: number,
    fields?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }

  get isAuthError() {
    return this.status === 401;
  }

  get isNetworkError() {
    return this.status === 0;
  }
}

async function getToken(): Promise<string | null> {
  return await storage.secureGet<string>(TOKEN_KEY, "");
}

export async function setToken(token: string) {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken() {
  await storage.secureRemove(TOKEN_KEY);
}

/**
 * FastAPI reports errors as `{ detail: "..." }`, and our validation handler adds
 * an `errors: [{ field, message }]` array. Anything else falls back to a generic
 * message rather than dumping a raw response body at the user.
 */
async function toApiError(res: Response): Promise<ApiError> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON error page (proxy timeout, HTML 502, ...).
    return new ApiError(
      res.status >= 500
        ? "Something went wrong on our end. Please try again."
        : "That request could not be completed.",
      res.status,
    );
  }

  const detail =
    typeof body?.detail === "string"
      ? body.detail
      : Array.isArray(body?.detail)
        ? body.detail[0]?.msg
        : undefined;

  return new ApiError(
    detail || "That request could not be completed.",
    res.status,
    Array.isArray(body?.errors) ? body.errors : undefined,
  );
}

export async function api<T = any>(
  path: string,
  options: {
    method?: string;
    body?: any;
    auth?: boolean;
    adminKey?: string;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (options.auth !== false) {
    const t = await getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  if (options.adminKey) headers["X-Admin-Secret"] = options.adminKey;

  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // fetch only rejects on transport failure, so this is genuinely offline or a
    // wrong host — status 0 lets the UI say so specifically.
    throw new ApiError(
      "Cannot reach the server. Check your connection and try again.",
      0,
    );
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;

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
  email_verified: boolean;
  /** Used only to decide which UI to show — every permission is enforced
   *  server-side, so never treat this as a security boundary. */
  platform_role: PlatformRole;
  creator_id?: string | null;
  home_region_id?: string | null;
  created_at: string;
};

export type Region = {
  region_id: string;
  slug: string;
  name: string;
  state?: string;
  country: string;
  timezone: string;
  center_lat?: number;
  center_lng?: number;
  is_active: boolean;
};

/** Platform-wide role. Orthogonal to CommunityRole — a person has one of these
 *  plus a separate role in each community they belong to.
 *
 *  `staff` and `superadmin` are a hierarchy: superadmin is a strict superset of
 *  staff, and is the only role that can assign roles or manage accounts. */
export type PlatformRole = "user" | "creator" | "staff" | "superadmin";
export type CommunityRole = "member" | "manager" | "head";
export type MemberStatus = "active" | "pending" | "banned";

export type Community = {
  community_id: string;
  region_id: string;
  slug: string;
  name: string;
  description: string;
  avatar?: string;
  cover?: string;
  category?: string;
  visibility: "public" | "private";
  join_policy: "open" | "request" | "invite";
  member_count: number;
  post_count: number;
  last_activity_at: string;
  archived_at?: string | null;
  created_by: string;
  created_at: string;
  /** The signed-in viewer's own standing, so the UI can pick the right CTA.
   *  Null for guests and non-members. */
  viewer_role?: CommunityRole | null;
  viewer_status?: MemberStatus | null;
};

export type CommunityMember = {
  community_id: string;
  user_id: string;
  role: CommunityRole;
  status: MemberStatus;
  muted_until?: string | null;
  joined_at?: string | null;
  created_at: string;
  name?: string;
  picture?: string;
};

export type ReactionSummary = {
  emoji: string;
  count: number;
  reacted: boolean;
};

export type CommunityPost = {
  community_post_id: string;
  community_id: string;
  author_user_id: string;
  body: string;
  media: string[];
  media_type: "none" | "image" | "video";
  is_pinned: boolean;
  comment_count: number;
  reaction_count: number;
  created_at: string;
  author_name?: string;
  author_picture?: string;
  viewer_reactions?: string[];
  reactions?: ReactionSummary[];
};

export type Comment = {
  comment_id: string;
  target_type: string;
  target_id: string;
  parent_comment_id?: string | null;
  author_user_id: string;
  body: string;
  created_at: string;
  author_name?: string;
  author_picture?: string;
};

export type ReportReason =
  | "spam"
  | "harassment"
  | "hate"
  | "violence"
  | "sexual_content"
  | "self_harm"
  | "misinformation"
  | "other";

export type AuthResult = {
  user: User;
  session_token: string;
};

export type UploadSignature = {
  cloud_name: string;
  api_key: string;
  timestamp: number;
  signature: string;
  folder: string;
  upload_url: string;
};

// ---------- spots ----------
export type SpotTier = "wanderer" | "scout" | "pathfinder" | "local" | "keeper";

export type Spot = {
  spot_id: string;
  region_id: string;
  finder_user_id: string;
  name: string;
  blurb: string;
  best_time?: string | null;
  category?: string | null;
  address?: string | null;
  lat: number;
  lng: number;
  is_quiet: boolean;
  status: "active" | "closed";
  status_changed_at?: string | null;
  created_at: string;

  finder_name?: string | null;
  finder_picture?: string | null;
  /** Null below Wanderer. That is not missing data — it means render no badge. */
  finder_tier?: SpotTier | null;
  finder_tier_label?: string | null;

  hero_photo_url?: string | null;
  photo_count: number;

  /** All-time. This is the number the "68 people went because of Ana" line uses. */
  visits_attributed_total: number;
  /** The score's first term. Not interchangeable with the total. */
  visits_attributed_90d: number;
  appreciation_count: number;
  confirmations_30d: number;
  score: number;

  /** Null for guests, so "not signed in" is distinguishable from "hasn't yet". */
  viewer_visited?: boolean | null;
  viewer_appreciated?: boolean | null;
  viewer_confirmed?: boolean | null;
  viewer_saved?: boolean | null;
  viewer_is_finder?: boolean | null;

  /** Present only on a proximity-sorted request. */
  distance_m?: number;
};

export type SpotPhoto = {
  spot_photo_id: string;
  spot_id: string;
  user_id: string;
  url: string;
  caption: string;
  width?: number | null;
  height?: number | null;
  created_at: string;
  author_name?: string | null;
  author_picture?: string | null;
};

export type AppreciationBudget = {
  limit: number;
  used: number;
  remaining: number;
  region_id: string;
  week_start: string;
  resets_at: string;
};

export type SpotListResponse = {
  spots: Spot[];
  /** Rankable spots in the whole region. Cold start reads this, never spots.length. */
  region_spot_count: number;
  cold_start: boolean;
  appreciation_budget: AppreciationBudget | null;
};

export type SpotDetailResponse = {
  spot: Spot;
  photos: SpotPhoto[];
  appreciation_budget: AppreciationBudget | null;
};

export type DuplicateCandidate = {
  spot_id: string;
  name: string;
  distance_m: number;
  similarity: number;
  finder_user_id: string;
};

export type SpotCreateResult =
  | Spot
  | { created: false; duplicate: true; candidates: DuplicateCandidate[] };

export type RankProgress = {
  region_id: string;
  region_name?: string | null;
  /** Spots you found that somebody else actually went to. This drives the tier. */
  credited_spots: number;
  spots_found: number;
  people_sent: number;
  appreciations_received: number;
  tier?: SpotTier | null;
  tier_label?: string | null;
  next_tier?: SpotTier | null;
  next_tier_label?: string | null;
  next_tier_threshold?: number | null;
  spots_to_next?: number | null;
};

export type NotificationType =
  | "spot_appreciated"
  | "spot_visited"
  | "tier_reached";

export type AppNotification = {
  notification_id: string;
  type: NotificationType;
  region_id?: string | null;
  actor_user_id?: string | null;
  actor_name?: string | null;
  actor_picture?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  /** Structured facts, not a rendered sentence — the client writes the copy. */
  data: {
    spot_name?: string;
    actor_name?: string;
    count?: number;
    tier?: SpotTier;
    tier_label?: string;
  };
  read_at?: string | null;
  created_at: string;
};
