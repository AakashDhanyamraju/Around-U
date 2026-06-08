import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Creator } from "@/src/api";
import { colors, fonts, CATEGORIES } from "@/src/theme";
import {
  getAdminKey,
  adminGetPost,
  adminListCreators,
  adminUpdatePost,
  adminDeletePost,
  isAuthError,
} from "@/src/admin";
import { Label, Field, ChipRow, ToggleRow, PrimaryButton, StatusText } from "@/src/components/admin/Fields";

export default function EditPost() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [adminKey, setKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [creators, setCreators] = useState<Creator[]>([]);

  const [creatorId, setCreatorId] = useState("");
  const [image, setImage] = useState("");
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState("Food");
  const [neighborhood, setNeighborhood] = useState("");
  const [locationName, setLocationName] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [videoUrl, setVideoUrl] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [sponsored, setSponsored] = useState(false);

  useEffect(() => {
    (async () => {
      const k = (await getAdminKey()) || "";
      if (!k) {
        router.replace("/admin");
        return;
      }
      setKey(k);
      try {
        const [{ post }, cs] = await Promise.all([adminGetPost(id), adminListCreators()]);
        setCreators(cs);
        setCreatorId(post.creator_id);
        setImage(post.image);
        setCaption(post.caption);
        setCategory(post.category);
        setNeighborhood(post.neighborhood);
        setLocationName(post.location_name || "");
        setMediaType((post.media_type as "image" | "video") || "image");
        setVideoUrl(post.video_url || "");
        setHashtags((post.hashtags || []).join(", "));
        setSponsored(!!post.is_sponsored);
      } catch {
        setStatus("Couldn't load post.");
      }
      setLoading(false);
    })();
  }, [id]);

  const save = async () => {
    setStatus("");
    if (!image || !caption || !neighborhood) {
      setStatus("Image, caption and neighborhood are required.");
      return;
    }
    setSaving(true);
    try {
      await adminUpdatePost(adminKey, id, {
        creator_id: creatorId,
        image,
        caption,
        category,
        neighborhood,
        location_name: locationName || null,
        media_type: mediaType,
        video_url: mediaType === "video" ? videoUrl : null,
        hashtags: hashtags
          .split(",")
          .map((h) => h.trim().replace(/^#/, ""))
          .filter(Boolean),
        is_sponsored: sponsored,
      });
      setStatus("✓ Saved.");
      setTimeout(() => router.back(), 500);
    } catch (e: any) {
      setStatus(isAuthError(e) ? "Invalid admin key." : "Failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    Alert.alert("Delete post", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await adminDeletePost(adminKey, id);
            router.back();
          } catch (e: any) {
            Alert.alert("Failed", e.message || "Could not delete");
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Edit post</Text>
        <Pressable onPress={remove} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="trash-outline" size={20} color="#D14E22" />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 50 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <Label>Creator</Label>
          <ChipRow
            options={creators.map((c) => ({ label: c.name, value: c.creator_id }))}
            selected={creatorId}
            onSelect={setCreatorId}
          />
          <Label>Media type</Label>
          <ChipRow
            options={[
              { label: "Image", value: "image" },
              { label: "Video", value: "video" },
            ]}
            selected={mediaType}
            onSelect={(v) => setMediaType(v as "image" | "video")}
          />
          <Label>{mediaType === "video" ? "Poster image URL" : "Image URL"}</Label>
          <Field value={image} onChangeText={setImage} placeholder="https://..." autoCapitalize="none" />
          {mediaType === "video" && (
            <>
              <Label>Video URL (mp4)</Label>
              <Field value={videoUrl} onChangeText={setVideoUrl} placeholder="https://...mp4" autoCapitalize="none" />
            </>
          )}
          <Label>Caption</Label>
          <Field value={caption} onChangeText={setCaption} placeholder="Caption" multiline />
          <Label>Category</Label>
          <ChipRow
            options={CATEGORIES.filter((c) => c !== "All").map((c) => ({ label: c, value: c }))}
            selected={category}
            onSelect={setCategory}
          />
          <Label>Neighborhood</Label>
          <Field value={neighborhood} onChangeText={setNeighborhood} placeholder="e.g. Montrose" />
          <Label>Location name (optional)</Label>
          <Field value={locationName} onChangeText={setLocationName} placeholder="e.g. Discovery Green" />
          <Label>Hashtags (comma separated)</Label>
          <Field value={hashtags} onChangeText={setHashtags} placeholder="Houston, ThingsToDo" autoCapitalize="none" />
          <ToggleRow label="Sponsored post" value={sponsored} onValueChange={setSponsored} />
          <StatusText text={status} />
          <View style={{ height: 18 }} />
          <PrimaryButton label="Save changes" onPress={save} loading={saving} testID="save-post" />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontFamily: fonts.display, fontSize: 18, color: colors.textPrimary },
});
