/**
 * Spots, appreciation and rank — API calls plus the copy that describes them.
 *
 * The tier tables are duplicated from the backend deliberately. The server stays
 * authoritative for what tier someone *is*; these exist so the ladder screen can
 * show which rungs are cleared without asking five times, and so a progress line
 * can be written without a round trip.
 *
 * All the sentence-building lives here rather than in the screens, because the
 * same phrasing appears on Nearby, spot detail, the rank screen and the inbox,
 * and four copies of "1 more spots" is how an app starts to feel unfinished.
 */
import {
  AppNotification,
  AppreciationBudget,
  DuplicateCandidate,
  RankProgress,
  Spot,
  SpotCreateResult,
  SpotDetailResponse,
  SpotListResponse,
  SpotPhoto,
  SpotTier,
  api,
} from "@/src/api";

export const TIER_ORDER: readonly SpotTier[] = [
  "wanderer",
  "scout",
  "pathfinder",
  "local",
  "keeper",
];

export const TIER_THRESHOLD: Record<SpotTier, number> = {
  wanderer: 1,
  scout: 3,
  pathfinder: 8,
  local: 15,
  keeper: 40,
};

export const TIER_LABEL: Record<SpotTier, string> = {
  wanderer: "Wanderer",
  scout: "Scout",
  pathfinder: "Pathfinder",
  local: "Local",
  keeper: "Keeper of the City",
};

/** Null below the first rung — no tier at all, not a zeroth tier. */
export function tierFor(creditedSpots: number): SpotTier | null {
  let found: SpotTier | null = null;
  for (const tier of TIER_ORDER) {
    if (creditedSpots >= TIER_THRESHOLD[tier]) found = tier;
  }
  return found;
}

export function firstNameOf(name?: string | null): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "someone";
  return trimmed.split(/\s+/)[0];
}

/**
 * "68 people went because of Ana."
 *
 * Always a first name, never a pronoun: there is no gender field on an account
 * and there should not be one for this. It also collapses the design's
 * "row 4+ falls back to a first name" rule into the only rule there is.
 */
export function attributionLine(spot: Spot): string {
  const who = firstNameOf(spot.finder_name);
  const n = spot.visits_attributed_total;
  if (n === 0) return `Nobody's been yet — be the first`;
  if (n === 1) return `1 person went because of ${who}`;
  return `${n} people went because of ${who}`;
}

/**
 * When the weekly allowance comes back, in words.
 *
 * The weekday is read off `resets_at` rather than hard-coded to Monday: the
 * boundary is computed in the region's own timezone, and a sentence that is
 * merely decorative is worse than none.
 */
export function resetWording(resetsAt?: string | null): string {
  if (!resetsAt) return "soon";
  const reset = new Date(resetsAt);
  const hours = (reset.getTime() - Date.now()) / 3_600_000;
  if (hours <= 0) return "any moment";
  if (hours < 12) return "later today";
  if (hours < 24) return "tomorrow";
  return reset.toLocaleDateString(undefined, { weekday: "long" });
}

/** The line under the Appreciate button. Null means render nothing. */
export function budgetCopy(
  budget: AppreciationBudget | null | undefined,
  appreciated: boolean,
): string | null {
  // Never guess a number. No budget loaded yet means no sentence.
  if (!budget) return null;
  const when = resetWording(budget.resets_at);
  if (appreciated) {
    return budget.remaining === 1
      ? `1 left this week.`
      : `${budget.remaining} left this week.`;
  }
  if (budget.remaining === 0) {
    return `You're out until ${when} — it'll mean more then.`;
  }
  return budget.remaining === 1
    ? `1 left this week — they refill ${when}.`
    : `${budget.remaining} left this week — they refill ${when}.`;
}

/**
 * How far the finder is from their next rung.
 *
 * Phrased as a fact about them, never as a consequence of your tap —
 * appreciating does not move anyone's rank, visits do, and blurring that is
 * exactly what turns this back into likes.
 */
export function tierProgressLine(
  rank: Pick<RankProgress, "tier" | "next_tier" | "spots_to_next">,
  who = "You",
): string | null {
  if (!rank.next_tier || !rank.spots_to_next) return null;
  const label = TIER_LABEL[rank.next_tier];
  const verb = who === "You" ? "you're" : `${who} is`;
  const subject = who === "You" ? "" : `${who} needs `;
  if (who === "You") {
    return rank.spots_to_next === 1
      ? `1 more spot someone actually visits and ${verb} a ${label}.`
      : `${rank.spots_to_next} more spots someone actually visits and ${verb} a ${label}.`;
  }
  return rank.spots_to_next === 1
    ? `${subject}1 more spot someone visits to reach ${label}.`
    : `${subject}${rank.spots_to_next} more spots someone visits to reach ${label}.`;
}

/** "Still good — 6 people confirmed in the last month." */
export function freshnessLine(spot: Spot): { tone: "accent2" | "surface"; body: string } {
  const n = spot.confirmations_30d;
  if (n >= 3) {
    return {
      tone: "accent2",
      body: `Still good — ${n} people confirmed in the last month.`,
    };
  }
  if (n > 0) {
    return {
      tone: "surface",
      body: n === 1
        ? "One person confirmed this in the last month."
        : `${n} people confirmed this in the last month.`,
    };
  }
  return { tone: "surface", body: "Nobody's confirmed this in a while." };
}

export function closedLine(spot: Spot): string {
  if (!spot.status_changed_at) return "Reported closed.";
  const when = new Date(spot.status_changed_at).toLocaleDateString(undefined, {
    month: "long",
  });
  return `Reported closed in ${when}.`;
}

// ---------- reads ----------
export function listSpots(params: {
  region_id: string;
  category?: string;
  sort?: "rank" | "new" | "near";
  q?: string;
  lat?: number;
  lng?: number;
  limit?: number;
  offset?: number;
}): Promise<SpotListResponse> {
  const qs = new URLSearchParams({ region_id: params.region_id });
  if (params.category && params.category !== "All") qs.set("category", params.category);
  if (params.sort) qs.set("sort", params.sort);
  if (params.q) qs.set("q", params.q);
  if (params.lat != null) qs.set("lat", String(params.lat));
  if (params.lng != null) qs.set("lng", String(params.lng));
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  return api<SpotListResponse>(`/spots?${qs.toString()}`, { auth: false });
}

export const getSpot = (spotId: string) =>
  api<SpotDetailResponse>(`/spots/${spotId}`, { auth: false });

export const mySpots = () => api<{ spots: Spot[] }>("/spots/mine");
export const visitedSpots = () => api<{ spots: Spot[] }>("/spots/visited");
export const savedSpots = () => api<{ spots: Spot[] }>("/spots/saved");

export const listPhotos = (spotId: string) =>
  api<{ photos: SpotPhoto[] }>(`/spots/${spotId}/photos`, { auth: false });

// ---------- writes ----------
export const createSpot = (body: {
  region_id: string;
  name: string;
  blurb?: string;
  best_time?: string | null;
  category?: string | null;
  address?: string | null;
  lat: number;
  lng: number;
  is_quiet?: boolean;
  photos?: string[];
  confirm_duplicate?: boolean;
}) => api<SpotCreateResult>("/spots", { method: "POST", body });

/** True when the server offered candidates instead of creating anything. */
export function isDuplicateResult(
  r: SpotCreateResult,
): r is { created: false; duplicate: true; candidates: DuplicateCandidate[] } {
  return (r as { duplicate?: boolean }).duplicate === true;
}

export const findDuplicates = (body: {
  region_id: string;
  lat: number;
  lng: number;
  name: string;
}) =>
  api<{ candidates: DuplicateCandidate[] }>("/spots/duplicates", {
    method: "POST",
    body,
  });

export const updateSpot = (
  spotId: string,
  body: { name?: string; blurb?: string; best_time?: string },
) => api<Spot>(`/spots/${spotId}`, { method: "PATCH", body });

export const setSpotStatus = (spotId: string, status: "active" | "closed") =>
  api<{ ok: boolean }>(`/spots/${spotId}/status`, { method: "POST", body: { status } });

export const setSpotQuiet = (spotId: string, is_quiet: boolean) =>
  api<{ ok: boolean; is_quiet: boolean; quiet_unset_remaining: number }>(
    `/spots/${spotId}/quiet`,
    { method: "POST", body: { is_quiet } },
  );

export const addPhoto = (
  spotId: string,
  body: { url: string; caption?: string; width?: number; height?: number },
) => api<SpotPhoto>(`/spots/${spotId}/photos`, { method: "POST", body });

export const markVisited = (spotId: string) =>
  api<{ visits_attributed_total: number }>(`/spots/${spotId}/visit`, {
    method: "POST",
  });

export const unmarkVisited = (spotId: string) =>
  api<{ visits_attributed_total: number }>(`/spots/${spotId}/visit`, {
    method: "DELETE",
  });

export const confirmSpot = (spotId: string) =>
  api<{ confirmations_30d: number }>(`/spots/${spotId}/confirm`, { method: "POST" });

export const saveSpot = (spotId: string) =>
  api<{ ok: boolean }>(`/spots/${spotId}/save`, { method: "POST" });

export const unsaveSpot = (spotId: string) =>
  api<{ ok: boolean }>(`/spots/${spotId}/save`, { method: "DELETE" });

export const appreciateSpot = (spotId: string) =>
  api<{
    appreciation_count: number;
    appreciation_budget: AppreciationBudget;
  }>(`/spots/${spotId}/appreciate`, { method: "POST" });

export const unappreciateSpot = (spotId: string) =>
  api<{
    refunded: boolean;
    appreciation_count: number;
    appreciation_budget: AppreciationBudget;
  }>(`/spots/${spotId}/appreciate`, { method: "DELETE" });

// ---------- rank ----------
export function myRank(regionId?: string): Promise<RankProgress> {
  const qs = regionId ? `?region_id=${encodeURIComponent(regionId)}` : "";
  return api<RankProgress>(`/me/rank${qs}`);
}

export const userRank = (userId: string, regionId: string) =>
  api<RankProgress>(
    `/users/${userId}/rank?region_id=${encodeURIComponent(regionId)}`,
    { auth: false },
  );

// ---------- notifications ----------
export const listNotifications = () =>
  api<{ notifications: AppNotification[]; unread_count: number }>("/notifications");

export const unreadCount = () =>
  api<{ unread_count: number }>("/notifications/unread-count");

export const markAllRead = () =>
  api<{ unread_count: number }>("/notifications/read-all", { method: "POST" });

/** The inbox row, built here so a copy change lands everywhere at once. */
export function renderNotification(n: AppNotification): {
  icon: "heart" | "walk" | "trophy";
  body: string;
  href: string | null;
} {
  const spot = n.data.spot_name ?? "your spot";
  const actor = firstNameOf(n.data.actor_name ?? n.actor_name);
  switch (n.type) {
    case "spot_appreciated":
      return {
        icon: "heart",
        body: `${actor} appreciated ${spot}.`,
        href: n.target_id ? `/spot/${n.target_id}` : null,
      };
    case "spot_visited": {
      const count = n.data.count ?? 1;
      return {
        icon: "walk",
        body:
          count > 1
            ? `${count} people went to ${spot} because of you.`
            : `${actor} went to ${spot} because of you.`,
        href: n.target_id ? `/spot/${n.target_id}` : null,
      };
    }
    case "tier_reached":
      return {
        icon: "trophy",
        body: `You're a ${n.data.tier_label ?? "new tier"} now.`,
        href: "/spot/rank",
      };
    default:
      return { icon: "heart", body: "Something happened.", href: null };
  }
}
