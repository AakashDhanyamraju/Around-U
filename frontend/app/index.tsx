import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth";
import { useTheme } from "@/src/theme-context";

export default function Index() {
  const t = useTheme();
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    // Explore is the landing screen signed in or out — browsing needs nothing,
    // so a stranger should not hit a sign-in wall before seeing the city.
    router.replace("/(tabs)");
  }, [user, loading, router]);

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <ActivityIndicator color={t.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
});
