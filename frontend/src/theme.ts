// Theme constants — "around you" — warm gradient identity
export const colors = {
  background: "#FFF8F2",
  surface: "#FFFFFF",
  surfaceAlt: "#FFEDE0",
  primary: "#F26B3A", // warm orange
  pink: "#E64C8B",
  purple: "#7C3AED",
  accent: "#FFB85C",
  textPrimary: "#1A1320",
  textSecondary: "#5B5365",
  textMuted: "#8E8696",
  border: "#F1E4D6",
  overlay: "rgba(26,19,32,0.55)",
};

// Warm gradient: orange → pink → purple
export const warmGradient = ["#F26B3A", "#E64C8B", "#7C3AED"] as const;
export const warmGradientSoft = ["#FFB85C", "#F26B3A", "#E64C8B"] as const;

export const radii = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  pill: 999,
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const fonts = {
  display: "BricolageGrotesque_700Bold", // Clash Display substitute
  displayXL: "BricolageGrotesque_800ExtraBold",
  body: "Inter_400Regular",
  bodyMed: "Inter_500Medium",
  bodySemi: "Inter_600SemiBold",
  bodyBold: "Inter_700Bold",
};

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
