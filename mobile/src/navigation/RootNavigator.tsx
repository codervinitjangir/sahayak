// ─── Sahayak — Root Navigator ─────────────────────────────────────────────────
// Role-aware routing: Auth → Owner flow OR Partner flow
import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import { useAuthStore } from "../store/authStore";
import { Colors, Typography, Radius, Shadows } from "../constants/theme";

// ── Auth ──────────────────────────────────────────────────────────────────────
import SplashScreen from "../features/auth/screens/SplashScreen";
import LoginScreen from "../features/auth/screens/LoginScreen";

// ── Owner ─────────────────────────────────────────────────────────────────────
import HomeScreen from "../features/jobs/screens/HomeScreen";
import ServiceSelectScreen from "../features/jobs/screens/ServiceSelectScreen";
import PickupLocationScreen from "../features/jobs/screens/PickupLocationScreen";
import FindingPartnerScreen from "../features/jobs/screens/FindingPartnerScreen";
import PartnerMatchedScreen from "../features/jobs/screens/PartnerMatchedScreen";
import JobCompleteScreen from "../features/jobs/screens/JobCompleteScreen";

// ── Partner ───────────────────────────────────────────────────────────────────
import PartnerHomeScreen from "../features/partner/screens/PartnerHomeScreen";
import IncomingOfferScreen from "../features/partner/screens/IncomingOfferScreen";
import ActiveJobScreen from "../features/partner/screens/ActiveJobScreen";
import PartnerJobDoneScreen from "../features/partner/screens/PartnerJobDoneScreen";

// ── Shared ────────────────────────────────────────────────────────────────────
import TrackingScreen from "../features/tracking/screens/TrackingScreen";
import ProfileScreen from "../features/profile/screens/ProfileScreen";

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
const Tab = createBottomTabNavigator();



// ── Owner Continuous Map & Sheet Flow ──────────────────────────────────────
import OwnerHelpFlowScreen from "../features/jobs/screens/OwnerHelpFlowScreen";

// ─── Owner Stack Navigator (Continuous Map-and-Sheet Canvas) ───────────────────
function OwnerNavigator() {
  return (
    <OwnerStack.Navigator
      screenOptions={{ headerShown: false }}
      initialRouteName="OwnerHome"
    >
      <OwnerStack.Screen name="OwnerHome" component={HomeScreen} />
      <OwnerStack.Screen name="OwnerFlow" component={OwnerHelpFlowScreen} />
      <OwnerStack.Screen name="ServiceSelect" component={OwnerHelpFlowScreen} />
      <OwnerStack.Screen name="PickupLocation" component={OwnerHelpFlowScreen} />
      <OwnerStack.Screen name="FindingPartner" component={OwnerHelpFlowScreen} />
      <OwnerStack.Screen name="PartnerMatched" component={OwnerHelpFlowScreen} />
      <OwnerStack.Screen
        name="JobComplete"
        component={JobCompleteScreen}
        options={{ animation: "slide_from_bottom", gestureEnabled: false }}
      />
      <OwnerStack.Screen name="Profile" component={ProfileScreen} />
    </OwnerStack.Navigator>
  );
}

// ─── Partner Tab Navigator ────────────────────────────────────────────────────
function PartnerTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.surfaceWhite,
          borderTopColor: Colors.border,
          paddingBottom: Platform.OS === "ios" ? 24 : 8,
          paddingTop: 8,
          height: Platform.OS === "ios" ? 80 : 60,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: Typography.fontFamily.medium,
        },
      }}
    >
      <Tab.Screen
        name="PartnerHome"
        component={PartnerHomeScreen}
        options={{
          tabBarLabel: "Dashboard",
          tabBarIcon: ({ color, size, focused }: any) => (
            <Ionicons name={focused ? "grid" : "grid-outline"} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: "Profile",
          tabBarIcon: ({ color, size, focused }: any) => (
            <Ionicons name={focused ? "person" : "person-outline"} size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

// ─── Partner Stack ────────────────────────────────────────────────────────────
function PartnerNavigator() {
  return (
    <PartnerStack.Navigator screenOptions={{ headerShown: false }}>
      <PartnerStack.Screen name="PartnerHome" component={PartnerTabs} />
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

// ─── Root Navigator ───────────────────────────────────────────────────────────
export default function RootNavigator() {
  const { user } = useAuthStore();

  return (
    <NavigationContainer>
      {user?.role === "partner" ? (
        <PartnerNavigator />
      ) : (
        <OwnerNavigator />
      )}
    </NavigationContainer>
  );
}

