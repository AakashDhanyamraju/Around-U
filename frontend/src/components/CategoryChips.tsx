import React from "react";
import { ScrollView, Pressable, Text, StyleSheet, View } from "react-native";
import { colors, fonts, radii } from "@/src/theme";

type Props = {
  categories: string[];
  selected: string;
  onSelect: (c: string) => void;
};

export function CategoryChips({ categories, selected, onSelect }: Props) {
  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        testID="category-chips-row"
      >
        {categories.map((c) => {
          const active = c === selected;
          return (
            <Pressable
              key={c}
              testID={`category-${c.toLowerCase().replace(/\s+/g, "-")}`}
              onPress={() => onSelect(c)}
              style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
            >
              <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextInactive]}>
                {c}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 56,
    backgroundColor: colors.background,
  },
  content: { paddingHorizontal: 16, gap: 8, alignItems: "center", height: 56 },
  chip: {
    height: 38,
    paddingHorizontal: 18,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary, shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  chipInactive: { backgroundColor: colors.surface, borderColor: colors.border },
  chipText: { fontSize: 13, fontFamily: fonts.bodySemi },
  chipTextActive: { color: "#FFFFFF" },
  chipTextInactive: { color: colors.textSecondary },
});
