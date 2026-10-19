/**
 * Pick a photo and put it on Cloudinary. The first real upload path in the app.
 *
 * The backend only signs the request — `POST /uploads/signature` returns a
 * signature over `{folder, timestamp}` and the bytes go straight from the device
 * to Cloudinary. That keeps large files off the API process and the API secret
 * off the device.
 *
 * Nothing here throws. Cancelling a picker is not an error, a denied permission
 * is not an error, and the three call sites each want to render a different
 * thing — so the outcome is a union and the caller switches on it. Throwing
 * would push every caller into a catch block that string-matches the message,
 * which is a smell `auth.tsx` already has and this should not copy.
 */
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

import { api, UploadSignature } from "@/src/api";

export type UploadedImage = { url: string; width?: number; height?: number };

export type UploadOutcome =
  | { status: "uploaded"; image: UploadedImage }
  | { status: "cancelled" }
  | { status: "denied"; can_ask_again: boolean }
  | { status: "failed"; message: string };

/** 10 MB. Checked before the upload starts, not after sixty seconds of it. */
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

export async function pickAndUploadImage(
  opts: { folder?: string } = {},
): Promise<UploadOutcome> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    // On web this never fires — the file input is the permission gate — so any
    // UI built for this branch is native-only.
    return { status: "denied", can_ask_again: permission.canAskAgain !== false };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    // iOS's crop UI forces a square unless `aspect` is set, and spots are
    // landscape more often than not.
    allowsEditing: false,
    quality: 0.8,
    // Spot photos are of *places*. Shipping the photographer's original GPS and
    // timestamp to a public CDN URL would leak their movements, and the spot
    // already carries its own coordinates.
    exif: false,
  });

  if (result.canceled) return { status: "cancelled" };

  const asset = result.assets?.[0];
  if (!asset) return { status: "failed", message: "No photo was selected." };

  const size = asset.fileSize ?? (asset as { file?: File }).file?.size;
  if (size != null && size > MAX_BYTES) {
    return { status: "failed", message: "That photo's too big. Try a smaller one." };
  }

  return uploadAsset(asset, opts.folder ?? "spots");
}

async function uploadAsset(
  asset: ImagePicker.ImagePickerAsset,
  folder: string,
): Promise<UploadOutcome> {
  let signature: UploadSignature;
  try {
    // `folder` is a query parameter on the FastAPI handler, not a body field —
    // sending it in a body would be silently ignored and everything would land
    // in the root folder.
    signature = await api<UploadSignature>(
      `/uploads/signature?folder=${encodeURIComponent(folder)}`,
      { method: "POST" },
    );
  } catch (e) {
    // 503 here means Cloudinary is unconfigured, and that detail is readable.
    return {
      status: "failed",
      message: e instanceof Error ? e.message : "Could not start the upload.",
    };
  }

  const name = asset.fileName || `spot-${signature.timestamp}.jpg`;
  const form = new FormData();
  form.append("api_key", signature.api_key);
  form.append("timestamp", String(signature.timestamp));
  form.append("signature", signature.signature);
  // The folder the SERVER returned, which is prefixed (`around-you/spots`).
  // Echoing the literal "spots" produces an invalid signature, and it is the
  // single easiest thing in this file to get wrong.
  form.append("folder", signature.folder);

  if (Platform.OS === "web") {
    // `asset.uri` is a blob:/data: URL here. Appending {uri,name,type} would
    // serialise to "[object Object]" and Cloudinary answers 400 with no clue.
    const picked = (asset as { file?: Blob }).file;
    const blob: Blob = picked ?? (await fetch(asset.uri).then((r) => r.blob()));
    // The three-argument form is DOM-only; React Native's own FormData type
    // declares just two, so the call is widened rather than the value cast.
    (form as unknown as {
      append(name: string, value: Blob, fileName: string): void;
    }).append("file", blob, name);
  } else {
    // React Native's FormData understands this shape and streams off disk.
    form.append("file", {
      uri: asset.uri,
      name,
      type: asset.mimeType ?? "image/jpeg",
    } as unknown as Blob);
  }

  // fetch has no timeout in React Native, so a large photo on a bad connection
  // would leave the button spinning forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Never set Content-Type by hand: the platform adds the multipart boundary,
    // and naming the type without one makes Cloudinary reject the body.
    // Never route this through api() either — wrong host, and it would attach
    // our bearer token to a third party.
    const res = await fetch(signature.upload_url, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      // Cloudinary's own error names the cloud and the folder; never surface it.
      return {
        status: "failed",
        message:
          res.status === 401
            ? "That upload expired. Try again."
            : "Could not upload that photo. Try again.",
      };
    }

    const json = (await res.json()) as {
      secure_url?: string;
      width?: number;
      height?: number;
    };
    if (!json.secure_url) {
      return { status: "failed", message: "Could not upload that photo. Try again." };
    }
    return {
      status: "uploaded",
      image: { url: json.secure_url, width: json.width, height: json.height },
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      status: "failed",
      message: aborted
        ? "That took too long. Try again on a better connection."
        : "Could not reach the photo service. Check your connection.",
    };
  } finally {
    clearTimeout(timer);
  }
}
