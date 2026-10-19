/**
 * Spot detail — design panel `2b`.
 *
 * The order of the page is the argument. Appreciate lives *inside* the finder
 * credit card; "I went" lives in the bottom bar. They are never in the same row
 * and never in the same container, because one credits a person and the other
 * credits a place, and collapsing them turns the whole system back into likes.
 *
 * For the same reason the tier line under Appreciate is phrased as a fact about
 * the finder — "Ana needs 4 more spots someone visits to reach Local" — never as
 * a consequence of your tap. Appreciating does not move anyone's rank. Visits do.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError, AppreciationBudget, RankProgress, Spot, SpotPhoto } from "@/src/api";
import { useAuth } from "@/src/auth";
import {
  Banner,
  Card,
  Divider,
  Loading,
  Mono,
  PhotoCarousel,
  PillButton,
  SectionHeading,
  StatColumn,
  TierChip,
} from "@/src/components/organic";
import { ReportSheet } from "@/src/components/organic/ReportSheet";
import { SignInPrompt, useSignInPrompt } from "@/src/components/SignInPrompt";
import { useSpots, useSpotViewerState } from "@/src/spots-context";
import {
  addPhoto,
  budgetCopy,
  closedLine,
  freshnessLine,
  getSpot,
  saveSpot,
  tierProgressLine,
  unsaveSpot,
  userRank,
  firstNameOf,
} from "@/src/spots";
import { pickAndUploadImage } from "@/src/uploads";
import { fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

export default function SpotScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const signIn = useSignInPrompt();
  const spotsCtx = useSpots();

  const [spot, setSpot] = useState<Spot | null>(null);
  const [photos, setPhotos] = useState<SpotPhoto[]>([]);
  const [budget, setBudget] = useState<AppreciationBudget | null>(null);
  const [finderRank, setFinderRank] = useState<RankProgress | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reporting, setReporting] = useState(false);

  const viewer = useSpotViewerState(spot);

  const load = useCallback(async () => {
    const body = await getSpot(id);
    setSpot(body.spot);
    setPhotos(body.photos);
    setBudget(body.appreciation_budget);
    setSaved(body.spot.viewer_saved === true);
    // The finder's distance to their next rung, shown once you appreciate.
    userRank(body.spot.finder_user_id, body.spot.region_id)
      .then(setFinderRank)
      .catch(() => setFinderRank(null));
  }, [id]);

  useEffect(() => {
    load()
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "That spot has gone."),
      )
      .finally(() => setLoading(false));
  }, [load]);

  // The provider owns the budget across screens; adopt its copy once it lands.
  useEffect(() => {
    if (spotsCtx.budget) setBudget(spotsCtx.budget);
  }, [spotsCtx.budget]);

  const onAppreciate = async () => {
    if (!spot) return;
    if (!user) return signIn.prompt("appreciate this spot");
    setError(null);
    try {
      await spotsCtx.appreciate(spot.spot_id);
      setSpot((prev) =>
        prev ? { ...prev, appreciation_count: prev.appreciation_count + 1 } : prev,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not appreciate that.");
    }
  };

  const onWent = async () => {
    if (!spot) return;
    if (!user) return signIn.prompt("mark this visited");
    const next = !viewer.visited;
    await spotsCtx.setVisited(spot.spot_id, next);
    setSpot((prev) =>
      prev
        ? {
            ...prev,
            visits_attributed_total: Math.max(
              0,
              prev.visits_attributed_total + (next ? 1 : -1),
            ),
          }
        : prev,
    );
  };

  const onSave = async () => {
    if (!spot) return;
    if (!user) return signIn.prompt("save this spot");
    const next = !saved;
    setSaved(next);
    try {
      if (next) await saveSpot(spot.spot_id);
      else await unsaveSpot(spot.spot_id);
    } catch {
      setSaved(!next);
    }
  };

  const onAddPhoto = async () => {
    if (!spot) return;
    if (!user) return signIn.prompt("add a photo");
    setError(null);
    setNotice(null);
    setUploading(true);
    const result = await pickAndUploadImage({ folder: "spots" });
    setUploading(false);

    if (result.status === "cancelled") return; // Backing out is not an error.
    if (result.status === "denied") {
      setError(
        result.can_ask_again
          ? "Around You needs access to your photos to add one."
          : "Photo access is off. You can turn it back on in Settings.",
      );
      return;
    }
    if (result.status === "failed") {
      setError(result.message);
      return;
    }
    try {
      const photo = await addPhoto(spot.spot_id, {
        url: result.image.url,
        width: result.image.width,
        height: result.image.height,
      });
      setPhotos((prev) => [...prev, photo]);
      setSpot((prev) =>
        prev ? { ...prev, photo_count: prev.photo_count + 1 } : prev,
      );
      setNotice("Added. Thanks.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add that photo.");
    }
  };

  const onShare = async () => {
    if (!spot) return;
    try {
      await Share.share({ message: `${spot.name} — Around You` });
    } catch {
      // Dismissing the share sheet is not a failure.
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <Loading />
      </SafeAreaView>
    );
  }

  if (!spot) {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <View style={{ padding: 26, gap: 12 }}>
          <Text style={s.title}>Not here</Text>
          <Text style={s.body}>{error || "That spot has gone."}</Text>
          <PillButton
            label="Back"
            variant="ghost"
            onPress={() => router.back()}
            style={{ alignSelf: "flex-start" }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const closed = spot.status === "closed";
  const carouselUrls = photos.map((p) => p.url);
  const freshness = freshnessLine(spot);
  const monthFound = new Date(spot.created_at).toLocaleDateString(undefined, {
    month: "short",
  });

  return (
    <View style={s.root}>
      <ScrollView showsVerticalScrollIndicator={false} testID="spot-scroll">
        <PhotoCarousel
          urls={carouselUrls}
          dimmed={closed}
          overlay={
            <SafeAreaView edges={["top"]} style={s.heroBar}>
              <Pressable
                testID="back-btn"
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={s.overlayBtn}
              >
                <Ionicons name="chevron-back" size={20} color="#fff" />
              </Pressable>
              <Pressable
                testID="report-btn"
                onPress={() =>
                  user ? setReporting(true) : signIn.prompt("report this spot")
                }
                accessibilityRole="button"
                accessibilityLabel="More options"
                style={s.overlayBtn}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color="#fff" />
              </Pressable>
            </SafeAreaView>
          }
        />

        <View style={s.body_}>
          <Text style={s.title} accessibilityRole="header">
            {spot.name}
          </Text>
          <Mono>
            {[spot.address, spot.best_time && `best at ${spot.best_time}`]
              .filter(Boolean)
              .join(" · ")}
          </Mono>

          {/* Where the ranking would be, for a spot that opted out of it. */}
          {spot.is_quiet && (
            <Mono style={{ color: t.accent2Ramp[700] }}>
              kept quiet — this one isn&apos;t ranked
            </Mono>
          )}

          {!!spot.blurb && <Text style={s.blurb}>{spot.blurb}</Text>}

          {!!error && <Banner tone="accent" body={error} />}
          {!!notice && <Banner tone="accent2" body={notice} />}

          {/* 1 — finder credit. The Appreciate control lives in here. */}
          <Card tone="accent">
            <View style={s.finderRow}>
              <View style={s.finderAvatar}>
                {spot.finder_picture ? (
                  <Image
                    source={{ uri: spot.finder_picture }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                ) : (
                  <Text style={s.finderInitial}>
                    {(spot.finder_name ?? "?").slice(0, 1).toUpperCase()}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
                <Text style={s.eyebrow}>Found this spot</Text>
                <Text style={s.finderName} numberOfLines={1}>
                  {spot.viewer_is_finder ? "You" : spot.finder_name}
                </Text>
              </View>
              <TierChip tier={spot.finder_tier} label={spot.finder_tier_label} />
            </View>

            <AppreciateControl
              spot={spot}
              budget={budget}
              appreciated={viewer.appreciated}
              signedIn={!!user}
              finderRank={finderRank}
              onPress={onAppreciate}
            />
          </Card>

          {/* 2 — the place, in numbers. */}
          <View style={s.stats}>
            <StatColumn value={spot.visits_attributed_total} label="went" />
            <StatColumn value={spot.photo_count} label="photos" />
            <StatColumn value={monthFound} label="found" />
          </View>
          <Divider />

          {/* 3 — community photos. */}
          <SectionHeading action="Add yours" onAction={onAddPhoto}>
            Photos
          </SectionHeading>
          <View style={s.grid}>
            {photos.map((p) => (
              <View key={p.spot_photo_id} style={s.tile}>
                <Image
                  source={{ uri: p.url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={180}
                />
              </View>
            ))}
            <Pressable
              onPress={onAddPhoto}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel="Add a photo"
              style={[s.tile, s.tileEmpty]}
            >
              <Ionicons
                name={uploading ? "hourglass-outline" : "add"}
                size={20}
                color={t.ink(50)}
              />
              <Text style={s.tileLabel}>
                {uploading ? "Uploading" : "Add yours"}
              </Text>
            </Pressable>
          </View>

          {/* 4 — is it still worth going? */}
          {closed ? (
            <Banner tone="accent" body={closedLine(spot)} />
          ) : (
            <Banner tone={freshness.tone} body={freshness.body} />
          )}
        </View>
      </ScrollView>

      {/* 5 — the place, not the person. */}
      <SafeAreaView edges={["bottom"]} style={s.actionBar}>
        <PillButton
          testID="went-btn"
          label={viewer.visited ? "You went" : "I went"}
          variant={viewer.visited ? "soft" : "primary"}
          icon={viewer.visited ? "checkmark" : undefined}
          onPress={onWent}
          style={{ flex: 1 }}
        />
        <PillButton
          label="Share"
          variant="ghost"
          size="sm"
          onPress={onShare}
        />
        <PillButton
          testID="save-spot-btn"
          label={saved ? "Saved" : "Save"}
          variant="dark"
          size="sm"
          icon={saved ? "bookmark" : "bookmark-outline"}
          onPress={onSave}
        />
      </SafeAreaView>

      <ReportSheet
        visible={reporting}
        onClose={() => setReporting(false)}
        targetType="spot"
        targetId={spot.spot_id}
        targetLabel="this spot"
      />
      <SignInPrompt
        visible={signIn.visible}
        action={signIn.action}
        onClose={signIn.close}
      />
    </View>
  );
}

/**
 * The five states of the Appreciate button.
 *
 * Order matters: `appreciated` is checked before `exhausted`, so a spot you have
 * already appreciated does not flip to "you're out" the moment the budget empties
 * somewhere else.
 */
function AppreciateControl({
  spot,
  budget,
  appreciated,
  signedIn,
  finderRank,
  onPress,
}: {
  spot: Spot;
  budget: AppreciationBudget | null;
  appreciated: boolean;
  signedIn: boolean;
  finderRank: RankProgress | null;
  onPress: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  // Your own spot: the control is absent, not disabled. There is nothing to
  // explain and a greyed button would only invite a tap.
  if (spot.viewer_is_finder) return null;

  if (!signedIn) {
    return (
      <View style={{ gap: 6 }}>
        <PillButton label="Appreciate" icon="heart-outline" onPress={onPress} />
        <Text style={s.budget}>Sign in and you get a few of these a week.</Text>
      </View>
    );
  }

  const copy = budgetCopy(budget, appreciated);
  const progress = finderRank
    ? tierProgressLine(finderRank, firstNameOf(spot.finder_name))
    : null;

  if (appreciated) {
    return (
      <View style={{ gap: 6 }}>
        <PillButton label="Appreciated" variant="soft" icon="heart" disabled />
        {!!copy && <Text style={s.budget}>{copy}</Text>}
        {/* A fact about them, not a reward for you. */}
        {!!progress && <Text style={s.budget}>{progress}</Text>}
      </View>
    );
  }

  const exhausted = budget?.remaining === 0;
  return (
    <View style={{ gap: 6 }}>
      <PillButton
        testID="appreciate-btn"
        label="Appreciate"
        icon="heart-outline"
        disabled={exhausted}
        onPress={onPress}
      />
      {/* No budget loaded means no sentence — never guess a number. */}
      {!!copy && <Text style={s.budget}>{copy}</Text>}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    heroBar: {
      position: "absolute",
      left: 16,
      right: 16,
      top: 0,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    overlayBtn: {
      width: 36,
      height: 36,
      borderRadius: radii.pill,
      backgroundColor: "rgba(32,30,29,0.6)",
      alignItems: "center",
      justifyContent: "center",
    },
    body_: { padding: 20, gap: 13, paddingBottom: 30 },
    title: { fontFamily: fonts.heading, fontSize: type.screenTitle, color: t.text },
    body: { fontFamily: fonts.body, fontSize: type.body, color: t.ink(66) },
    blurb: {
      fontFamily: fonts.body,
      fontSize: type.body,
      lineHeight: 23,
      color: t.text,
    },
    finderRow: { flexDirection: "row", alignItems: "center", gap: 11 },
    finderAvatar: {
      width: 44,
      height: 44,
      borderRadius: radii.pill,
      overflow: "hidden",
      backgroundColor: t.accentRamp[300],
      alignItems: "center",
      justifyContent: "center",
    },
    finderInitial: {
      fontFamily: fonts.heading,
      fontSize: 18,
      color: t.accentRamp[800],
    },
    eyebrow: {
      fontFamily: fonts.bodySemi,
      fontSize: 10,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: t.ink(55),
    },
    finderName: { fontFamily: fonts.bodyBold, fontSize: type.h5, color: t.text },
    budget: {
      fontFamily: fonts.bodySemi,
      fontSize: type.micro,
      lineHeight: 17,
      color: t.ink(58),
    },
    stats: { flexDirection: "row", gap: space[8], marginTop: space[2] },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    tile: {
      width: "31.5%",
      aspectRatio: 1,
      borderRadius: radii.md,
      overflow: "hidden",
      backgroundColor: t.neutral[200],
    },
    tileEmpty: {
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      backgroundColor: "transparent",
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: t.neutral[400],
    },
    tileLabel: { fontFamily: fonts.bodySemi, fontSize: 10, color: t.ink(55) },
    actionBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 20,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: t.divider,
      backgroundColor: t.bg,
    },
  });
}
