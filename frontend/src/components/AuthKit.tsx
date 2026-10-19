/**
 * Auth shell.
 *
 * The design puts sign-in on a flat cream ground — no decorative blobs, no
 * card. The screen is one column of copy and controls, so this file only owns
 * the frame and the footer link; everything inside comes from the Organic
 * primitives.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fonts, radii, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

export function AuthShell({
  children,
  showBack = false,
  onBack,
}: {
  children: React.ReactNode;
  showBack?: boolean;
  onBack?: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.topRow}>
            {showBack ? (
              <Pressable
                testID="auth-back-button"
                onPress={onBack ?? (() => router.back())}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <Ionicons name="chevron-back" size={20} color={t.text} />
              </Pressable>
            ) : null}
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** The eyebrow above the hero: "Around You · Houston". */
export function AuthEyebrow({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Text
      style={{
        fontFamily: fonts.bodySemi,
        fontSize: type.eyebrow,
        letterSpacing: 1.76,
        textTransform: "uppercase",
        color: t.accentRamp[700],
      }}
    >
      {children}
    </Text>
  );
}

export function AuthHeading({
  title,
  subtitle,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  return (
    <View style={{ gap: 13 }}>
      <Text style={s.hero} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={s.sub}>{subtitle}</Text> : null}
    </View>
  );
}

export function FooterLink({
  prefix,
  action,
  onPress,
  testID,
}: {
  prefix: string;
  action: string;
  onPress: () => void;
  testID?: string;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="link"
      accessibilityLabel={`${prefix} ${action}`}
      style={({ pressed }) => [s.footerLink, pressed && { opacity: 0.6 }]}
    >
      <Text style={s.footerText}>
        {prefix} <Text style={s.footerAction}>{action}</Text>
      </Text>
    </Pressable>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    scroll: { flexGrow: 1, paddingHorizontal: 26, paddingBottom: 30 },
    topRow: { minHeight: 24, justifyContent: "center", paddingTop: 4 },
    hero: {
      fontFamily: fonts.heading,
      fontSize: type.hero,
      lineHeight: type.hero * 1.04,
      color: t.text,
    },
    sub: {
      fontFamily: fonts.body,
      fontSize: type.body,
      lineHeight: 22,
      color: t.ink(66),
    },
    footerLink: { alignItems: "center", paddingVertical: 6 },
    footerText: { fontFamily: fonts.bodySemi, fontSize: 13, color: t.ink(60) },
    footerAction: { color: t.accentRamp[700], fontFamily: fonts.bodyBold },
    /** Kept so callers can reuse the pill radius without importing tokens. */
    pill: { borderRadius: radii.pill },
  });
}
