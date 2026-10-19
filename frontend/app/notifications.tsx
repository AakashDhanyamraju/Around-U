/**
 * The in-app inbox.
 *
 * Without somewhere for "someone appreciated your spot" to land, the whole rank
 * ladder is an invisible progress bar. This is the cheapest delivery that makes
 * it visible: a dot on the account row, cleared when you open this.
 *
 * No timers and no sockets. The count refreshes on mount, on sign-in, and when
 * Explore regains focus. A dot that appears next time you open the app is enough
 * for this product, and a `setInterval` in a provider is a battery drain and a
 * source of flaky tests.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppNotification } from "@/src/api";
import { useAuth } from "@/src/auth";
import {
  EmptyState,
  Loading,
  Mono,
  PillButton,
  Screen,
  ScreenTitle,
} from "@/src/components/organic";
import { listNotifications, markAllRead, renderNotification } from "@/src/spots";
import { useSpots } from "@/src/spots-context";
import { fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

export default function NotificationsScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const { user } = useAuth();
  const { clearUnread } = useSpots();

  const [rows, setRows] = useState<AppNotification[]>([]);
  // Captured on first load so a row's emphasis does not change under the
  // reader's finger the moment the inbox marks everything read.
  const [wasUnread, setWasUnread] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (first: boolean) => {
      if (!user) return;
      const body = await listNotifications();
      setRows(body.notifications);
      if (first) {
        setWasUnread(
          new Set(
            body.notifications.filter((n) => !n.read_at).map((n) => n.notification_id),
          ),
        );
        if (body.unread_count > 0) {
          await markAllRead();
          clearUnread();
        }
      }
    },
    [user, clearUnread],
  );

  useEffect(() => {
    load(true)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [load]);

  if (!user) {
    return (
      <Screen>
        <TopBar />
        <View style={s.guest}>
          <Text style={s.guestTitle}>Not signed in</Text>
          <Text style={s.guestBody}>
            This is where you hear that someone went to a spot you found.
          </Text>
          <PillButton
            label="Continue with email"
            size="lg"
            onPress={() => router.replace("/login")}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar />
      <View style={{ paddingHorizontal: 20, paddingBottom: 6 }}>
        <ScreenTitle>Notifications</ScreenTitle>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 10, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        testID="notifications-scroll"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              try {
                await load(false);
              } catch {
                // Keep what is on screen.
              } finally {
                setRefreshing(false);
              }
            }}
            tintColor={t.accent}
          />
        }
      >
        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="notifications-outline"
            title="Nothing yet"
            body="When someone goes to a spot you found, or appreciates it, it&apos;ll show up here."
          />
        ) : (
          rows.map((n) => (
            <NotificationRow
              key={n.notification_id}
              notification={n}
              fresh={wasUnread.has(n.notification_id)}
              onPress={() => {
                const href = renderNotification(n).href;
                if (href) router.push(href as never);
              }}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function NotificationRow({
  notification,
  fresh,
  onPress,
}: {
  notification: AppNotification;
  fresh: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const rendered = renderNotification(notification);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={rendered.body}
      style={[s.row, fresh && { backgroundColor: t.accentRamp[100] }]}
    >
      <View style={s.icon}>
        {notification.actor_picture ? (
          <Image
            source={{ uri: notification.actor_picture }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        ) : (
          <Ionicons name={rendered.icon} size={17} color={t.accentRamp[700]} />
        )}
      </View>
      <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
        <Text style={s.body}>{rendered.body}</Text>
        <Mono>{relativeTime(notification.created_at)}</Mono>
      </View>
      {fresh && <View style={s.dot} />}
    </Pressable>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

function TopBar() {
  const t = useTheme();
  const router = useRouter();
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={22} color={t.text} />
      </Pressable>
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      padding: 12,
      borderRadius: radii.md,
    },
    icon: {
      width: 38,
      height: 38,
      borderRadius: radii.pill,
      overflow: "hidden",
      backgroundColor: t.accentRamp[100],
      alignItems: "center",
      justifyContent: "center",
    },
    body: {
      fontFamily: fonts.body,
      fontSize: type.bodySm,
      lineHeight: 20,
      color: t.text,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: radii.pill,
      backgroundColor: t.accent,
    },
    guest: { paddingHorizontal: 22, paddingTop: 12, gap: 12, alignItems: "flex-start" },
    guestTitle: { fontFamily: fonts.heading, fontSize: 22, color: t.text },
    guestBody: {
      fontFamily: fonts.body,
      fontSize: type.body,
      lineHeight: 22,
      color: t.ink(62),
      marginBottom: space[1],
    },
  });
}
