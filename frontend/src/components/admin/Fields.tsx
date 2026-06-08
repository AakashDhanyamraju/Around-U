import React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Switch,
  ActivityIndicator,
} from "react-native";

import { colors, fonts, radii } from "@/src/theme";

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

type FieldProps = {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  testID?: string;
};

export function Field({ multiline, ...props }: FieldProps) {
  return (
    <TextInput
      {...props}
      placeholderTextColor={colors.textMuted}
      style={[styles.input, multiline && styles.inputMultiline]}
      multiline={multiline}
    />
  );
}

type ChipRowProps = {
  options: { label: string; value: string }[];
  selected: string;
  onSelect: (v: string) => void;
};

export function ChipRow({ options, selected, onSelect }: ChipRowProps) {
  return (
    <View style={styles.chipWrap}>
      {options.map((o) => {
        const active = o.value === selected;
        return (
          <Pressable
            key={o.value}
            onPress={() => onSelect(o.value)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ToggleRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primarySoft }}
        thumbColor={value ? colors.primary : "#fff"}
      />
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.primaryBtn,
        (disabled || loading) && { opacity: 0.6 },
        pressed && { opacity: 0.85 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.primaryBtnText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function StatusText({ text }: { text: string }) {
  if (!text) return null;
  const ok = text.startsWith("✓");
  return <Text style={[styles.status, { color: ok ? colors.success : colors.primaryDeep }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 0.5,
    color: colors.textSecondary,
    textTransform: "uppercase",
    marginBottom: 8,
    marginTop: 18,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputMultiline: { minHeight: 110, textAlignVertical: "top" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.textSecondary },
  chipTextActive: { color: "#fff" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 12,
  },
  toggleLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.textPrimary },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#fff", fontFamily: fonts.bodyBold, fontSize: 16 },
  status: { fontFamily: fonts.bodySemi, fontSize: 14, marginTop: 16, textAlign: "center" },
});
