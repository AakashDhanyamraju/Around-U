/**
 * Membership state, shared across screens.
 *
 * Mirrors SocialProvider deliberately. Joining a community changes what the
 * communities tab, the community page and the member list should each show, and
 * without one source of truth those three drift apart. Keeping the caller's
 * memberships in a single context avoids that without adding a data-fetching
 * library the rest of the app does not use.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import type { Community, CommunityRole, MemberStatus } from "@/src/api";
import { useAuth } from "@/src/auth";
import * as communitiesApi from "@/src/communities";

type Standing = { role: CommunityRole; status: MemberStatus };

type CommunityState = {
  mine: Community[];
  /** community_id -> the viewer's role and status in it. */
  standing: Record<string, Standing>;
  loading: boolean;
  join: (communityId: string) => Promise<Standing | null>;
  leave: (communityId: string) => Promise<boolean>;
  reload: () => Promise<void>;
};

const CommunityCtx = createContext<CommunityState>({
  mine: [],
  standing: {},
  loading: false,
  join: async () => null,
  leave: async () => false,
  reload: async () => {},
});

export function CommunityProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [mine, setMine] = useState<Community[]>([]);
  const [standing, setStanding] = useState<Record<string, Standing>>({});
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!user) {
      setMine([]);
      setStanding({});
      return;
    }
    setLoading(true);
    try {
      const res = await communitiesApi.myCommunities();
      const list = res?.communities ?? [];
      setMine(list);
      setStanding(
        Object.fromEntries(
          list.map((c) => [
            c.community_id,
            {
              role: (c.viewer_role ?? "member") as CommunityRole,
              status: (c.viewer_status ?? "active") as MemberStatus,
            },
          ]),
        ),
      );
    } catch {
      // Leave the last good state in place rather than blanking the tab on a
      // transient network blip.
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  const join = useCallback(
    async (communityId: string) => {
      if (!user) return null;
      try {
        const res = await communitiesApi.joinCommunity(communityId);
        const next: Standing = { role: res.role, status: res.status };
        setStanding((prev) => ({ ...prev, [communityId]: next }));
        // A pending request is not a membership yet, so don't add it to the
        // "my communities" list until it is approved.
        if (res.status === "active") reload();
        return next;
      } catch (e) {
        throw e;
      }
    },
    [user, reload],
  );

  const leave = useCallback(
    async (communityId: string) => {
      if (!user) return false;
      const previous = standing;
      setStanding((prev) => {
        const next = { ...prev };
        delete next[communityId];
        return next;
      });
      setMine((prev) => prev.filter((c) => c.community_id !== communityId));
      try {
        await communitiesApi.leaveCommunity(communityId);
        return true;
      } catch (e) {
        setStanding(previous);
        reload();
        throw e;
      }
    },
    [standing, user, reload],
  );

  return (
    <CommunityCtx.Provider
      value={{ mine, standing, loading, join, leave, reload }}
    >
      {children}
    </CommunityCtx.Provider>
  );
}

export function useCommunities() {
  return useContext(CommunityCtx);
}
