/**
 * Sign-in prompt for guest browsing.
 *
 * The app lets people in without a session, and bookmark and follow used to
 * silently do nothing for them. A "Join community" button that appears to work
 * and doesn't is a much louder failure, so guest actions route here instead of
 * no-oping.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { PillButton } from "@/src/components/organic";
import { fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

type Props = {
  visible: boolean;
  onClose: () => void;
  /** What the person was trying to do, e.g. "join this community". */
  action?: string;
};

export function SignInPrompt({ visible, onClose, action }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();

  // One destination: sign-in and sign-up are the same screen, since entering a
  // code either finds the account or creates it.
  const go = () => {
    onClose();
    router.push("/login");
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Dismiss" />
      <View style={s.sheet}>
        <View style={s.handle} />

        <View style={s.iconWrap}>
          <Ionicons name="people" size={28} color={t.accent} />
        </View>

        <Text style={s.title} accessibilityRole="header">
          Join the neighbourhood
        </Text>
        <Text style={s.body}>
          {action
            ? `Sign in with your email to ${action}.`
            : "Browsing needs nothing. Keeping things does."}
        </Text>

        {/* A single button: there is no "create account" versus "sign in"
            distinction any more — a code does both. Offering two would be
            asking a question with no consequence. */}
        <PillButton label="Continue with email" size="lg" block onPress={go} />

        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
          <Text style={s.dismiss}>Keep looking around</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/** Convenience hook: `const guard = useSignInPrompt()` then `guard.prompt(...)`. */
export function useSignInPrompt() {
  const [visible, setVisible] = React.useState(false);
  const [action, setAction] = React.useState<string | undefined>();

  const prompt = React.useCallback((forAction?: string) => {
    setAction(forAction);
    setVisible(true);
  }, []);

  const close = React.useCallback(() => setVisible(false), []);

  return { visible, action, prompt, close };
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(46,43,37,0.5)" },
    sheet: {
      backgroundColor: t.bg,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 24,
      paddingTop: 12,
      paddingBottom: 40,
      alignItems: "center",
      gap: 12,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: radii.pill,
      backgroundColor: t.neutral[300],
      marginBottom: space[4],
    },
    iconWrap: {
      width: 60,
      height: 60,
      borderRadius: radii.pill,
      backgroundColor: t.accentRamp[100],
      alignItems: "center",
      justifyContent: "center",
    },
    title: { fontFamily: fonts.heading, fontSize: 22, color: t.text, textAlign: "center" },
    body: {
      fontFamily: fonts.body,
      fontSize: type.body,
      lineHeight: 22,
      color: t.ink(66),
      textAlign: "center",
      marginBottom: space[2],
    },
    dismiss: { fontFamily: fonts.bodySemi, fontSize: type.bodySm, color: t.ink(55) },
  });
}
