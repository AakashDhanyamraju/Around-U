/**
 * Organic primitives — the pieces every screen in the design doc is assembled
 * from. Building these once is most of the work; the screens are largely
 * arrangements of them.
 *
 * Each takes its colour from `useTheme()` rather than a module-level constant,
 * because the palette changes per city.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native";
import { SafeAreaView, Edge } from "react-native-safe-area-context";

import { SpotTier } from "@/src/api";
import { TIER_LABEL } from "@/src/spots";
import { useTheme, Theme } from "@/src/theme-context";
import { fonts, radii, shadows, space, type } from "@/src/theme";

// ── screen ────────────────────────────────────────────────────────────────────

export function Screen({
  children,
  edges = ["top"],
  style,
}: {
  children: React.ReactNode;
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: t.bg }, style]} edges={edges}>
      {children}
    </SafeAreaView>
  );
}

/** The 27px screen title, optionally with something trailing on the baseline. */
export function ScreenTitle({
  children,
  trailing,
  style,
}: {
  children: React.ReactNode;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
        style,
      ]}
    >
      <Text
        accessibilityRole="header"
        style={{ fontFamily: fonts.heading, fontSize: type.screenTitle, color: t.text }}
      >
        {children}
      </Text>
      {trailing}
    </View>
  );
}

/** The tracked, uppercase h6 the design uses to head every minor section. */
export function SectionHeading({
  children,
  action,
  onAction,
}: {
  children: React.ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        justifyContent: "space-between",
      }}
    >
      <Text
        style={{
          fontFamily: fonts.heading,
          fontSize: type.meta,
          letterSpacing: 1.04,
          textTransform: "uppercase",
          color: t.text,
        }}
      >
        {children}
      </Text>
      {action ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8}>
          <Text
            style={{
              fontFamily: fonts.bodySemi,
              fontSize: type.micro,
              color: t.accentRamp[700],
            }}
          >
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Handles, counts, timestamps — monospaced everywhere in the design. */
export function Mono({
  children,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        { fontFamily: fonts.mono, fontSize: type.mono, color: t.ink(55) },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

// ── buttons ───────────────────────────────────────────────────────────────────

export type PillVariant = "primary" | "outline" | "dark" | "soft" | "ghost";

export function PillButton({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  disabled,
  busy,
  block,
  testID,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: PillVariant;
  size?: "sm" | "md" | "lg";
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  busy?: boolean;
  block?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const pad =
    size === "lg"
      ? { paddingVertical: 16, fontSize: 15 }
      : size === "sm"
        ? { paddingVertical: 9, fontSize: 12 }
        : { paddingVertical: 12, fontSize: 13 };

  const skin: Record<PillVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: t.accent, fg: "#fff", border: "transparent" },
    outline: { bg: "transparent", fg: t.accentRamp[700], border: t.accent },
    dark: { bg: t.text, fg: t.bg, border: "transparent" },
    soft: { bg: t.accentRamp[100], fg: t.accentRamp[700], border: t.accentRamp[300] },
    ghost: { bg: "transparent", fg: t.text, border: t.divider },
  };
  const s = skin[variant];

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          paddingHorizontal: size === "sm" ? 16 : 20,
          paddingVertical: pad.paddingVertical,
          borderRadius: radii.pill,
          backgroundColor: s.bg,
          borderWidth: s.border === "transparent" ? 0 : 1.5,
          borderColor: s.border,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          width: block ? "100%" : undefined,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={s.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={pad.fontSize + 2} color={s.fg} /> : null}
          <Text
            style={{ fontFamily: fonts.bodyBold, fontSize: pad.fontSize, color: s.fg }}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

// ── tags and chips ────────────────────────────────────────────────────────────

export function Tag({
  label,
  tone = "neutral",
  style,
}: {
  label: string;
  tone?: "accent" | "accent2" | "neutral" | "outline";
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const skin = {
    accent: { bg: t.accentRamp[100], fg: t.accentRamp[700], border: "transparent" },
    accent2: { bg: t.accent2Ramp[100], fg: t.accent2Ramp[700], border: "transparent" },
    neutral: { bg: t.neutral[100], fg: t.neutral[800], border: "transparent" },
    outline: { bg: "transparent", fg: t.text, border: t.divider },
  }[tone];

  return (
    <View
      style={[
        {
          paddingHorizontal: 10,
          paddingVertical: 7,
          borderRadius: radii.pill,
          backgroundColor: skin.bg,
          borderWidth: skin.border === "transparent" ? 0 : 1,
          borderColor: skin.border,
        },
        style,
      ]}
    >
      <Text style={{ fontFamily: fonts.bodySemi, fontSize: type.micro, color: skin.fg }}>
        {label}
      </Text>
    </View>
  );
}

/** The horizontal filter row: one solid selected pill, the rest outlined. */
export function ChipRow({
  items,
  selected,
  onSelect,
  paddingHorizontal = 20,
}: {
  items: string[];
  selected: string;
  onSelect: (v: string) => void;
  paddingHorizontal?: number;
}) {
  const t = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 7, paddingHorizontal }}
    >
      {items.map((item) => {
        const on = item === selected;
        return (
          <Pressable
            key={item}
            onPress={() => onSelect(item)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: radii.pill,
              backgroundColor: on ? t.text : "transparent",
              borderWidth: on ? 0 : 1,
              borderColor: t.divider,
            }}
          >
            <Text
              style={{
                fontFamily: on ? fonts.bodyBold : fonts.bodySemi,
                fontSize: 12,
                color: on ? t.bg : t.text,
              }}
            >
              {item}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** The three-up segmented control on Nearby. */
export function Segmented({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 4,
        backgroundColor: t.surface,
        borderRadius: radii.pill,
        padding: 4,
      }}
    >
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[
              {
                flex: 1,
                alignItems: "center",
                paddingVertical: 9,
                borderRadius: radii.pill,
                backgroundColor: on ? t.bg : "transparent",
              },
              on && shadows.sm,
            ]}
          >
            <Text
              style={{
                fontFamily: on ? fonts.bodyBold : fonts.bodySemi,
                fontSize: 12,
                color: on ? t.text : t.ink(58),
              }}
            >
              {o}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── avatar ────────────────────────────────────────────────────────────────────

/** Deterministic tint so the same person keeps the same colour across screens. */
function tintFor(seed: string, t: Theme) {
  const tints = [
    { bg: t.accentRamp[300], fg: t.accentRamp[800] },
    { bg: t.accent2Ramp[300], fg: t.accent2Ramp[800] },
    { bg: t.neutral[300], fg: t.neutral[800] },
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return tints[h % tints.length];
}

export function initialsOf(name?: string) {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  uri,
  size = 40,
  seed,
  square,
  ring,
}: {
  name?: string;
  uri?: string | null;
  size?: number;
  seed?: string;
  /** Communities use a rounded square; people are circular. */
  square?: boolean;
  /** The bg-coloured ring used where an avatar overlaps a cover photo. */
  ring?: boolean;
}) {
  const t = useTheme();
  const tint = tintFor(seed || name || "?", t);
  const radius = square ? radii.md : size / 2;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: tint.bg,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderWidth: ring ? 4 : 0,
        borderColor: t.bg,
      }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          accessibilityLabel={name}
        />
      ) : (
        <Text
          style={{
            fontFamily: fonts.bodyBold,
            fontSize: Math.max(9, size * 0.33),
            color: tint.fg,
          }}
        >
          {initialsOf(name)}
        </Text>
      )}
    </View>
  );
}

// ── rows and cards ────────────────────────────────────────────────────────────

/**
 * The person row used by search, Saved's cold start and the community member
 * list: avatar, name, monospaced sub-line, an accent beat line, and an action.
 */
export function PersonRow({
  name,
  sub,
  beat,
  uri,
  seed,
  size = 48,
  action,
  onPress,
}: {
  name: string;
  sub?: string;
  beat?: string;
  uri?: string | null;
  seed?: string;
  size?: number;
  action?: React.ReactNode;
  onPress?: () => void;
}) {
  const t = useTheme();
  // The action sits outside the pressable, not inside it. Nesting one would put
  // a <button> inside a <button> on web — invalid markup, and the press would
  // bubble, so tapping Follow would also open the profile.
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? "button" : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 11,
        }}
      >
        <Avatar name={name} uri={uri} size={size} seed={seed} />
        <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.bodyBold, fontSize: 14, color: t.text }}
          >
            {name}
          </Text>
          {sub ? <Mono numberOfLines={1}>{sub}</Mono> : null}
          {beat ? (
            <Text
              numberOfLines={1}
              style={{
                fontFamily: fonts.bodySemi,
                fontSize: type.micro,
                color: t.accent2Ramp[700],
              }}
            >
              {beat}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {action}
    </View>
  );
}

/** Surface-coloured rounded container — the design's default grouping device. */
export function Card({
  children,
  tone = "surface",
  style,
}: {
  children: React.ReactNode;
  tone?: "surface" | "accent" | "accent2" | "outline";
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg = {
    surface: t.surface,
    accent: t.accentRamp[100],
    accent2: t.accent2Ramp[100],
    outline: "transparent",
  }[tone];

  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: radii.card,
          padding: space[4],
          gap: space[2],
          borderWidth: tone === "outline" ? 1 : 0,
          borderColor: t.divider,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Big numeral over a tracked uppercase caption. Used on every profile. */
export function StatColumn({ value, label }: { value: string | number; label: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 1 }}>
      <Text style={{ fontFamily: fonts.heading, fontSize: 21, color: t.text }}>
        {value}
      </Text>
      <Text
        style={{
          fontFamily: fonts.bodySemi,
          fontSize: 10,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          color: t.ink(55),
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** The underlined tab strip on creator profiles and search. */
export function UnderlineTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 20,
        borderBottomWidth: 1,
        borderBottomColor: t.divider,
      }}
    >
      {tabs.map((tab) => {
        const on = tab === value;
        return (
          <Pressable
            key={tab}
            onPress={() => onChange(tab)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{
              paddingBottom: 8,
              borderBottomWidth: on ? 2.5 : 0,
              borderBottomColor: t.accent,
            }}
          >
            <Text
              style={{
                fontFamily: on ? fonts.bodyBold : fonts.bodySemi,
                fontSize: type.meta,
                color: on ? t.text : t.ink(55),
              }}
            >
              {tab}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Read-only search affordance / real input, depending on `onChangeText`. */
export function SearchBar({
  placeholder,
  value,
  onChangeText,
  onPress,
  active,
  trailing,
}: {
  placeholder: string;
  value?: string;
  onChangeText?: (v: string) => void;
  onPress?: () => void;
  active?: boolean;
  trailing?: React.ReactNode;
}) {
  const t = useTheme();
  const body = (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        backgroundColor: active ? t.bg : t.surface,
        borderRadius: radii.pill,
        borderWidth: active ? 2 : 0,
        borderColor: t.accent,
        paddingHorizontal: 16,
        paddingVertical: active ? 10 : 12,
      }}
    >
      <Ionicons name="search" size={15} color={active ? t.accent : t.ink(55)} />
      {onChangeText ? (
        <OrganicInput
          value={value ?? ""}
          onChangeText={onChangeText}
          placeholder={placeholder}
          bare
        />
      ) : (
        <Text
          style={{ fontFamily: fonts.bodySemi, fontSize: type.meta, color: t.ink(50) }}
        >
          {placeholder}
        </Text>
      )}
    </View>
  );

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="search" style={{ flex: 1 }}>
          {body}
        </Pressable>
      ) : (
        body
      )}
      {trailing}
    </View>
  );
}

// ── inputs ────────────────────────────────────────────────────────────────────

export const OrganicInput = React.forwardRef<
  TextInput,
  TextInputProps & { bare?: boolean }
>(function OrganicInput({ bare, style, ...props }, ref) {
  const t = useTheme();
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={t.ink(50)}
      selectionColor={t.accent}
      style={[
        {
          flex: 1,
          fontFamily: fonts.bodySemi,
          fontSize: bare ? type.meta : 15,
          color: t.text,
          paddingVertical: 0,
        },
        !bare && {
          backgroundColor: t.surface,
          borderRadius: radii.pill,
          paddingHorizontal: 16,
          paddingVertical: 13,
        },
        style,
      ]}
      {...props}
    />
  );
});

/** Labelled block input — the "Why it's worth the trip" / caption field. */
export function LabelledField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text
        style={{
          fontFamily: fonts.bodyBold,
          fontSize: type.micro,
          letterSpacing: 0.88,
          textTransform: "uppercase",
          color: t.ink(55),
        }}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}

// ── feedback ──────────────────────────────────────────────────────────────────

export function Banner({
  tone,
  title,
  body,
  footnote,
}: {
  tone: "accent" | "accent2" | "surface";
  title?: string;
  body: string;
  footnote?: string;
}) {
  const t = useTheme();
  const bg = { accent: t.accentRamp[100], accent2: t.accent2Ramp[100], surface: t.surface }[
    tone
  ];
  const eyebrow = { accent: t.accentRamp[700], accent2: t.accent2Ramp[700], surface: t.text }[
    tone
  ];

  return (
    <View
      style={{ backgroundColor: bg, borderRadius: radii.card, padding: 16, gap: 7 }}
      accessibilityRole="alert"
    >
      {title ? (
        <Text
          style={{
            fontFamily: fonts.bodyBold,
            fontSize: 10,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: eyebrow,
          }}
        >
          {title}
        </Text>
      ) : null}
      <Text
        style={{ fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, color: t.text }}
      >
        {body}
      </Text>
      {footnote ? (
        <Text style={{ fontFamily: fonts.bodySemi, fontSize: 12, color: eyebrow }}>
          {footnote}
        </Text>
      ) : null}
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ paddingVertical: 60, alignItems: "center" }}>
      <ActivityIndicator color={t.accent} />
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 18, paddingVertical: space[6] }}>
      <View
        style={{
          alignSelf: "center",
          width: 96,
          height: 96,
          borderRadius: radii.pill,
          backgroundColor: t.accentRamp[100],
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={38} color={t.accent} />
      </View>
      <View style={{ gap: 8, alignItems: "center" }}>
        <Text
          accessibilityRole="header"
          style={{
            fontFamily: fonts.heading,
            fontSize: 21,
            color: t.text,
            textAlign: "center",
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: type.bodySm,
            lineHeight: 21,
            textAlign: "center",
            color: t.ink(62),
          }}
        >
          {body}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** Hairline rule matching `.hr`. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[{ height: 1, backgroundColor: t.divider }, style]} />
  );
}

/** The "or" rule between the two sign-in routes. */
export function OrRule({ label = "or" }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: t.divider }} />
      <Text style={{ fontFamily: fonts.bodySemi, fontSize: type.micro, color: t.ink(50) }}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: t.divider }} />
    </View>
  );
}

/**
 * Placeholder texture for media that hasn't loaded or doesn't exist. The design
 * uses a 135deg two-tone stripe; RN has no repeating-linear-gradient, so this is
 * a stack of rotated bars, which reads the same at these sizes.
 */
export function Hatch({
  tone = "neutral",
  style,
  children,
}: {
  tone?: "neutral" | "accent" | "accent2";
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const t = useTheme();
  const ramp = { neutral: t.neutral, accent: t.accentRamp, accent2: t.accent2Ramp }[tone];
  const bars = useMemo(() => Array.from({ length: 14 }), []);

  return (
    <View
      style={[
        { backgroundColor: ramp[200], overflow: "hidden", justifyContent: "flex-end" },
        style,
      ]}
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {bars.map((_, i) => (
          <View
            key={i}
            style={{
              position: "absolute",
              left: -160,
              right: -160,
              top: i * 28 - 120,
              height: 10,
              backgroundColor: ramp[300],
              transform: [{ rotate: "-45deg" }],
            }}
          />
        ))}
      </View>
      {children}
    </View>
  );
}

/** Small monospaced caption pinned inside media, e.g. "photo — al pastor". */
export function MediaNote({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={{
        alignSelf: "flex-start",
        margin: 11,
        backgroundColor: t.bg,
        paddingHorizontal: 9,
        paddingVertical: 6,
        borderRadius: radii.pill,
      }}
    >
      <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: t.neutral[700] }}>
        {children}
      </Text>
    </View>
  );
}

/** Dark overlay pill — duration badges, photo counters, back buttons. */
export function OverlayPill({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          backgroundColor: "rgba(32,30,29,0.72)",
          paddingHorizontal: 9,
          paddingVertical: 6,
          borderRadius: radii.pill,
        },
        style,
      ]}
    >
      {typeof children === "string" ? (
        <Text style={{ fontFamily: fonts.bodyBold, fontSize: 10, color: "#fff" }}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

/** The location chip used in headers and post meta. */
export function PlacePill({
  label,
  tone = "plain",
}: {
  label: string;
  tone?: "plain" | "soft";
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        backgroundColor: tone === "soft" ? t.accentRamp[100] : "transparent",
        paddingHorizontal: tone === "soft" ? 11 : 0,
        paddingVertical: tone === "soft" ? 7 : 0,
        borderRadius: radii.pill,
      }}
    >
      <Ionicons name="location" size={13} color={t.accentRamp[700]} />
      <Text
        style={{ fontFamily: fonts.bodySemi, fontSize: 12, color: t.accentRamp[700] }}
      >
        {label}
      </Text>
    </View>
  );
}

// ── spots ─────────────────────────────────────────────────────────────────────

/**
 * A finder's standing, on the four surfaces that show it.
 *
 * It exists mainly to own one rule: **an untiered finder gets no badge at all,
 * not an empty one**. Centralising that means no screen can render "Wanderer 0"
 * or a blank chip, and it is why the Nearby row does not need to special-case
 * anything by position.
 */
export function TierChip({
  tier,
  label,
  size = "md",
}: {
  tier?: SpotTier | null;
  label?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  if (!tier) return null;
  // The top two rungs take the accent; the rest stay olive so the ladder reads
  // as a progression rather than five identical badges.
  const tone = tier === "local" || tier === "keeper" ? "accent" : "accent2";
  return (
    <Tag
      label={label || TIER_LABEL[tier]}
      tone={tone}
      style={
        size === "sm"
          ? { paddingHorizontal: 8, paddingVertical: 4 }
          : size === "lg"
            ? { paddingHorizontal: 13, paddingVertical: 9 }
            : undefined
      }
    />
  );
}

/**
 * The rank numeral down the left of the Nearby list.
 *
 * Fixed width is the whole point: as inline text the column ragged-edges the
 * moment rank 10 appears, and every row below it shifts.
 */
export function RankNumeral({ n }: { n: number }) {
  const t = useTheme();
  return (
    <View style={{ width: 28, alignItems: "center" }}>
      <Text
        style={{
          fontFamily: fonts.heading,
          fontSize: 18,
          color: n <= 3 ? t.accent : t.ink(45),
        }}
      >
        {n}
      </Text>
    </View>
  );
}

/**
 * The spot-detail photo pager.
 *
 * The index comes from `onScroll`, not `onMomentumScrollEnd`: momentum events
 * do not fire reliably on react-native-web, and the "1 / 12" counter would
 * stick. Chevrons appear on web because a desktop browser has no swipe.
 */
export function PhotoCarousel({
  urls,
  height = 430,
  dimmed = false,
  overlay,
}: {
  urls: string[];
  height?: number;
  dimmed?: boolean;
  overlay?: React.ReactNode;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const [index, setIndex] = React.useState(0);
  const ref = React.useRef<ScrollView>(null);
  // On web the window is the browser, which would otherwise give a full-bleed
  // 1400px hero.
  const pageWidth = Math.min(width, 720);

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(urls.length - 1, next));
    setIndex(clamped);
    ref.current?.scrollTo({ x: clamped * pageWidth, animated: true });
  };

  return (
    <View style={{ height, width: pageWidth, alignSelf: "center" }}>
      {urls.length === 0 ? (
        <Hatch style={StyleSheet.absoluteFill} />
      ) : (
        <ScrollView
          ref={ref}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(e) =>
            setIndex(Math.round(e.nativeEvent.contentOffset.x / pageWidth))
          }
        >
          {urls.map((url) => (
            <Image
              key={url}
              source={{ uri: url }}
              style={{ width: pageWidth, height }}
              contentFit="cover"
              transition={180}
            />
          ))}
        </ScrollView>
      )}

      {/* A closed spot is greyed. React Native has no cross-platform greyscale
          filter, so a scrim is the honest way to say "this may be gone". */}
      {dimmed && (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: "rgba(46,43,37,0.45)" },
          ]}
        />
      )}

      {urls.length > 1 && (
        <View style={{ position: "absolute", right: 14, bottom: 14 }}>
          <OverlayPill>{`${index + 1} / ${urls.length}`}</OverlayPill>
        </View>
      )}

      {Platform.OS === "web" && urls.length > 1 && (
        <>
          <Pressable
            onPress={() => go(index - 1)}
            accessibilityRole="button"
            accessibilityLabel="Previous photo"
            style={{ position: "absolute", left: 10, top: height / 2 - 18 }}
          >
            <View style={carouselArrow(t)}>
              <Ionicons name="chevron-back" size={18} color="#fff" />
            </View>
          </Pressable>
          <Pressable
            onPress={() => go(index + 1)}
            accessibilityRole="button"
            accessibilityLabel="Next photo"
            style={{ position: "absolute", right: 10, top: height / 2 - 18 }}
          >
            <View style={carouselArrow(t)}>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </View>
          </Pressable>
        </>
      )}

      {overlay}
    </View>
  );
}

function carouselArrow(_t: Theme): ViewStyle {
  return {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: "rgba(32,30,29,0.6)",
    alignItems: "center",
    justifyContent: "center",
  };
}
