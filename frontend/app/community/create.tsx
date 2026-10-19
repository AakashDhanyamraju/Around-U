import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Region } from "@/src/api";
import { useAuth } from "@/src/auth";
import * as communitiesApi from "@/src/communities";
import { useCommunities } from "@/src/community-context";
import { CATEGORIES, colors, fonts, radii, spacing } from "@/src/theme";

const SELECTABLE = CATEGORIES.filter((c) => c !== "All");

export default function CreateCommunityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { reload } = useCommunities();

  const [regions, setRegions] = useState<Region[]>([]);
  const [regionId, setRegionId] = useState<string>("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [needsApproval, setNeedsApproval] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    communitiesApi
      .listRegions()
      .then((rs) => {
        setRegions(rs ?? []);
        // Default to the person's home region when there's more than one.
        if (rs?.length) setRegionId(user?.home_region_id ?? rs[0].region_id);
      })
      .catch(() => setRegions([]));
  }, [user]);

  const canSubmit = name.trim().length >= 3 && !!regionId && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await communitiesApi.createCommunity({
        region_id: regionId,
        name: name.trim(),
        description: description.trim(),
        category: category ?? undefined,
        visibility: isPrivate ? "private" : "public",
        join_policy: needsApproval ? "request" : "open",
      });
      await reload();
      router.replace(`/community/${created.community_id}`);
    } catch (e: any) {
      setError(e?.message ?? "Could not create the community.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.topTitle}>New community</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.lead}>
          Communities are groups inside a city — a shared interest, not the whole
          place. You&apos;ll be its head.
        </Text>

        {!!error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={colors.primaryDeep} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.label}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Houston Climbers"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          maxLength={60}
        />

        <Text style={styles.label}>What&apos;s it for?</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Weekly climbs, gear swaps and beginner sessions."
          placeholderTextColor={colors.textMuted}
          style={[styles.input, styles.textarea]}
          multiline
          maxLength={2000}
        />

        {regions.length > 1 && (
          <>
            <Text style={styles.label}>City</Text>
            <View style={styles.chipWrap}>
              {regions.map((r) => (
                <Pressable
                  key={r.region_id}
                  onPress={() => setRegionId(r.region_id)}
                  style={[
                    styles.chip,
                    regionId === r.region_id && styles.chipOn,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      regionId === r.region_id && styles.chipTextOn,
                    ]}
                  >
                    {r.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={styles.label}>Category</Text>
        <View style={styles.chipWrap}>
          {SELECTABLE.map((c) => (
            <Pressable
              key={c}
              onPress={() => setCategory(category === c ? null : c)}
              style={[styles.chip, category === c && styles.chipOn]}
            >
              <Text
                style={[styles.chipText, category === c && styles.chipTextOn]}
              >
                {c}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Privacy</Text>
        <Toggle
          icon="lock-closed-outline"
          title="Private community"
          body="Only members can see the posts. It won't show up in discovery."
          value={isPrivate}
          onChange={setIsPrivate}
        />
        <Toggle
          icon="hand-left-outline"
          title="Approve new members"
          body="People request to join and a manager lets them in."
          value={needsApproval}
          onChange={setNeedsApproval}
        />

        <Pressable
          onPress={onSubmit}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.submit,
            !canSubmit && styles.submitOff,
            pressed && styles.pressed,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text style={styles.submitText}>Create community</Text>
          )}
        </Pressable>

        <Text style={styles.footnote}>
          You can run up to 2 communities at a time.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Toggle({
  icon,
  title,
  body,
  value,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={18} color={colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleBody}>{body}</Text>
      </View>
      <View style={[styles.switch, value && styles.switchOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  topTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 16,
    color: colors.textPrimary,
  },
  body: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl * 2 },
  lead: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  label: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textPrimary,
  },
  textarea: { minHeight: 90, textAlignVertical: "top" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.textSecondary,
  },
  chipTextOn: { color: colors.surface },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  toggleTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.textPrimary,
  },
  toggleBody: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 2,
  },
  switch: {
    width: 44,
    height: 26,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    padding: 3,
    justifyContent: "center",
  },
  switchOn: { backgroundColor: colors.primary },
  knob: {
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  knobOn: { alignSelf: "flex-end" },
  submit: {
    marginTop: spacing.xxl,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  submitOff: { backgroundColor: colors.primarySoft },
  submitText: {
    fontFamily: fonts.bodySemi,
    fontSize: 16,
    color: colors.surface,
  },
  footnote: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.md,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#FDECE7",
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.bodyMed,
    fontSize: 13,
    color: colors.primaryDeep,
  },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
