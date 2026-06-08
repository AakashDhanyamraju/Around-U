import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { colors, fonts, CATEGORIES } from "@/src/theme";
import {
  getAdminKey,
  adminGetCreator,
  adminUpdateCreator,
  adminDeleteCreator,
  isAuthError,
} from "@/src/admin";
import { Label, Field, ChipRow, PrimaryButton, StatusText } from "@/src/components/admin/Fields";

export default function EditCreator() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [adminKey, setKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");
  const [category, setCategory] = useState("Food");

  useEffect(() => {
    (async () => {
      const k = (await getAdminKey()) || "";
      setKey(k);
      try {
        const { creator } = await adminGetCreator(id);
        setHandle(creator.handle);
        setName(creator.name);
        setBio(creator.bio);
        setAvatar(creator.avatar);
        if (creator.categories && creator.categories[0]) setCategory(creator.categories[0]);
      } catch {
        setStatus("Couldn't load creator.");
      }
      setLoading(false);
    })();
  }, [id]);

  const save = async () => {
    setStatus("");
    if (!handle || !name || !avatar) {
      setStatus("Handle, name and avatar are required.");
      return;
    }
    setSaving(true);
    try {
      await adminUpdateCreator(adminKey, id, { handle, name, bio, avatar, categories: [category] });
      setStatus("✓ Saved.");
      setTimeout(() => router.back(), 500);
    } catch (e: any) {
      setStatus(isAuthError(e) ? "Invalid admin key." : "Failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    Alert.alert("Delete creator", "This also deletes all of their posts.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await adminDeleteCreator(adminKey, id);
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
        <Text style={styles.headerTitle}>Edit creator</Text>
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
          <Label>Handle</Label>
          <Field value={handle} onChangeText={setHandle} placeholder="@handle" autoCapitalize="none" />
          <Label>Name</Label>
          <Field value={name} onChangeText={setName} placeholder="Creator name" />
          <Label>Bio</Label>
          <Field value={bio} onChangeText={setBio} placeholder="Short bio" multiline />
          <Label>Avatar URL</Label>
          <Field value={avatar} onChangeText={setAvatar} placeholder="https://..." autoCapitalize="none" />
          <Label>Primary category</Label>
          <ChipRow
            options={CATEGORIES.filter((c) => c !== "All").map((c) => ({ label: c, value: c }))}
            selected={category}
            onSelect={setCategory}
          />
          <StatusText text={status} />
          <View style={{ height: 18 }} />
          <PrimaryButton label="Save changes" onPress={save} loading={saving} testID="save-creator" />
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
