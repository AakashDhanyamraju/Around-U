/**
 * Publish — design panel `1k`. Creators only.
 *
 * Modal chrome rather than a screen: Cancel on the left, Publish on the right,
 * and the form between them. The region control only ever offers regions this
 * account has been granted, which is enforced server-side too.
 *
 * The media strip takes an image URL rather than opening a picker. That is not
 * a design decision — `POST /uploads/signature` exists on the backend but no
 * picker is wired to it yet, and a plausible-looking "+ Photo" tile that opened
 * nothing would be worse than a field that works.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
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

import { api, ApiError, Creator, Region } from "@/src/api";
import {
  Banner,
  LabelledField,
  Loading,
  Mono,
  OrganicInput,
  PillButton,
} from "@/src/components/organic";
import { CATEGORIES, fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

const SELECTABLE = CATEGORIES.filter((c) => c !== "All");

export default function CreatorPublishScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();

  const [profile, setProfile] = useState<{
    creator: Creator;
    regions: Region[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [regionId, setRegionId] = useState("");
  const [image, setImage] = useState("");
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [neighborhood, setNeighborhood] = useState("");
  const [locationName, setLocationName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<{ creator: Creator; regions: Region[] }>("/creator/me")
      .then((p) => {
        setProfile(p);
        if (p.regions?.length) setRegionId(p.regions[0].region_id);
      })
      .catch((e) =>
        setLoadError(
          e instanceof ApiError ? e.message : "Could not load your creator profile.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const canSubmit =
    !!regionId &&
    !!image.trim() &&
    !!category &&
    !!neighborhood.trim() &&
    !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api("/creator/posts", {
        method: "POST",
        body: {
          region_id: regionId,
          image: image.trim(),
          caption: caption.trim(),
          category,
          neighborhood: neighborhood.trim(),
          location_name: locationName.trim() || undefined,
        },
      });
      setDone(true);
      setImage("");
      setCaption("");
      setNeighborhood("");
      setLocationName("");
      setCategory(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not publish.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={s.root}>
        <Loading />
      </View>
    );
  }

  if (loadError || !profile) {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <View style={{ padding: 26, gap: 12, alignItems: "flex-start" }}>
          <Text style={s.emptyTitle}>Not a creator account</Text>
          <Text style={s.emptyBody}>
            {loadError ?? "This account isn't set up to publish."}
          </Text>
          <PillButton label="Go back" variant="ghost" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const activeRegion = profile.regions.find((r) => r.region_id === regionId);

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SafeAreaView edges={["top"]}>
        <View style={s.topBar}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityRole="button"
          >
            <Text style={s.cancel}>Cancel</Text>
          </Pressable>
          <Text style={s.topTitle}>New post</Text>
          <PillButton
            testID="publish-btn"
            label="Publish"
            size="sm"
            disabled={!canSubmit}
            busy={submitting}
            onPress={onSubmit}
          />
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        testID="publish-scroll"
      >
        <Mono>Posting as {profile.creator.handle}</Mono>

        {done && <Banner tone="accent2" body="Published." />}
        {!!error && <Banner tone="accent" body={error} />}

        <View style={{ flexDirection: "row", gap: 9 }}>
          <View style={s.mediaTile}>
            {image.trim() ? (
              <>
                <Image
                  source={{ uri: image.trim() }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={180}
                />
                <Pressable
                  onPress={() => setImage("")}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Remove image"
                  style={s.mediaClear}
                >
                  <Ionicons name="close" size={12} color="#fff" />
                </Pressable>
              </>
            ) : (
              <View style={s.mediaEmpty}>
                <Ionicons name="image-outline" size={22} color={t.ink(45)} />
                <Text style={s.mediaEmptyText}>Photo or video</Text>
              </View>
            )}
          </View>

          <View style={{ flex: 1, justifyContent: "center" }}>
            <LabelledField label="Image URL">
              <OrganicInput
                value={image}
                onChangeText={setImage}
                placeholder="https://…"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </LabelledField>
          </View>
        </View>

        <LabelledField label="Caption">
          <OrganicInput
            value={caption}
            onChangeText={setCaption}
            placeholder="What makes this worth going to?"
            multiline
            style={s.textarea}
          />
        </LabelledField>

        <LabelledField label="Category">
          <View style={s.chipWrap}>
            {SELECTABLE.map((c) => {
              const on = category === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[s.chip, on && { backgroundColor: t.accent, borderColor: t.accent }]}
                >
                  <Text style={[s.chipText, on && { color: "#fff" }]}>{c}</Text>
                </Pressable>
              );
            })}
          </View>
        </LabelledField>

        <LabelledField label="Place">
          <View style={s.placeCard}>
            <Ionicons name="location" size={16} color={t.accentRamp[700]} />
            <View style={{ flex: 1, gap: 6 }}>
              <OrganicInput
                value={locationName}
                onChangeText={setLocationName}
                placeholder="Venue — Rothko Chapel"
                style={s.placeInput}
              />
              <OrganicInput
                value={neighborhood}
                onChangeText={setNeighborhood}
                placeholder="Neighbourhood — Montrose"
                style={s.placeInput}
              />
            </View>
          </View>
        </LabelledField>

        <View style={s.regionCard}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.regionTitle}>Region</Text>
            <Mono style={{ color: t.accent2Ramp[700] }}>
              only regions you&apos;re granted
            </Mono>
          </View>
          {profile.regions.length > 1 ? (
            <View style={s.chipWrap}>
              {profile.regions.map((r) => {
                const on = r.region_id === regionId;
                return (
                  <Pressable
                    key={r.region_id}
                    onPress={() => setRegionId(r.region_id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[s.regionPill, on && { backgroundColor: t.text }]}
                  >
                    <Text style={[s.regionPillText, on && { color: t.bg }]}>
                      {r.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={s.regionPill}>
              <Text style={s.regionPillText}>
                {activeRegion?.name ?? t.cityName}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: t.divider,
    },
    cancel: { fontFamily: fonts.bodySemi, fontSize: type.bodySm, color: t.ink(55) },
    topTitle: { fontFamily: fonts.bodyBold, fontSize: type.bodySm, color: t.text },

    mediaTile: {
      width: 104,
      height: 126,
      borderRadius: radii.md,
      overflow: "hidden",
      backgroundColor: t.neutral[200],
    },
    mediaEmpty: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      borderWidth: 1.5,
      borderStyle: "dashed",
      borderColor: t.neutral[400],
      borderRadius: radii.md,
      backgroundColor: t.bg,
    },
    mediaEmptyText: { fontFamily: fonts.bodySemi, fontSize: 10, color: t.ink(55) },
    mediaClear: {
      position: "absolute",
      top: 6,
      right: 6,
      width: 20,
      height: 20,
      borderRadius: radii.pill,
      backgroundColor: "rgba(32,30,29,0.7)",
      alignItems: "center",
      justifyContent: "center",
    },

    textarea: {
      minHeight: 86,
      borderRadius: radii.md,
      textAlignVertical: "top",
      paddingTop: 13,
    },

    chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: {
      paddingHorizontal: 13,
      paddingVertical: 9,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: t.divider,
    },
    chipText: { fontFamily: fonts.bodySemi, fontSize: 12, color: t.text },

    placeCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: t.surface,
      borderRadius: radii.md,
      padding: 13,
    },
    placeInput: { backgroundColor: t.bg, paddingVertical: 10 },

    regionCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: t.accent2Ramp[100],
      borderRadius: radii.md,
      paddingHorizontal: 15,
      paddingVertical: 13,
    },
    regionTitle: { fontFamily: fonts.bodyBold, fontSize: type.meta, color: t.text },
    regionPill: {
      backgroundColor: t.bg,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radii.pill,
    },
    regionPillText: { fontFamily: fonts.bodyBold, fontSize: 12, color: t.text },

    emptyTitle: { fontFamily: fonts.heading, fontSize: type.h4, color: t.text },
    emptyBody: {
      fontFamily: fonts.body,
      fontSize: type.bodySm,
      lineHeight: 21,
      color: t.ink(62),
      paddingBottom: space[2],
    },
  });
}
