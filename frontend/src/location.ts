/**
 * Where you are, only when you ask.
 *
 * Nothing in this app has ever requested GPS. Prompting on mount — the first
 * time somebody opens Nearby — is the reliable way to earn a permanent "Don't
 * allow", so the system dialog only ever appears from an explicit tap: the
 * "Near me" segment, or "Use my location" while adding a spot.
 *
 * Coordinates are held in module scope for a few minutes and never written to
 * storage. A persisted last-known location is a privacy liability this app has
 * not carried until now and does not need to start carrying.
 */
import * as Location from "expo-location";
import { useCallback, useState } from "react";

export type Coords = { lat: number; lng: number };

export type LocationStatus =
  | "idle"
  | "prompting"
  | "granted"
  | "denied"
  | "unavailable";

export type CoordsResult =
  | { status: "granted"; coords: Coords }
  | { status: "denied"; can_ask_again: boolean }
  | { status: "unavailable"; message: string };

const EARTH_M = 6_371_008.8; // IUGG mean radius
const CACHE_MS = 5 * 60 * 1000;
const FIX_TIMEOUT_MS = 10_000;

let cached: { at: number; coords: Coords } | null = null;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineMetres(a: Coords, b: Coords): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  // Clamp before asin: floating point can push the root a hair above 1, and
  // asin(>1) is NaN.
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance in words. Imperial for the US, because Houston reads miles and the
 * launch city deciding this is better than a global default nobody chose.
 */
export function formatDistance(metres: number, imperial = true): string {
  if (metres < 50) return "here";
  if (imperial) {
    const feet = metres * 3.28084;
    if (feet < 1000) return `${Math.round(feet / 50) * 50} ft`;
    const miles = metres / 1609.344;
    return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
  }
  if (metres < 1000) return `${Math.round(metres / 50) * 50} m`;
  const km = metres / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export async function getCurrentCoords(): Promise<CoordsResult> {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return { status: "granted", coords: cached.coords };
  }

  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Location.requestForegroundPermissionsAsync();
  }
  if (!permission.granted) {
    return { status: "denied", can_ask_again: permission.canAskAgain !== false };
  }

  try {
    // getCurrentPositionAsync can hang indefinitely indoors.
    const fix = await Promise.race([
      // Balanced (~100 m) not High: this renders "1.2 mi", not turn-by-turn,
      // and High costs seconds and battery for precision nobody sees.
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
    ]);
    if (!fix) {
      return { status: "unavailable", message: "Couldn't get a location fix." };
    }
    const coords = { lat: fix.coords.latitude, lng: fix.coords.longitude };
    cached = { at: Date.now(), coords };
    return { status: "granted", coords };
  } catch {
    // On web this is usually an insecure origin: expo-location proxies
    // navigator.geolocation, which needs https or localhost — so a dev server
    // on a plain-http LAN address always lands here.
    return {
      status: "unavailable",
      message: "Location isn't available on this device.",
    };
  }
}

export function useNearMe() {
  const [coords, setCoords] = useState<Coords | null>(cached?.coords ?? null);
  const [status, setStatus] = useState<LocationStatus>(
    cached ? "granted" : "idle",
  );
  const [canAskAgain, setCanAskAgain] = useState(true);

  const request = useCallback(async () => {
    setStatus("prompting");
    const result = await getCurrentCoords();
    if (result.status === "granted") {
      setCoords(result.coords);
      setStatus("granted");
      return;
    }
    setCoords(null);
    if (result.status === "denied") {
      setCanAskAgain(result.can_ask_again);
      setStatus("denied");
    } else {
      setStatus("unavailable");
    }
  }, []);

  const distanceTo = useCallback(
    (lat: number, lng: number): number | null =>
      coords ? haversineMetres(coords, { lat, lng }) : null,
    [coords],
  );

  return { coords, status, canAskAgain, request, distanceTo };
}
