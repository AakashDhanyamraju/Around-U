/**
 * Nearby — design panel `2a`.
 *
 * This tab used to group posts by neighbourhood over a drawn map. It is now the
 * ranked spot layer: places that accumulate, ordered by how many people actually
 * went because someone found them.
 *
 * Two rules worth not breaking.
 *
 * Cold start reads `region_spot_count` from the envelope, never `spots.length`.
 * Off the array, typing in the search box would flip the whole screen in and out
 * of cold-start mode.
 *
 * The tier chip is never branched on row position. The rule is that an untiered
 * finder has no chip, and `TierChip` already returns null for that — keying off
 * the index instead would hide a Keeper's chip for happening to land at #4.
 */
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Spot } from "@/src/api";
import { useAuth } from "@/src/auth";
import {
  Banner,
  Card,
  EmptyState,
  Hatch,
  Loading,
  Mono,
  PillButton,
  PlacePill,
  RankNumeral,
  Screen,
  ScreenTitle,
  SearchBar,
  Segmented,
  TierChip,
} from "@/src/components/organic";
import { SignInPrompt, useSignInPrompt } from "@/src/components/SignInPrompt";
import { formatDistance, useNearMe } from "@/src/location";
import { attributionLine, listSpots } from "@/src/spots";
import { fonts, radii, space, type } from "@/src/theme";
import { Theme, useActiveRegion, useTheme } from "@/src/theme-context";

const SEGMENTS = ["Most suggested", "Newest", "Near me"] as const;
const SORT: Record<(typeof SEGMENTS)[number], "rank" | "new" | "near"> = {
  "Most suggested": "rank",
  Newest: "new",
  "Near me": "near",
};

export default function NearbyScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const { user } = useAuth();
  const region = useActiveRegion();
  const signIn = useSignInPrompt();
  const near = useNearMe();

  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]>(SEGMENTS[0]);
  const [query, setQuery] = useState("");
  const [spots, setSpots] = useState<Spot[]>([]);
  const [regionCount, setRegionCount] = useState(0);
  const [coldStart, setColdStart] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Imperial for the US: the launch city reads miles, and a global default
  // nobody picked is worse than one somebody did.
  const imperial = (region?.country ?? "US") === "US";

  const load = useCallback(async () => {
    if (!region) return;
    const sort = SORT[segment];
    const body = await listSpots({
      region_id: region.region_id,
      sort,
      q: query.trim() || undefined,
      // Only ever ask for proximity ordering when there are real coordinates.
      ...(sort === "near" && near.coords
        ? { lat: near.coords.lat, lng: near.coords.lng }
        : {}),
      limit: 50,
    });
    setSpots(body.spots);
    setRegionCount(body.region_spot_count);
    setColdStart(body.cold_start);
  }, [region, segment, query, near.coords]);

  useFocusEffect(
    useCallback(() => {
      load()
        .catch(() => setSpots([]))
        .finally(() => setLoading(false));
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } catch {
      // Keep whatever is on screen.
    } finally {
      setRefreshing(false);
    }
  };

  const onSegment = async (next: string) => {
    const seg = next as (typeof SEGMENTS)[number];
    setSegment(seg);
    if (seg === "Near me" && !near.coords) await near.request();
  };

  const onAdd = () => {
    if (!user) return signIn.prompt("add a spot");
    router.push("/spot/create");
  };

  const ranked = segment === "Most suggested" && !coldStart && !query.trim();

  return (
    <Screen>
      <View style={s.header}>
        <ScreenTitle trailing={<PlacePill label={t.cityName} />}>Nearby</ScreenTitle>
        <SearchBar
          placeholder="Search a spot or a place"
          value={query}
          onChangeText={setQuery}
        />
        {/* Absent, not disabled, in cold start: a three-way sort over four
            items is theatre. */}
        {!coldStart && (
          <Segmented options={[...SEGMENTS]} value={segment} onChange={onSegment} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 14, paddingBottom: 30 }}
        showsVerticalScrollIndicator={false}
        testID="nearby-scroll"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.accent}
          />
        }
      >
        {segment === "Near me" &&
          (near.status === "denied" || near.status === "unavailable") && (
            /* Above the rows, not instead of them. Blanking a list because
               somebody declined a permission is punitive. */
            <Card tone="accent">
              <Text style={s.cardTitle}>Nearby needs your location</Text>
              <Text style={s.cardBody}>
                {near.status === "denied" && !near.canAskAgain
                  ? "Location is off for Around You. You can turn it back on in your settings."
                  : "Turn it on and the list reorders by how far away things are."}
              </Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                {near.canAskAgain && (
                  <PillButton
                    label="Turn on location"
                    size="sm"
                    onPress={() => near.request()}
                  />
                )}
                <PillButton
                  label="Show newest instead"
                  variant="ghost"
                  size="sm"
                  onPress={() => setSegment("Newest")}
                />
              </View>
            </Card>
          )}

        {loading ? (
          <Loading />
        ) : spots.length === 0 ? (
          query.trim() ? (
            <EmptyState
              icon="search"
              title="No match"
              body={`Nothing in ${t.cityName} matches “${query.trim()}”.`}
            />
          ) : (
            <EmptyState
              icon="location"
              title="Nothing found here yet"
              body={`Spots are places worth the trip. Add the first one in ${t.cityName} and you&apos;re the finder.`}
            >
              <PillButton label="Add the first spot" size="lg" onPress={onAdd} />
            </EmptyState>
          )
        ) : (
          <>
            {coldStart && (
              <Banner
                tone="accent2"
                title="Early days"
                body={`${regionCount} ${regionCount === 1 ? "spot" : "spots"} in ${t.cityName} so far. Add one and you're the finder.`}
              />
            )}
            {spots.map((spot, i) => (
              <SpotRow
                key={spot.spot_id}
                spot={spot}
                rank={ranked ? i + 1 : null}
                distance={
                  near.coords
                    ? formatDistance(
                        near.distanceTo(spot.lat, spot.lng) ?? 0,
                        imperial,
                      )
                    : null
                }
                onPress={() => router.push(`/spot/${spot.spot_id}`)}
              />
            ))}
          </>
        )}
      </ScrollView>

      <View style={s.footer}>
        <PillButton
          label="Add a spot"
          variant="dark"
          icon="add"
          block
          testID="add-spot-btn"
          onPress={onAdd}
        />
      </View>

      <SignInPrompt
        visible={signIn.visible}
        action={signIn.action}
        onClose={signIn.close}
      />
    </Screen>
  );
}

function SpotRow({
  spot,
  rank,
  distance,
  onPress,
}: {
  spot: Spot;
  rank: number | null;
  distance: string | null;
  onPress: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  const meta = [spot.address, spot.best_time, distance].filter(Boolean).join(" · ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spot.name}
      style={s.row}
    >
      {rank !== null && <RankNumeral n={rank} />}
      <View style={s.thumb}>
        {spot.hero_photo_url ? (
          <Image
            source={{ uri: spot.hero_photo_url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={180}
          />
        ) : (
          <Hatch style={StyleSheet.absoluteFill} />
        )}
      </View>

      <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {spot.name}
        </Text>
        {!!meta && <Mono numberOfLines={1}>{meta}</Mono>}
        <View style={s.finderLine}>
          <TierChip tier={spot.finder_tier} label={spot.finder_tier_label} size="sm" />
          <Mono numberOfLines={1}>{spot.finder_name ?? "Around You"}</Mono>
        </View>
        <Text style={s.attribution} numberOfLines={1}>
          {attributionLine(spot)}
        </Text>
      </View>
    </Pressable>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    header: { paddingHorizontal: 20, paddingTop: 10, gap: 10 },
    footer: {
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 12,
      borderTopWidth: 1,
      borderTopColor: t.divider,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 11 },
    thumb: {
      width: 78,
      height: 78,
      borderRadius: radii.md,
      overflow: "hidden",
      backgroundColor: t.neutral[200],
    },
    rowTitle: {
      fontFamily: fonts.bodyBold,
      fontSize: type.bodySm,
      lineHeight: 18,
      color: t.text,
    },
    finderLine: { flexDirection: "row", alignItems: "center", gap: 6 },
    attribution: {
      fontFamily: fonts.bodySemi,
      fontSize: type.micro,
      color: t.accent2Ramp[700],
    },
    cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.bodySm, color: t.text },
    cardBody: {
      fontFamily: fonts.body,
      fontSize: type.bodySm,
      lineHeight: 20,
      color: t.ink(66),
      marginTop: space[1],
    },
  });
}
