import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api, Creator } from "@/src/api";
import { colors, fonts, radii, CATEGORIES } from "@/src/theme";

export default function AdminScreen() {
  const router = useRouter();
  const [creators, setCreators] = useState<Creator[]>([]);
  const [mode, setMode] = useState<"post" | "creator">("post");
  const [status, setStatus] = useState<string>("");

  // post form
  const [creatorId, setCreatorId] = useState("");
  const [image, setImage] = useState("");
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState("Food");
  const [neighborhood, setNeighborhood] = useState("");
  const [locationName, setLocationName] = useState("");

  // creator form
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");

  useEffect(() => {
    api<Creator[]>("/creators", { auth: false }).then((c) => {
      setCreators(c);
      if (c[0]) setCreatorId(c[0].creator_id);
    });
  }, []);

  const submitPost = async () => {
    setStatus("");
    if (!creatorId || !image || !caption || !neighborhood) {
      setStatus("Please fill creator, image url, caption and neighborhood.");
      return;
    }
    try {
      await api("/admin/posts", {
        method: "POST",
        auth: false,
        body: {
          creator_id: creatorId,
          image,
          caption,
          category,
          neighborhood,
          location_name: locationName || null,
        },
      });
      setStatus("✓ Post added. Pull to refresh the feed.");
      setImage("");
      setCaption("");
      setNeighborhood("");
      setLocationName("");
    } catch (e: any) {
      setStatus("Failed: " + e.message);
    }
  };

  const submitCreator = async () => {
    setStatus("");
    if (!handle || !name || !avatar) {
      setStatus("Please fill handle, name and avatar url.");
      return;
    }
    try {
      const c = await api<Creator>("/admin/creators", {
        method: "POST",
        auth: false,
        body: { handle, name, bio, avatar, categories: [category] },
      });
      setStatus("✓ Creator added: " + c.name);
      const refreshed = await api<Creator[]>("/creators", { auth: false });
      setCreators(refreshed);
      setHandle("");
      setName("");
      setBio("");
      setAvatar("");
    } catch (e: any) {
      setStatus("Failed: " + e.message);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} testID="back-btn" style={styles.back}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>Submit</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.tabs}>
        <Pressable
          testID="tab-post"
          style={[styles.tab, mode === "post" && styles.tabActive]}
          onPress={() => setMode("post")}
        >
          <Text style={[styles.tabText, mode === "post" && styles.tabTextActive]}>New post</Text>
        </Pressable>
        <Pressable
          testID="tab-creator"
          style={[styles.tab, mode === "creator" && styles.tabActive]}
          onPress={() => setMode("creator")}
        >
          <Text style={[styles.tabText, mode === "creator" && styles.tabTextActive]}>New creator</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        {mode === "post" ? (
          <>
            <Label>Creator</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.creatorRow}>
              {creators.map((c) => (
                <Pressable
                  key={c.creator_id}
                  testID={`pick-creator-${c.creator_id}`}
                  onPress={() => setCreatorId(c.creator_id)}
                  style={[styles.creatorChip, creatorId === c.creator_id && styles.creatorChipActive]}
                >
                  <Text style={[styles.creatorChipText, creatorId === c.creator_id && { color: "#fff" }]}>
                    {c.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Label>Image URL</Label>
            <Field testID="post-image" value={image} onChangeText={setImage} placeholder="https://..." />

            <Label>Caption</Label>
            <Field testID="post-caption" value={caption} onChangeText={setCaption} placeholder="What's the story?" multiline />

            <Label>Category</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.creatorRow}>
              {CATEGORIES.filter((c) => c !== "All").map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  style={[styles.creatorChip, category === c && styles.creatorChipActive]}
                >
                  <Text style={[styles.creatorChipText, category === c && { color: "#fff" }]}>{c}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Label>Neighborhood</Label>
            <Field testID="post-neighborhood" value={neighborhood} onChangeText={setNeighborhood} placeholder="e.g. Montrose" />

            <Label>Location name (optional)</Label>
            <Field testID="post-location" value={locationName} onChangeText={setLocationName} placeholder="e.g. Discovery Green" />

            <Pressable testID="submit-post-btn" onPress={submitPost} style={styles.submit}>
              <Text style={styles.submitText}>Publish post</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Label>Handle</Label>
            <Field testID="cr-handle" value={handle} onChangeText={setHandle} placeholder="@local.creator" />
            <Label>Name</Label>
            <Field testID="cr-name" value={name} onChangeText={setName} placeholder="Display name" />
            <Label>Bio</Label>
            <Field testID="cr-bio" value={bio} onChangeText={setBio} placeholder="One line about them" multiline />
            <Label>Avatar URL</Label>
            <Field testID="cr-avatar" value={avatar} onChangeText={setAvatar} placeholder="https://..." />

            <Pressable testID="submit-creator-btn" onPress={submitCreator} style={styles.submit}>
              <Text style={styles.submitText}>Add creator</Text>
            </Pressable>
          </>
        )}

        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Label({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

function Field(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      {...props}
      placeholderTextColor={colors.textMuted}
      style={[styles.input, props.multiline && { height: 80, textAlignVertical: "top" }]}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8 },
  back: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.displayXL, fontSize: 20, color: colors.textPrimary },
  tabs: { flexDirection: "row", paddingHorizontal: 20, gap: 8, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radii.pill, alignItems: "center", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.secondary, borderColor: colors.secondary },
  tabText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.textSecondary },
  tabTextActive: { color: "#fff" },
  form: { padding: 20, gap: 6, paddingBottom: 60 },
  label: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.textSecondary, letterSpacing: 1, marginTop: 12, textTransform: "uppercase" },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 12, fontFamily: fonts.body, fontSize: 14, color: colors.textPrimary },
  creatorRow: { gap: 8, paddingVertical: 4 },
  creatorChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  creatorChipActive: { backgroundColor: colors.secondary, borderColor: colors.secondary },
  creatorChipText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.textSecondary },
  submit: { marginTop: 20, height: 50, borderRadius: radii.pill, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  submitText: { color: "#fff", fontFamily: fonts.bodyBold, fontSize: 15 },
  status: { marginTop: 14, fontFamily: fonts.bodyMed, color: colors.secondary, textAlign: "center" },
});
