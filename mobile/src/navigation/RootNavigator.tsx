import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useAuthStore } from "../store/authStore";

// ─── Screen placeholders (will be replaced with real screens) ─────────────────
import LoginScreen from "../features/auth/screens/LoginScreen";
import HomeScreen from "../features/jobs/screens/HomeScreen";
import TrackingScreen from "../features/tracking/screens/TrackingScreen";
import ProfileScreen from "../features/profile/screens/ProfileScreen";

// ─── Type definitions ─────────────────────────────────────────────────────────
export type AuthStackParamList = {
  Login: undefined;
};

export type AppTabParamList = {
  Home: undefined;
  Tracking: { jobId: string };
  Profile: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppTab = createBottomTabNavigator<AppTabParamList>();

// ─── Authenticated tab navigator ─────────────────────────────────────────────
function AppNavigator() {
  return (
    <AppTab.Navigator screenOptions={{ headerShown: false }}>
      <AppTab.Screen name="Home" component={HomeScreen} />
      <AppTab.Screen name="Tracking" component={TrackingScreen} />
      <AppTab.Screen name="Profile" component={ProfileScreen} />
    </AppTab.Navigator>
  );
}

// ─── Root navigator (auth gate) ───────────────────────────────────────────────
export default function RootNavigator() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <NavigationContainer>
      {isAuthenticated ? (
        <AppNavigator />
      ) : (
        <AuthStack.Navigator screenOptions={{ headerShown: false }}>
          <AuthStack.Screen name="Login" component={LoginScreen} />
        </AuthStack.Navigator>
      )}
    </NavigationContainer>
  );
}
