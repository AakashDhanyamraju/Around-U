import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

type SocialState = {
  bookmarkIds: Set<string>;
  followIds: Set<string>;
  toggleBookmark: (postId: string) => Promise<void>;
  toggleFollow: (creatorId: string) => Promise<void>;
  reload: () => Promise<void>;
};

const SocialCtx = createContext<SocialState>({
  bookmarkIds: new Set(),
  followIds: new Set(),
  toggleBookmark: async () => {},
  toggleFollow: async () => {},
  reload: async () => {},
});

export function SocialProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(new Set());
  const [followIds, setFollowIds] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!user) {
      setBookmarkIds(new Set());
      setFollowIds(new Set());
      return;
    }
    try {
      const [b, f] = await Promise.all([
        api<{ post_ids: string[] }>("/bookmarks"),
        api<{ creator_ids: string[] }>("/follows"),
      ]);
      setBookmarkIds(new Set(b.post_ids));
      setFollowIds(new Set(f.creator_ids));
    } catch (e) {
      console.warn("reload social failed", e);
    }
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggleBookmark = useCallback(
    async (postId: string) => {
      if (!user) return;
      const isOn = bookmarkIds.has(postId);
      const next = new Set(bookmarkIds);
      if (isOn) next.delete(postId);
      else next.add(postId);
      setBookmarkIds(next);
      try {
        if (isOn) await api(`/bookmarks/${postId}`, { method: "DELETE" });
        else await api(`/bookmarks/${postId}`, { method: "POST" });
      } catch {
        setBookmarkIds(bookmarkIds);
      }
    },
    [bookmarkIds, user],
  );

  const toggleFollow = useCallback(
    async (creatorId: string) => {
      if (!user) return;
      const isOn = followIds.has(creatorId);
      const next = new Set(followIds);
      if (isOn) next.delete(creatorId);
      else next.add(creatorId);
      setFollowIds(next);
      try {
        if (isOn) await api(`/follows/${creatorId}`, { method: "DELETE" });
        else await api(`/follows/${creatorId}`, { method: "POST" });
      } catch {
        setFollowIds(followIds);
      }
    },
    [followIds, user],
  );

  return (
    <SocialCtx.Provider value={{ bookmarkIds, followIds, toggleBookmark, toggleFollow, reload }}>
      {children}
    </SocialCtx.Provider>
  );
}

export function useSocial() {
  return useContext(SocialCtx);
}
