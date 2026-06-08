import React from "react";
import { View, StyleSheet } from "react-native";
import { Post } from "@/src/api";
import { MasonryCard } from "@/src/components/MasonryCard";

type Props = { posts: Post[] };

const HEIGHTS = [220, 280, 240, 300, 230, 270, 260, 290];

export function MasonryGrid({ posts }: Props) {
  const left: { post: Post; height: number; i: number }[] = [];
  const right: { post: Post; height: number; i: number }[] = [];
  posts.forEach((p, idx) => {
    const h = HEIGHTS[idx % HEIGHTS.length];
    if (idx % 2 === 0) left.push({ post: p, height: h, i: idx });
    else right.push({ post: p, height: h, i: idx });
  });
  return (
    <View style={styles.row}>
      <View style={styles.col}>
        {left.map((x) => <MasonryCard key={x.post.post_id} post={x.post} height={x.height} index={x.i} />)}
      </View>
      <View style={styles.col}>
        {right.map((x) => <MasonryCard key={x.post.post_id} post={x.post} height={x.height} index={x.i} />)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", paddingHorizontal: 16, gap: 12 },
  col: { flex: 1 },
});
