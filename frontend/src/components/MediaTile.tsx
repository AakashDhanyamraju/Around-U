import React, { useEffect, useState } from "react";
import {
  View,
  Pressable,
  StyleSheet,
  StyleProp,
  ViewStyle,
  ImageStyle,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { Ionicons } from "@expo/vector-icons";

import { Post } from "@/src/api";

type Props = {
  post: Post;
  style?: StyleProp<ViewStyle>;
  autoPlay?: boolean;
  showMute?: boolean;
  contentFit?: "cover" | "contain";
};

/**
 * Renders post media: autoplaying muted looping video for `media_type: "video"`,
 * otherwise a still image. The poster image overlays the video and only hides
 * once real playback frames arrive — so it stays as a graceful fallback when
 * the video can't load (e.g. web preview / offline).
 */
export function MediaTile({
  post,
  style,
  autoPlay = true,
  showMute = false,
  contentFit = "cover",
}: Props) {
  const isVideo = post.media_type === "video" && !!post.video_url;
  const [muted, setMuted] = useState(true);
  const [hasFrames, setHasFrames] = useState(false);

  const player = useVideoPlayer(isVideo ? post.video_url! : null, (p) => {
    if (!isVideo) return;
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 0.5;
    if (autoPlay) p.play();
  });

  useEffect(() => {
    if (!isVideo) return;
    const sub = player.addListener("timeUpdate", ({ currentTime }) => {
      if (currentTime > 0) setHasFrames(true);
    });
    return () => sub.remove();
  }, [isVideo, player]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    try {
      player.muted = next;
      if (!next && autoPlay) player.play();
    } catch {
      // player may not be ready yet
    }
  };

  if (!isVideo) {
    return (
      <Image
        source={{ uri: post.image }}
        // Callers pass layout styles that are valid for both a View and an
        // Image; the types differ only in ViewStyle allowing overflow:"scroll",
        // which is never used here.
        style={[StyleSheet.absoluteFillObject, style as StyleProp<ImageStyle>]}
        contentFit={contentFit}
        transition={250}
      />
    );
  }

  // expo-video web playback is unreliable and external video can't load in the
  // web preview — show the poster (with a play badge) on web; full video on native.
  if (Platform.OS === "web") {
    return (
      <View style={[StyleSheet.absoluteFillObject, style]}>
        <Image
          source={{ uri: post.image }}
          style={StyleSheet.absoluteFillObject}
          contentFit={contentFit}
          transition={250}
        />
        <View style={styles.webPlay} pointerEvents="none">
          <Ionicons name="play" size={22} color="#fff" />
        </View>
      </View>
    );
  }

  return (
    <View style={[StyleSheet.absoluteFillObject, style]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFillObject}
        contentFit={contentFit}
        nativeControls={false}
        pointerEvents="none"
      />
      {/* poster overlay — hidden only once the video produces frames */}
      {!hasFrames && (
        <Image
          source={{ uri: post.image }}
          style={[StyleSheet.absoluteFillObject, styles.poster]}
          contentFit={contentFit}
          transition={200}
          pointerEvents="none"
        />
      )}
      {showMute && (
        <Pressable
          testID={`mute-toggle-${post.post_id}`}
          onPress={(e) => {
            e.stopPropagation?.();
            toggleMute();
          }}
          hitSlop={10}
          style={styles.muteBtn}
        >
          <Ionicons name={muted ? "volume-mute" : "volume-high"} size={16} color="#fff" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  poster: { zIndex: 2 },
  webPlay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -26,
    marginLeft: -26,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 3,
  },
  muteBtn: {
    position: "absolute",
    bottom: 14,
    right: 14,
    zIndex: 3,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
});
