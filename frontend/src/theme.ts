/**
 * Organic — design tokens, ported from the design system's `organic.css`.
 *
 * The CSS file is the source of truth for values; this is the React Native
 * transcription of it. Two things differ by necessity:
 *
 *   - `color-mix(in srgb, X n%, transparent)` has no RN equivalent, so the
 *     mixes the design leans on (text at 50/55/58/62/66/70%) are pre-resolved
 *     into `ink(...)` helpers rather than computed per use.
 *   - The "rounded frame" block at the end of organic.css overrides the base
 *     radii, so `radii` here already reflects the override: cards and sheets at
 *     radius-lg x 1.15, and every small control fully round.
 *
 * Colours live on a `Theme` object rather than a frozen export because the
 * design re-themes the whole product per city. See theme-context.tsx.
 */
import { Platform } from "react-native";

export type Palette = {
  bg: string;
  surface: string;
  text: string;
  accent: string;
  accent2: string;
  divider: string;

  neutral: Ramp;
  accentRamp: Ramp;
  accent2Ramp: Ramp;
};

/** 100 -> 900, one shared lightness scale across all three roles. */
export type Ramp = {
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
};

const NEUTRAL: Ramp = {
  100: "#f9f4ed",
  200: "#eee7db",
  300: "#dcd3c4",
  400: "#c0b6a5",
  500: "#a19786",
  600: "#82796a",
  700: "#645c50",
  800: "#474238",
  900: "#2e2b25",
};

/**
 * Houston is the base system in organic.css. Austin and New Orleans come from
 * the `[data-city=...]` overrides in the design doc, which only redefine the
 * shades they use — the rest fall through to the base ramp, as they do in CSS.
 */
export const PALETTES: Record<string, Palette> = {
  houston: {
    bg: "#f5ead8",
    surface: "#ebddc5",
    text: "#201e1d",
    accent: "#c67139",
    accent2: "#7a8a5e",
    divider: "rgba(32,30,29,0.16)",
    neutral: NEUTRAL,
    accentRamp: {
      100: "#fff2eb",
      200: "#ffe1d0",
      300: "#ffc6a5",
      400: "#f6a06b",
      500: "#d67f48",
      600: "#b2622d",
      700: "#8c491a",
      800: "#643312",
      900: "#402310",
    },
    accent2Ramp: {
      100: "#f0fae1",
      200: "#e1eecc",
      300: "#ccdbb2",
      400: "#aebf92",
      500: "#8fa073",
      600: "#728157",
      700: "#56633f",
      800: "#3d472b",
      900: "#272e1b",
    },
  },

  austin: {
    bg: "#f4f1e0",
    surface: "#e8e3c8",
    text: "#22201a",
    accent: "#7d9a3c",
    accent2: "#c2603f",
    divider: "rgba(34,32,26,0.16)",
    neutral: NEUTRAL,
    accentRamp: {
      100: "#f4fadf",
      200: "#e6f2c4",
      300: "#cbe09a",
      400: "#aecb72",
      500: "#93b055",
      600: "#63801f",
      700: "#4d6420",
      800: "#374716",
      900: "#232e0e",
    },
    accent2Ramp: {
      100: "#ffeee5",
      200: "#fbdccd",
      300: "#f0bfa6",
      400: "#e09d7c",
      500: "#cd7c58",
      600: "#a85336",
      700: "#8a3d1e",
      800: "#5f2913",
      900: "#3c1a0c",
    },
  },

  "new-orleans": {
    bg: "#f1e7dd",
    surface: "#e4d7c8",
    text: "#221b1f",
    accent: "#a8577a",
    accent2: "#4f7f79",
    divider: "rgba(34,27,31,0.16)",
    neutral: NEUTRAL,
    accentRamp: {
      100: "#fceef4",
      200: "#f7dbe7",
      300: "#eec2d5",
      400: "#dc9bb8",
      500: "#c4779b",
      600: "#8d4364",
      700: "#74314f",
      800: "#552237",
      900: "#371522",
    },
    accent2Ramp: {
      100: "#e4f4f1",
      200: "#cfe9e4",
      300: "#aed6cf",
      400: "#87bab2",
      500: "#679d95",
      600: "#427a73",
      700: "#2f5751",
      800: "#1f3c38",
      900: "#132523",
    },
  },
};

export const DEFAULT_PALETTE = PALETTES.houston;

/**
 * Space scale. The design's values are the 4px grid multiplied by 1.1, which is
 * where the fractional numbers come from — kept exact so vertical rhythm lines
 * up with the mockups rather than drifting a pixel per row.
 */
export const space = {
  1: 4.4,
  2: 8.8,
  3: 13.2,
  4: 17.6,
  6: 26.4,
  8: 35.2,
} as const;

/** Post-override values — see the "rounded frame" block in organic.css. */
export const radii = {
  tile: 8,
  sm: 8,
  md: 16,
  lg: 28,
  xl: 32.2,
  card: 32.2,
  pill: 999,
} as const;

export const shadows = {
  sm: {
    shadowColor: "#2e2b25",
    shadowOpacity: 0.14,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  md: {
    shadowColor: "#2e2b25",
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  lg: {
    shadowColor: "#2e2b25",
    shadowOpacity: 0.22,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
} as const;

/**
 * Caprasimo ships a single weight. Asking for a bold variant silently falls
 * back to a synthesised one on Android, so headings always use the 400 face and
 * get their emphasis from size.
 */
export const fonts = {
  heading: "Caprasimo_400Regular",
  /** Aliases kept for the operator consoles, which were not restructured. */
  display: "Caprasimo_400Regular",
  displayXL: "Caprasimo_400Regular",
  body: "Figtree_400Regular",
  bodyMed: "Figtree_500Medium",
  bodySemi: "Figtree_600SemiBold",
  bodyBold: "Figtree_700Bold",
  /**
   * Handles, counts and timestamps are monospaced throughout the design.
   * RN only accepts a real family name on native — a CSS-style stack silently
   * falls back to the system face — so each platform names its own.
   */
  mono: Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "ui-monospace, Menlo, monospace",
  }) as string,
} as const;

/** Sizes taken from the phone mockups, not organic.css's web defaults. */
export const type = {
  hero: 40,
  screenTitle: 27,
  h3: 25,
  h4: 20,
  h5: 16,
  eyebrow: 11,
  body: 15,
  bodySm: 14,
  meta: 13,
  micro: 11,
  mono: 10,
} as const;

/**
 * Static Houston-palette aliases for the surfaces the redesign does not cover:
 * the admin and superadmin consoles, community create and members, and the
 * shared admin field kit. They pick up Organic's colours without being
 * restructured, so nothing looks like it belongs to the old system.
 *
 * New and redesigned screens must use `useTheme()` instead — only that
 * re-themes per city.
 */
export const colors = {
  background: DEFAULT_PALETTE.bg,
  backgroundAlt: DEFAULT_PALETTE.surface,
  surface: DEFAULT_PALETTE.surface,
  surfaceAlt: NEUTRAL[100],
  primary: DEFAULT_PALETTE.accent,
  primarySoft: DEFAULT_PALETTE.accentRamp[300],
  primaryDeep: DEFAULT_PALETTE.accentRamp[700],
  accent: DEFAULT_PALETTE.accentRamp[400],
  textPrimary: DEFAULT_PALETTE.text,
  textSecondary: NEUTRAL[700],
  textMuted: NEUTRAL[500],
  border: NEUTRAL[300],
  blob: DEFAULT_PALETTE.accentRamp[200],
  blobSoft: DEFAULT_PALETTE.accentRamp[100],
  success: DEFAULT_PALETTE.accent2Ramp[600],
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/** Single-shadow alias for the same un-redesigned surfaces. */
export const shadow = shadows.md;

export const CATEGORIES = [
  "All",
  "Food",
  "Events",
  "Real Estate",
  "Hidden Gems",
  "Nightlife",
  "Outdoor",
  "Culture",
];

/** Categories the design shows as the on-screen filter row. */
export const FILTER_CATEGORIES = [
  "All",
  "Food",
  "Nightlife",
  "Hidden Gems",
  "Outdoor",
  "Culture",
  "Events",
  "Real Estate",
];
