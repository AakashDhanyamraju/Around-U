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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  content: { paddingHorizontal: 16, gap: 8, alignItems: "center", height: 56 },
  chip: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: colors.secondary, borderColor: colors.secondary },
  chipInactive: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
  chipText: { fontSize: 13, fontFamily: fonts.bodySemi },
  chipTextActive: { color: "#FFFFFF" },
  chipTextInactive: { color: colors.textSecondary },
});
