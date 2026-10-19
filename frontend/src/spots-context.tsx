/**
 * The two pieces of spot state that outlive a single screen.
 *
 * Deliberately thin. It holds the appreciation budget (spent on spot detail,
 * read on the account screen) and the unread notification count (written by the
 * inbox, read by the Explore header) — two things that genuinely cross screens.
 *
 * It holds NO per-spot server state. `viewer_appreciated` arrives fresh on every
 * fetch, and a parallel Set populated at some other moment would disagree with
 * it. What lives here instead are two *action overlays*, read by union with the
 * server value rather than replacing it:
 *
 *   appreciated   — monotonic, and only safe because appreciation is one-way.
 *                   If it ever becomes freely revocable this must become a Map.
 *   visitOverride — a Map, because visits do toggle. The last action in this
 *                   session wins, and it is always newer than a fetch that
 *                   started before it.
 *
 * Counts are pointedly absent. Caching a server-computed aggregate is the drift
 * this whole feature is built to avoid.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { AppreciationBudget, Spot } from "@/src/api";
import { useAuth } from "@/src/auth";
import * as spotsApi from "@/src/spots";
import { useActiveRegion } from "@/src/theme-context";

type SpotsState = {
  budget: AppreciationBudget | null;
  unread: number;
  appreciated: Set<string>;
  visitOverride: Map<string, boolean>;
  appreciate: (spotId: string) => Promise<void>;
  setVisited: (spotId: string, went: boolean) => Promise<void>;
  reloadBudget: () => Promise<void>;
  reloadUnread: () => Promise<void>;
  clearUnread: () => void;
};

const SpotsCtx = createContext<SpotsState>({
  budget: null,
  unread: 0,
  appreciated: new Set(),
  visitOverride: new Map(),
  appreciate: async () => {},
  setVisited: async () => {},
  reloadBudget: async () => {},
  reloadUnread: async () => {},
  clearUnread: () => {},
});

export function SpotsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const region = useActiveRegion();
  const [budget, setBudget] = useState<AppreciationBudget | null>(null);
  const [unread, setUnread] = useState(0);
  const [appreciated, setAppreciated] = useState<Set<string>>(new Set());
  const [visitOverride, setVisitOverride] = useState<Map<string, boolean>>(
    new Map(),
  );

  const reloadBudget = useCallback(async () => {
    if (!user || !region) {
      setBudget(null);
      return;
    }
    try {
      const list = await spotsApi.listSpots({ region_id: region.region_id, limit: 1 });
      setBudget(list.appreciation_budget);
    } catch {
      // A missing budget renders no copy at all, which is the right failure.
    }
  }, [user, region]);

  const reloadUnread = useCallback(async () => {
    if (!user) {
      setUnread(0);
      return;
    }
    try {
      setUnread((await spotsApi.unreadCount()).unread_count);
    } catch {
      // A stale dot is better than a crash on a flaky connection.
    }
  }, [user]);

  useEffect(() => {
    reloadBudget();
  }, [reloadBudget]);

  useEffect(() => {
    reloadUnread();
  }, [reloadUnread]);

  useEffect(() => {
    if (!user) {
      setAppreciated(new Set());
      setVisitOverride(new Map());
    }
  }, [user]);

  const appreciate = useCallback(
    async (spotId: string) => {
      if (!user || appreciated.has(spotId)) return;
      const previous = appreciated;
      const next = new Set(previous);
      next.add(spotId);
      setAppreciated(next);
      try {
        const r = await spotsApi.appreciateSpot(spotId);
        setBudget(r.appreciation_budget);
      } catch (e) {
        setAppreciated(previous);
        // Re-thrown so the screen can show the "you're out until Monday" 409.
        throw e;
      }
    },
    [appreciated, user],
  );

  const setVisited = useCallback(
    async (spotId: string, went: boolean) => {
      if (!user) return;
      const previous = visitOverride;
      const next = new Map(previous);
      next.set(spotId, went);
      setVisitOverride(next);
      try {
        if (went) await spotsApi.markVisited(spotId);
        else await spotsApi.unmarkVisited(spotId);
      } catch {
        setVisitOverride(previous);
      }
    },
    [visitOverride, user],
  );

  const clearUnread = useCallback(() => setUnread(0), []);

  const value = useMemo(
    () => ({
      budget,
      unread,
      appreciated,
      visitOverride,
      appreciate,
      setVisited,
      reloadBudget,
      reloadUnread,
      clearUnread,
    }),
    [
      budget,
      unread,
      appreciated,
      visitOverride,
      appreciate,
      setVisited,
      reloadBudget,
      reloadUnread,
      clearUnread,
    ],
  );

  return <SpotsCtx.Provider value={value}>{children}</SpotsCtx.Provider>;
}

export function useSpots() {
  return useContext(SpotsCtx);
}

/**
 * The server value unioned with this session's actions.
 *
 * Exported so no screen re-derives it — getting the precedence backwards is how
 * a button starts flickering between states.
 */
export function useSpotViewerState(spot: Spot | null | undefined) {
  const { appreciated, visitOverride } = useSpots();
  if (!spot) return { appreciated: false, visited: false };
  return {
    appreciated: spot.viewer_appreciated === true || appreciated.has(spot.spot_id),
    visited: visitOverride.get(spot.spot_id) ?? spot.viewer_visited ?? false,
  };
}
