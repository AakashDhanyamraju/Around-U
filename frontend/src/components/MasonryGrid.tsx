import React from "react";
import { View, StyleSheet } from "react-native";
import { Post } from "@/src/api";
import { MasonryCard } from "@/src/components/MasonryCard";

type Props = { posts: Post[] };

const HEIGHTS = [200, 250, 220, 280, 210, 260, 230, 270];

export function MasonryGrid({ posts }: Props) {
  const left: { post: Post; height: number }[] = [];
  const right: { post: Post; height: number }[] = [];
  posts.forEach((p, idx) => {
    const h = HEIGHTS[idx % HEIGHTS.length];
    if (idx % 2 === 0) left.push({ post: p, height: h });
    else right.push({ post: p, height: h });
  });
  return (
    <View style={styles.row}>
      <View style={styles.col}>
        {left.map((x) => (
          <MasonryCard key={x.post.post_id} post={x.post} height={x.height} />
        ))}
      </View>
      <View style={styles.col}>
        {right.map((x) => (
          <MasonryCard key={x.post.post_id} post={x.post} height={x.height} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", paddingHorizontal: 12, gap: 10 },
  col: { flex: 1 },
});
