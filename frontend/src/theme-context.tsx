/**
 * Active theme, keyed to the region you're browsing.
 *
 * The design re-themes the entire product per city — Houston is terracotta on
 * cream, Austin olive on bone, New Orleans plum on shell. Regions already exist
 * server-side, so the palette follows `users.home_region_id` rather than a
 * separate setting nobody would find.
 *
 * Screens read this instead of importing a frozen colour object, and build their
 * StyleSheet through `useMemo(() => makeStyles(t), [t])`. That keeps RN's static
 * stylesheet optimisation while still letting the palette change underneath.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { api, Region } from "@/src/api";
import { useAuth } from "@/src/auth";
import { DEFAULT_PALETTE, PALETTES, Palette } from "@/src/theme";

export type Theme = Palette & {
  /** Region display name, used in copy throughout the design ("Explore · Houston"). */
  cityName: string;
  /**
   * Text at a given opacity. The design leans on `color-mix(text n%, transparent)`
   * for every secondary and muted string; RN has no equivalent, so this resolves
   * the same mixes to rgba.
   */
  ink: (percent: number) => string;
  /** Same, for the accent — used by hover-ish and selected backgrounds. */
  accentInk: (percent: number) => string;
};

type ThemeState = {
  theme: Theme;
  regions: Region[];
  /**
   * The region the app is currently showing. Resolved here because this is
   * already where the home-region-then-fallback logic lives — every screen that
   * needs a `region_id` would otherwise re-derive it and they would drift.
   */
  activeRegion: Region | null;
  /** Preview another city's palette. Region grants still gate what you can post to. */
  setRegionSlug: (slug: string) => void;
};

/** "#201e1d" -> [32, 30, 29]. Handles the 3-digit form too. */
function toRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function mixer(hex: string) {
  const [r, g, b] = toRgb(hex);
  return (percent: number) => `rgba(${r},${g},${b},${percent / 100})`;
}

export function buildTheme(palette: Palette, cityName: string): Theme {
  return {
    ...palette,
    cityName,
    ink: mixer(palette.text),
    accentInk: mixer(palette.accent),
  };
}

const FALLBACK: Theme = buildTheme(DEFAULT_PALETTE, "Houston");

const ThemeCtx = createContext<ThemeState>({
  theme: FALLBACK,
  regions: [],
  activeRegion: null,
  setRegionSlug: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [regions, setRegions] = useState<Region[]>([]);
  const [override, setOverride] = useState<string | null>(null);

  useEffect(() => {
    // Public endpoint — a signed-out visitor still gets the right city's colours.
    api<Region[]>("/regions", { auth: false })
      .then(setRegions)
      .catch(() => setRegions([]));
  }, []);

  const setRegionSlug = useCallback((slug: string) => setOverride(slug), []);

  const activeRegion = useMemo(() => {
    const home = user?.home_region_id
      ? regions.find((r) => r.region_id === user.home_region_id)
      : undefined;
    const active = override
      ? regions.find((r) => r.slug === override)
      : home ?? regions[0];
    return active ?? null;
  }, [regions, user?.home_region_id, override]);

  const theme = useMemo(() => {
    // A region we have no palette for still gets the base system rather than
    // an empty theme — adding a city server-side must never break the client.
    const slug = activeRegion?.slug ?? "houston";
    return buildTheme(
      PALETTES[slug] ?? DEFAULT_PALETTE,
      activeRegion?.name ?? "Houston",
    );
  }, [activeRegion]);

  return (
    <ThemeCtx.Provider value={{ theme, regions, activeRegion, setRegionSlug }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeCtx).theme;
}

export function useRegions() {
  const { regions, setRegionSlug } = useContext(ThemeCtx);
  return { regions, setRegionSlug };
}

/** The region every spots screen scopes itself to. Null until /regions lands. */
export function useActiveRegion(): Region | null {
  return useContext(ThemeCtx).activeRegion;
}
