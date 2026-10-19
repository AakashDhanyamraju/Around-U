/**
 * Report sheet — the thing behind every `···` in the design.
 *
 * Reporting is reachable when someone needs it and invisible when they don't,
 * so it lives in a sheet rather than a screen. The reasons are the fixed set the
 * backend validates against; self-harm is worded as a welfare concern rather
 * than a rule violation, because that is what it is.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { api, ApiError, ReportReason } from "@/src/api";
import { Banner, LabelledField, OrganicInput, PillButton } from "@/src/components/organic";
import { fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

const REASONS: { key: ReportReason; label: string }[] = [
  { key: "spam", label: "Spam" },
  { key: "harassment", label: "Harassment" },
  { key: "hate", label: "Hate" },
  { key: "violence", label: "Violence" },
  { key: "sexual_content", label: "Sexual content" },
  { key: "self_harm", label: "Someone may be at risk" },
  { key: "misinformation", label: "Misinformation" },
  { key: "other", label: "Something else" },
];

export function ReportSheet({
  visible,
  onClose,
  targetType,
  targetId,
  targetLabel,
}: {
  visible: boolean;
  onClose: () => void;
  // Mirrors REPORT_TARGETS in the backend's models.py. Widening one without
  // the other is a 422 on every report of the new kind.
  targetType: "post" | "community_post" | "comment" | "user" | "spot" | "spot_photo";
  targetId: string;
  targetLabel?: string;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const reset = () => {
    setReason(null);
    setNote("");
    setError("");
    setDone(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/reports", {
        method: "POST",
        body: {
          target_type: targetType,
          target_id: targetId,
          reason,
          note: note.trim() || undefined,
        },
      });
      setDone(true);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not send that. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
      accessibilityViewIsModal
    >
      <Pressable style={s.backdrop} onPress={close} accessibilityLabel="Dismiss" />
      <View style={s.sheet}>
        <View style={s.handle} />

        {done ? (
          <View style={{ gap: 14, paddingBottom: space[4] }}>
            <Text style={s.title}>Thanks — we&apos;ll look.</Text>
            <Text style={s.body}>
              {reason === "self_harm"
                ? "Welfare reports go to the top of the queue and a person reads them."
                : "A moderator reviews every report. You won't be told who filed what."}
            </Text>
            <PillButton label="Done" size="lg" block onPress={close} />
          </View>
        ) : (
          <>
            <Text style={s.title}>Report {targetLabel ?? "this"}</Text>

            {!!error && <Banner tone="accent" body={error} />}

            <ScrollView
              style={{ maxHeight: 260 }}
              contentContainerStyle={{ gap: 7, paddingVertical: 4 }}
              showsVerticalScrollIndicator={false}
            >
              {REASONS.map((r) => {
                const on = r.key === reason;
                return (
                  <Pressable
                    key={r.key}
                    onPress={() => setReason(r.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[s.reason, on && s.reasonOn]}
                  >
                    <Text style={[s.reasonText, on && { color: t.accentRamp[700] }]}>
                      {r.label}
                    </Text>
                    {on ? (
                      <Ionicons name="checkmark" size={16} color={t.accentRamp[700]} />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>

            <LabelledField label="Anything we should know (optional)">
              <OrganicInput
                value={note}
                onChangeText={setNote}
                placeholder="Context helps the person reviewing it."
                multiline
                maxLength={1000}
                style={s.note}
              />
            </LabelledField>

            <PillButton
              label="Send report"
              size="lg"
              block
              disabled={!reason}
              busy={busy}
              onPress={submit}
            />
            <PillButton label="Cancel" variant="ghost" block onPress={close} />
          </>
        )}
      </View>
    </Modal>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(46,43,37,0.5)" },
    sheet: {
      backgroundColor: t.bg,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      padding: 20,
      paddingBottom: 34,
      gap: 12,
    },
    handle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: radii.pill,
      backgroundColor: t.neutral[300],
      marginBottom: 4,
    },
    title: { fontFamily: fonts.heading, fontSize: type.h4, color: t.text },
    body: {
      fontFamily: fonts.body,
      fontSize: type.bodySm,
      lineHeight: 21,
      color: t.ink(66),
    },
    reason: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 13,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: t.divider,
    },
    reasonOn: { borderColor: t.accent, backgroundColor: t.accentRamp[100] },
    reasonText: { fontFamily: fonts.bodySemi, fontSize: type.bodySm, color: t.text },
    note: {
      minHeight: 74,
      borderRadius: radii.md,
      textAlignVertical: "top",
      paddingTop: 13,
    },
  });
}
