/**
 * Add a spot — design panel `2c`.
 *
 * Modal chrome rather than a screen, following `creator/publish.tsx`: Cancel on
 * the left, the action on the right, the form between them.
 *
 * A photo is deliberately not required. The contribution loop only starts once
 * a region has spots in it, and a cold-start city cannot afford the friction —
 * so the copy says "you can add one later" and means it.
 *
 * The duplicate guard never blocks submission. It offers the nearby spot and
 * gets out of the way, because a false positive that stops someone adding a real
 * place is worse than one duplicate in the list.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { ApiError, DuplicateCandidate } from "@/src/api";
import { useAuth } from "@/src/auth";
import {
  Banner,
  Card,
  LabelledField,
  Mono,
  OrganicInput,
  PillButton,
} from "@/src/components/organic";
import { PinPicker } from "@/src/components/spots/PinPicker";
import { Coords } from "@/src/location";
import { addPhoto, createSpot, findDuplicates, isDuplicateResult } from "@/src/spots";
import { pickAndUploadImage } from "@/src/uploads";
import { CATEGORIES, fonts, radii, space, type } from "@/src/theme";
import { Theme, useActiveRegion, useTheme } from "@/src/theme-context";

const SELECTABLE = CATEGORIES.filter((c) => c !== "All");
const BEST_TIMES = [
  "Morning",
  "Lunch",
  "Afternoon",
  "Golden hour",
  "After dark",
  "Weekends",
];

export default function CreateSpotScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const { user } = useAuth();
  const region = useActiveRegion();

  const [coords, setCoords] = useState<Coords | null>(null);
  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [bestTime, setBestTime] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [quiet, setQuiet] = useState(false);

  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [dismissedDupes, setDismissedDupes] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The 60m / 0.6-similarity thresholds are the server's: it is the only place
  // that has every spot to compare against.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!region || !coords || name.trim().length < 3) {
      setDuplicates([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      try {
        const r = await findDuplicates({
          region_id: region.region_id,
          lat: coords.lat,
          lng: coords.lng,
          name: name.trim(),
        });
        setDuplicates(r.candidates);
        setDismissedDupes(false);
      } catch {
        setDuplicates([]);
      }
    }, 500);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [region, coords, name]);

  const onPickPhoto = useCallback(async () => {
    setError(null);
    setUploading(true);
    const result = await pickAndUploadImage({ folder: "spots" });
    setUploading(false);
    if (result.status === "uploaded") {
      setPhotos((prev) => [...prev, result.image.url]);
    } else if (result.status === "denied") {
      setError(
        result.can_ask_again
          ? "Around You needs access to your photos to add one."
          : "Photo access is off. You can turn it back on in Settings.",
      );
    } else if (result.status === "failed") {
      setError(result.message);
    }
    // "cancelled" is silent: backing out of a picker is not an error.
  }, []);

  const addPhotoToExisting = async (candidate: DuplicateCandidate) => {
    setError(null);
    setUploading(true);
    const result = await pickAndUploadImage({ folder: "spots" });
    setUploading(false);
    if (result.status !== "uploaded") {
      if (result.status === "failed") setError(result.message);
      return;
    }
    try {
      await addPhoto(candidate.spot_id, { url: result.image.url });
      router.replace(`/spot/${candidate.spot_id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add that photo.");
    }
  };

  const canSubmit = !!region && !!coords && name.trim().length >= 3 && !submitting;

  const onSubmit = async (force = false) => {
    if (!canSubmit || !region || !coords) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createSpot({
        region_id: region.region_id,
        name: name.trim(),
        blurb: blurb.trim(),
        best_time: bestTime.trim() || null,
        category,
        lat: coords.lat,
        lng: coords.lng,
        is_quiet: quiet,
        photos,
        confirm_duplicate: force,
      });

      if (isDuplicateResult(result)) {
        setDuplicates(result.candidates);
        setDismissedDupes(false);
        return;
      }
      // Land on the thing you just made, with your name in the credit block.
      router.replace(`/spot/${result.spot_id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add this spot.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <View style={{ padding: 26, gap: 12, alignItems: "flex-start" }}>
          <Text style={s.topTitle}>Not signed in</Text>
          <Text style={s.body}>
            Adding a spot credits you as the finder, so it needs an account.
          </Text>
          <PillButton
            label="Continue with email"
            size="lg"
            onPress={() => router.replace("/login")}
          />
        </View>
      </SafeAreaView>
    );
  }

  const showDupes = duplicates.length > 0 && !dismissedDupes;

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SafeAreaView edges={["top"]}>
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
            <Text style={s.cancel}>Cancel</Text>
          </Pressable>
          <Text style={s.topTitle}>Add a spot</Text>
          <PillButton
            testID="create-spot-btn"
            label="Add"
            size="sm"
            disabled={!canSubmit}
            busy={submitting}
            onPress={() => onSubmit(false)}
          />
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 44 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        testID="create-spot-scroll"
      >
        {!!error && <Banner tone="accent" body={error} />}

        {showDupes && (
          <Card tone="accent2">
            <Text style={s.dupeTitle}>Already here?</Text>
            {duplicates.slice(0, 2).map((d) => (
              <View key={d.spot_id} style={{ gap: 8, marginTop: 6 }}>
                <Text style={s.body}>
                  {`${d.name} is ${Math.round(d.distance_m)} m away.`}
                </Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <PillButton
                    label="Add your photo to that one"
                    size="sm"
                    busy={uploading}
                    onPress={() => addPhotoToExisting(d)}
                  />
                  <PillButton
                    label="It&apos;s a different place"
                    variant="ghost"
                    size="sm"
                    onPress={() => setDismissedDupes(true)}
                  />
                </View>
              </View>
            ))}
          </Card>
        )}

        <LabelledField label="Where is it">
          <PinPicker region={region} value={coords} onChange={setCoords} />
        </LabelledField>

        <LabelledField label="Name">
          <OrganicInput
            value={name}
            onChangeText={setName}
            placeholder="The bench behind the chapel"
            maxLength={80}
          />
        </LabelledField>

        <LabelledField label="Why it&apos;s worth the trip">
          <OrganicInput
            value={blurb}
            onChangeText={setBlurb}
            placeholder="What makes it worth going out of your way for?"
            multiline
            maxLength={400}
            style={s.textarea}
          />
        </LabelledField>

        <LabelledField label="Photos">
          <View style={s.mediaRow}>
            {photos.map((url) => (
              <View key={url} style={s.mediaTile}>
                <Image
                  source={{ uri: url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={180}
                />
                <Pressable
                  onPress={() => setPhotos((p) => p.filter((u) => u !== url))}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  style={s.mediaClear}
                >
                  <Ionicons name="close" size={12} color="#fff" />
                </Pressable>
              </View>
            ))}
            <Pressable
              onPress={onPickPhoto}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel="Add a photo"
              style={[s.mediaTile, s.mediaEmpty]}
            >
              <Ionicons
                name={uploading ? "hourglass-outline" : "image-outline"}
                size={20}
                color={t.ink(50)}
              />
              <Text style={s.mediaLabel}>{uploading ? "Uploading" : "Add photo"}</Text>
            </Pressable>
          </View>
          <Mono>A photo helps, but you can add one later.</Mono>
        </LabelledField>

        <LabelledField label="Best time">
          <View style={s.chipWrap}>
            {BEST_TIMES.map((b) => {
              const on = bestTime === b;
              return (
                <Pressable
                  key={b}
                  onPress={() => setBestTime(on ? "" : b)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[s.chip, on && { backgroundColor: t.accent, borderColor: t.accent }]}
                >
                  <Text style={[s.chipText, on && { color: "#fff" }]}>{b}</Text>
                </Pressable>
              );
            })}
          </View>
          <OrganicInput
            value={bestTime}
            onChangeText={setBestTime}
            placeholder="or say it your own way"
            maxLength={120}
          />
        </LabelledField>

        <LabelledField label="Category">
          <View style={s.chipWrap}>
            {SELECTABLE.map((c) => {
              const on = category === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => setCategory(on ? null : c)}
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

        <Pressable
          onPress={() => setQuiet((q) => !q)}
          accessibilityRole="switch"
          accessibilityState={{ checked: quiet }}
          style={s.quietRow}
        >
          <Ionicons
            name={quiet ? "checkbox" : "square-outline"}
            size={20}
            color={quiet ? t.accent : t.ink(45)}
          />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.quietTitle}>Keep it quiet</Text>
            <Text style={s.quietBody}>
              It stays findable by name, but never gets ranked or shown around —
              and it won&apos;t count towards your rank. You can undo this once.
            </Text>
          </View>
        </Pressable>

        <Text style={s.footnote}>
          You&apos;ll be credited as the finder for as long as this spot exists.
          People who go because of it count toward your rank.
        </Text>
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
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: t.divider,
    },
    cancel: { fontFamily: fonts.bodySemi, fontSize: type.bodySm, color: t.ink(62) },
    topTitle: { fontFamily: fonts.heading, fontSize: type.h5, color: t.text },
    body: {
      fontFamily: fonts.body,
      fontSize: type.bodySm,
      lineHeight: 20,
      color: t.ink(66),
    },
    textarea: {
      minHeight: 86,
      borderRadius: radii.md,
      textAlignVertical: "top",
      paddingTop: 13,
    },
    mediaRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    mediaTile: {
      width: 96,
      height: 116,
      borderRadius: radii.md,
      overflow: "hidden",
      backgroundColor: t.neutral[200],
    },
    mediaEmpty: {
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      backgroundColor: "transparent",
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: t.neutral[400],
    },
    mediaLabel: { fontFamily: fonts.bodySemi, fontSize: 10, color: t.ink(55) },
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
    chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: {
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: t.divider,
    },
    chipText: { fontFamily: fonts.bodySemi, fontSize: 12, color: t.text },
    quietRow: {
      flexDirection: "row",
      gap: 11,
      alignItems: "flex-start",
      backgroundColor: t.surface,
      borderRadius: radii.md,
      padding: 14,
      marginTop: space[2],
    },
    quietTitle: { fontFamily: fonts.bodyBold, fontSize: type.bodySm, color: t.text },
    quietBody: {
      fontFamily: fonts.body,
      fontSize: type.micro,
      lineHeight: 17,
      color: t.ink(62),
    },
    dupeTitle: { fontFamily: fonts.bodyBold, fontSize: type.h5, color: t.text },
    footnote: {
      fontFamily: fonts.bodySemi,
      fontSize: type.micro,
      lineHeight: 17,
      textAlign: "center",
      color: t.ink(55),
      marginTop: space[2],
    },
  });
}
