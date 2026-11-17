// ─── Sahayak — Root Navigator ─────────────────────────────────────────────────
// Role-aware routing: Auth → Owner flow OR Partner flow
import React, { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { Colors } from "../constants/theme";
import { NavigationContainer } from "@react-navigation/native";
import { navigationRef, openNotificationRoute } from "./navigationRef";
import * as Notifications from "expo-notifications";
import { routeForNotification } from "../services/notificationMeta";
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
import PartnerReviewsScreen from "../features/partner/screens/PartnerReviewsScreen";
import OwnerSettingsScreen from "../features/account/screens/OwnerSettingsScreen";
import ReceiptScreen from "../features/shared/ReceiptScreen";
import ReportProblemScreen from "../features/activity/screens/ReportProblemScreen";
import BecomePartnerScreen from "../features/profile/BecomePartnerScreen";
import PartnerServicesScreen from "../features/partner/screens/PartnerServicesScreen";
import PartnerSettingsScreen from "../features/partner/screens/PartnerSettingsScreen";
import PartnerVerificationScreen from "../features/partner/screens/PartnerVerificationScreen";

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
      <OwnerStack.Screen name="BecomePartner" component={BecomePartnerScreen} />
      <OwnerStack.Screen name="OwnerSettings" component={OwnerSettingsScreen} />
      <OwnerStack.Screen name="Receipt" component={ReceiptScreen} />
      <OwnerStack.Screen name="ReportProblem" component={ReportProblemScreen} />
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
      <PartnerStack.Screen name="PartnerReviews" component={PartnerReviewsScreen} />
      <PartnerStack.Screen name="PartnerServices" component={PartnerServicesScreen} />
      <PartnerStack.Screen name="PartnerVerification" component={PartnerVerificationScreen} />
      <PartnerStack.Screen name="PartnerSettings" component={PartnerSettingsScreen} />
      <PartnerStack.Screen name="Receipt" component={ReceiptScreen} />
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
  const { user, isRestoringSession } = useAuthStore();
  const role = user?.role;

  // Tapping a push: route by its event and job. Also handles the push that
  // launched the app from killed state (getLastNotificationResponseAsync).
  useEffect(() => {
    if (!role) return;
    const handle = (response: Notifications.NotificationResponse | null) => {
      const data = (response?.notification.request.content.data ?? {}) as {
        event?: string;
        job_id?: string | null;
      };
      if (!data.event) return;
      const target = routeForNotification(role, data.event, data.job_id);
      // The navigator may still be mounting after a cold start.
      if (navigationRef.isReady()) openNotificationRoute(target);
      else setTimeout(() => openNotificationRoute(target), 600);
    };
    void Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, [role]);

  return (
    <NavigationContainer ref={navigationRef}>
      {!user && isRestoringSession ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.surface }}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : !user ? (
        <AuthNavigator />
      ) : user.role === "partner" ? (
        <PartnerNavigator />
      ) : (
        <OwnerNavigator />
      )}
    </NavigationContainer>
  );
}


