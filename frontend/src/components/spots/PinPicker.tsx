/**
 * Where is it — a coordinate picker with no map tiles.
 *
 * Nearby's backdrop is drawn rather than tiled specifically to avoid a native
 * map dependency and an API key for scenery. That decision holds here, which
 * leaves one real problem: **a drawn box has no projection, so a tap means
 * nothing unless you define one.**
 *
 * So it defines one. The box is a fixed linear window around the region centre —
 * about 20 km across Houston — which makes a tap land within a few hundred
 * metres of intent. That is enough to place a spot you are standing near, and
 * far kinder than typing decimals. The label under it says "rough" because it is.
 *
 * Two honest limits: a region with no centre coordinates falls back to
 * coordinates-only rather than projecting around 0,0 (the Atlantic), and there
 * is no geocoding, so you cannot type "Rothko Chapel" and get a pin.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Region } from "@/src/api";
import { Mono, OrganicInput, PillButton } from "@/src/components/organic";
import { Coords, getCurrentCoords } from "@/src/location";
import { fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

/** Degrees of latitude/longitude the drawn box spans. ~20 km at Houston. */
const SPAN = 0.18;
const BOX_HEIGHT = 210;

export function PinPicker({
  region,
  value,
  onChange,
}: {
  region: Region | null;
  value: Coords | null;
  onChange: (coords: Coords) => void;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const [size, setSize] = useState({ width: 0, height: BOX_HEIGHT });
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const centre =
    region?.center_lat != null && region?.center_lng != null
      ? { lat: region.center_lat, lng: region.center_lng }
      : null;

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    });

  const toCoords = (x: number, y: number): Coords | null => {
    if (!centre || !size.width) return null;
    return {
      lat: centre.lat + (0.5 - y / size.height) * SPAN,
      lng: centre.lng + (x / size.width - 0.5) * SPAN,
    };
  };

  const toPoint = (c: Coords) => {
    if (!centre || !size.width) return null;
    return {
      left: (0.5 + (c.lng - centre.lng) / SPAN) * size.width,
      top: (0.5 - (c.lat - centre.lat) / SPAN) * size.height,
    };
  };

  const useMyLocation = async () => {
    setLocating(true);
    setLocationNote(null);
    const result = await getCurrentCoords();
    setLocating(false);
    if (result.status === "granted") {
      onChange(result.coords);
      return;
    }
    setLocationNote(
      result.status === "denied"
        ? "Location is off. Tap the map instead, or type the coordinates."
        : result.message,
    );
    setManual(true);
  };

  const point = value ? toPoint(value) : null;

  return (
    <View style={{ gap: 8 }}>
      {centre ? (
        <Pressable
          onLayout={onLayout}
          onPress={(e) => {
            const c = toCoords(e.nativeEvent.locationX, e.nativeEvent.locationY);
            if (c) onChange(c);
          }}
          accessibilityRole="button"
          accessibilityLabel="Place the pin"
          style={s.box}
        >
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={`h${i}`} style={[s.gridLine, { top: (i + 1) * 30 }]} />
            ))}
            {Array.from({ length: 7 }).map((_, i) => (
              <View key={`v${i}`} style={[s.gridLineV, { left: (i + 1) * 46 }]} />
            ))}
          </View>

          {point && (
            <View
              pointerEvents="none"
              style={[s.pin, { left: point.left - 13, top: point.top - 26 }]}
            >
              <Ionicons name="location" size={26} color={t.accent} />
            </View>
          )}

          {!value && (
            <View style={s.hint} pointerEvents="none">
              <Text style={s.hintText}>Tap where it is</Text>
            </View>
          )}
        </Pressable>
      ) : (
        <Mono>This city has no map centre yet — use your location or coordinates.</Mono>
      )}

      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <PillButton
          label={locating ? "Locating" : "Use my location"}
          icon="navigate-outline"
          variant="soft"
          size="sm"
          busy={locating}
          onPress={useMyLocation}
        />
        <PillButton
          label={manual ? "Hide coordinates" : "Type coordinates"}
          variant="ghost"
          size="sm"
          onPress={() => setManual((m) => !m)}
        />
      </View>

      {!!locationNote && <Mono>{locationNote}</Mono>}

      {manual && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <OrganicInput
            style={{ flex: 1 }}
            placeholder="Latitude"
            keyboardType="numbers-and-punctuation"
            defaultValue={value ? String(value.lat) : ""}
            onChangeText={(v) => {
              const lat = Number(v);
              if (Number.isFinite(lat) && v.trim()) {
                onChange({ lat, lng: value?.lng ?? centre?.lng ?? 0 });
              }
            }}
          />
          <OrganicInput
            style={{ flex: 1 }}
            placeholder="Longitude"
            keyboardType="numbers-and-punctuation"
            defaultValue={value ? String(value.lng) : ""}
            onChangeText={(v) => {
              const lng = Number(v);
              if (Number.isFinite(lng) && v.trim()) {
                onChange({ lat: value?.lat ?? centre?.lat ?? 0, lng });
              }
            }}
          />
        </View>
      )}

      {value ? (
        <Mono>
          {`rough — ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}. Tap to move it.`}
        </Mono>
      ) : (
        <Mono>A spot needs a location before you can add it.</Mono>
      )}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    box: {
      height: BOX_HEIGHT,
      borderRadius: radii.md,
      overflow: "hidden",
      backgroundColor: t.accent2Ramp[100],
    },
    gridLine: {
      position: "absolute",
      left: 0,
      right: 0,
      height: 1,
      backgroundColor: t.accent2Ramp[200],
    },
    gridLineV: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: 1,
      backgroundColor: t.accent2Ramp[200],
    },
    pin: { position: "absolute" },
    hint: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
    },
    hintText: {
      fontFamily: fonts.bodySemi,
      fontSize: type.bodySm,
      color: t.accent2Ramp[700],
    },
    spacer: { height: space[2] },
  });
}
