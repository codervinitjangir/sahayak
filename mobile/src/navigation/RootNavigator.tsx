// ─── Sahayak — Root Navigator ─────────────────────────────────────────────────
// Role-aware routing: Auth → Owner flow OR Partner flow
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { useAuthStore } from "../store/authStore";

// ── Auth ──────────────────────────────────────────────────────────────────────
import LoginScreen from "../features/auth/screens/LoginScreen";

// ── Owner ─────────────────────────────────────────────────────────────────────
import HomeScreen from "../features/jobs/screens/HomeScreen";
import OwnerHelpFlowScreen from "../features/jobs/screens/OwnerHelpFlowScreen";

// ── Partner ───────────────────────────────────────────────────────────────────
import PartnerHomeScreen from "../features/partner/screens/PartnerHomeScreen";
import IncomingOfferScreen from "../features/partner/screens/IncomingOfferScreen";
import ActiveJobScreen from "../features/partner/screens/ActiveJobScreen";
import PartnerJobDoneScreen from "../features/partner/screens/PartnerJobDoneScreen";

// ── Types ─────────────────────────────────────────────────────────────────────
import type {
  AuthStackParamList,
  OwnerStackParamList,
  PartnerStackParamList,
} from "../types";

// ─── Stack navigators ─────────────────────────────────────────────────────────
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const OwnerStack = createNativeStackNavigator<OwnerStackParamList>();
const PartnerStack = createNativeStackNavigator<PartnerStackParamList>();



// ─── Owner Stack Navigator ────────────────────────────────────────────────────
// The tab shell (OwnerHome) plus the full-screen request flow pushed over it.
function OwnerNavigator() {
  return (
    <OwnerStack.Navigator screenOptions={{ headerShown: false }} initialRouteName="OwnerHome">
      <OwnerStack.Screen name="OwnerHome" component={HomeScreen} />
      <OwnerStack.Screen name="OwnerFlow" component={OwnerHelpFlowScreen} />
    </OwnerStack.Navigator>
  );
}

// ─── Partner Stack Navigator ──────────────────────────────────────────────────
function PartnerNavigator() {
  return (
    <PartnerStack.Navigator
      screenOptions={{ headerShown: false }}
      initialRouteName="PartnerHome"
    >
      <PartnerStack.Screen name="PartnerHome" component={PartnerHomeScreen} />
      <PartnerStack.Screen
        name="IncomingOffer"
        component={IncomingOfferScreen}
        options={{ animation: "slide_from_bottom", gestureEnabled: false }}
      />
      <PartnerStack.Screen
        name="ActiveJob"
        component={ActiveJobScreen}
        options={{ animation: "slide_from_bottom", gestureEnabled: false }}
      />
      <PartnerStack.Screen
        name="PartnerJobDone"
        component={PartnerJobDoneScreen}
        options={{ animation: "fade", gestureEnabled: false }}
      />
    </PartnerStack.Navigator>
  );
}

// ─── Auth Stack Navigator ─────────────────────────────────────────────────────
function AuthNavigator() {
  return (
    <AuthStack.Navigator
      screenOptions={{ headerShown: false }}
      initialRouteName="Login"
    >
      <AuthStack.Screen name="Login" component={LoginScreen} />
    </AuthStack.Navigator>
  );
}

// ─── Root Navigator ───────────────────────────────────────────────────────────
export default function RootNavigator() {
  const { user } = useAuthStore();

  return (
    <NavigationContainer>
      {!user ? (
        <AuthNavigator />
      ) : user.role === "partner" ? (
        <PartnerNavigator />
      ) : (
        <OwnerNavigator />
      )}
    </NavigationContainer>
  );
}


