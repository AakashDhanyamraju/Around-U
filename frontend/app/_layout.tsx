import React, { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useFonts } from "expo-font";
import { Caprasimo_400Regular } from "@expo-google-fonts/caprasimo";
import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from "@expo-google-fonts/figtree";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/auth";
import { CommunityProvider } from "@/src/community-context";
import { SocialProvider } from "@/src/social";
import { SpotsProvider } from "@/src/spots-context";
import { ThemeProvider, useTheme } from "@/src/theme-context";

SplashScreen.preventAutoHideAsync();

/** Split out so the stack can read the active city's background colour. */
function ThemedStack() {
  const t = useTheme();
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.bg },
        }}
      />
    </>
  );
}

export default function RootLayout() {
  const [iconsLoaded, iconErr] = useIconFonts();
  const [textFontsLoaded] = useFonts({
    // Caprasimo has one weight — headings get their emphasis from size.
    Caprasimo_400Regular,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });

  const ready = (iconsLoaded || iconErr) && textFontsLoaded;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          {/* Below auth: the palette follows the signed-in user's home region. */}
          <ThemeProvider>
            <SocialProvider>
              <CommunityProvider>
                {/* Innermost: it only needs auth and the active region. */}
                <SpotsProvider>
                  <ThemedStack />
                </SpotsProvider>
              </CommunityProvider>
            </SocialProvider>
          </ThemeProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
