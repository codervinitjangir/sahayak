import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import RootNavigator from "./src/navigation/RootNavigator";
import { AppDialogHost } from "./src/components/ui/AppDialog";
import AppLaunchSequence from "./src/components/splash/AppLaunchSequence";
import { Colors } from "./src/constants/theme";
import { useAuthStore } from "./src/store/authStore";

// Keep native splash screen visible until our identical JS layer takes over
SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

// Cached server data belongs to whoever was signed in. Drop all of it when the
// account changes (logout, or a different number signing in on the same phone),
// or the next person sees the previous one's vehicles, jobs and notifications
// for up to staleTime before the refetch replaces them.
useAuthStore.subscribe((state, prev) => {
  if (state.user?.id !== prev.user?.id || (prev.isAuthenticated && !state.isAuthenticated)) {
    queryClient.clear();
  }
});

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Sahayak App Crash:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Sahayak Error</Text>
          <Text style={styles.errorMsg}>
            {this.state.error?.message || "Unknown runtime error occurred"}
          </Text>
          <Text style={styles.errorStack}>
            {this.state.error?.stack?.slice(0, 300)}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [splashFinished, setSplashFinished] = useState(false);

  // Restore the persisted Supabase session, and follow it from here on. Mounted at
  // the root and exactly once: the subscription has to outlive any single screen,
  // because token refreshes arrive while the user is deep in a job, and a
  // per-screen listener would unsubscribe the moment they navigated away.
  const initSession = useAuthStore((s) => s.initSession);
  useEffect(() => initSession(), [initSession]);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider style={styles.flex}>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <StatusBar style="auto" />
            {(fontsLoaded || fontError) && <RootNavigator />}
            <AppDialogHost />

            {/* ── SAHAYAK OPENING LAUNCH SEQUENCE (REVEALS FIRST SCREEN AT 1.76s) ── */}
            {Platform.OS !== "web" && !splashFinished && (
              <AppLaunchSequence
                isReady={fontsLoaded || !!fontError}
                onAnimationComplete={() => setSplashFinished(true)}
                debug={false}
              />
            )}
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: "#FEF2F2",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#DC2626",
    marginBottom: 8,
  },
  errorMsg: {
    fontSize: 14,
    color: "#7F1D1D",
    textAlign: "center",
    marginBottom: 12,
  },
  errorStack: {
    fontSize: 11,
    color: "#991B1B",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
});
