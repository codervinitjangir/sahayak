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

// ─── Custom Tab Bar ───────────────────────────────────────────────────────────
function CustomTabBar({ state, descriptors, navigation }: any) {
  return (
    <View style={tabStyles.bar}>
      {state.routes.map((route: any, index: number) => {
        const { options } = descriptors[route.key];
        const isFocused = state.index === index;
        const icon = options.tabBarIcon?.({ focused: isFocused, color: "", size: 24 });

        return (
          <View key={route.key} style={tabStyles.tab}>
            {index === 1 ? (
              // SOS center button
              <View style={tabStyles.sosWrap}>
                <View style={tabStyles.sosBtn}>
                  <Ionicons name="flash" size={28} color={Colors.textWhite} />
                </View>
                <Text style={[tabStyles.label, { color: Colors.primary }]}>SOS</Text>
              </View>
            ) : (
              <View
                style={tabStyles.tabInner}
                // @ts-ignore
                onStartShouldSetResponder={() => true}
                onResponderRelease={() => {
                  navigation.navigate(route.name);
                }}
              >
                {options.tabBarIcon?.({
                  focused: isFocused,
                  color: isFocused ? Colors.primary : Colors.textMuted,
                  size: 24,
                })}
                <Text
                  style={[
                    tabStyles.label,
                    { color: isFocused ? Colors.primary : Colors.textMuted },
                  ]}
                >
                  {options.tabBarLabel ?? route.name}
                </Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: Colors.surfaceWhite,
    paddingTop: 8,
    paddingBottom: Platform.OS === "ios" ? 28 : 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    ...(Shadows.sheet as object),
  },
  tab: {
    flex: 1,
    alignItems: "center",
  },
  tabInner: {
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  label: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.medium,
    marginTop: 2,
  },
  sosWrap: { alignItems: "center", marginTop: -24 },
  sosBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: Colors.surfaceWhite,
    ...(Shadows.button as object),
  },
});

// ─── Owner Tab Navigator ──────────────────────────────────────────────────────
function OwnerTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: "Home",
          tabBarIcon: ({ color, size, focused }: any) => (
            <Ionicons
              name={focused ? "home" : "home-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="SOS"
        component={HomeScreen}
        options={{
          tabBarLabel: "SOS",
          tabBarIcon: ({ color, size }: any) => (
            <Ionicons name="flash" size={size} color={Colors.textWhite} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: "Profile",
          tabBarIcon: ({ color, size, focused }: any) => (
            <Ionicons
              name={focused ? "person" : "person-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

// ─── Owner Stack ──────────────────────────────────────────────────────────────
function OwnerNavigator() {
  return (
    <OwnerStack.Navigator screenOptions={{ headerShown: false }}>
      <OwnerStack.Screen name="OwnerHome" component={OwnerTabs} />
      <OwnerStack.Screen name="ServiceSelect" component={ServiceSelectScreen} />
      <OwnerStack.Screen
        name="PickupLocation"
        component={PickupLocationScreen}
        options={{ animation: "slide_from_bottom" }}
      />
      <OwnerStack.Screen
        name="FindingPartner"
        component={FindingPartnerScreen}
        options={{ animation: "fade", gestureEnabled: false }}
      />
      <OwnerStack.Screen
        name="PartnerMatched"
        component={PartnerMatchedScreen}
        options={{ animation: "slide_from_bottom" }}
      />
      <OwnerStack.Screen
        name="JobComplete"
        component={JobCompleteScreen}
        options={{ animation: "slide_from_bottom", gestureEnabled: false }}
      />
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
  const { isAuthenticated, user } = useAuthStore();

  return (
    <NavigationContainer>
      {!isAuthenticated ? (
        // ── Auth flow ──
        <AuthStack.Navigator screenOptions={{ headerShown: false }}>
          <AuthStack.Screen name="Login" component={LoginScreen} />
        </AuthStack.Navigator>
      ) : user?.role === "partner" ? (
        // ── Partner flow ──
        <PartnerNavigator />
      ) : (
        // ── Owner flow ──
        <OwnerNavigator />
      )}
    </NavigationContainer>
  );
}

