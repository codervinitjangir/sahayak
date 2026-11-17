// Partner settings: alerts, navigation app, helpline, legal and sign out,
// kept off the Account tab so it stays clean.
import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Linking } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Colors, Spacing, Typography } from "../../../constants/theme";
import ScreenHero from "../../../components/ui/ScreenHero";
import Card from "../../../components/ui/Card";
import Button from "../../../components/ui/Button";
import { ListRow, SectionHeader } from "../../../components/ui/kit";
import { showDialog } from "../../../components/ui/AppDialog";
import { useAuthStore } from "../../../store/authStore";
import { useJobStore } from "../../../store/jobStore";
import { NAV_APP_LABEL, getNavApp, setNavApp as saveNavApp, type NavApp } from "../../../services/navigationPreference";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL } from "../../../constants/support";
import { WEB_URL } from "../../../constants";
import ProfileSwitchCard from "../../profile/ProfileSwitchCard";

export default function PartnerSettingsScreen() {
  const navigation = useNavigation();
  const logout = useAuthStore((s) => s.logout);
  const isOnline = useJobStore((s) => s.isOnline);
  const [navApp, setNavApp] = useState<NavApp>("google");

  useEffect(() => {
    void getNavApp().then(setNavApp);
  }, []);

  const choose = (app: NavApp) => {
    setNavApp(app);
    void saveNavApp(app);
  };

  const confirmSignOut = () =>
    showDialog("Sign out?", isOnline ? "You are on duty. Signing out does not take you off duty; go off duty first." : "You will need to verify your number again to sign back in.", [
      { text: "Stay signed in", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: logout },
    ]);

  return (
    <View style={styles.root}>
      <ScreenHero title="Settings" left={{ icon: "chevron-back", onPress: () => navigation.goBack(), label: "Back" }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View>
          <SectionHeader title="Profile mode" />
          <ProfileSwitchCard />
        </View>

        <View>
          <SectionHeader title="Job alerts" />
          <Card noPad>
            <ListRow icon="notifications-outline" title="Sound and vibration" subtitle="New offers ring and vibrate. Change it in your phone's notification settings." onPress={() => void Linking.openSettings()} />
            <ListRow
              icon="navigate-outline"
              title="Navigation app"
              subtitle={NAV_APP_LABEL[navApp]}
              onPress={() =>
                showDialog("Navigation app", "Which app should open when you tap Navigate on a job?", [
                  { text: NAV_APP_LABEL.google, onPress: () => choose("google") },
                  { text: NAV_APP_LABEL.system, onPress: () => choose("system") },
                  { text: "Cancel", style: "cancel" },
                ])
              }
              last
            />
          </Card>
        </View>

        <View>
          <SectionHeader title="Helpline and legal" />
          <Card noPad>
            <ListRow icon="call-outline" title="24/7 dispatch control room" subtitle={SUPPORT_PHONE_DISPLAY} onPress={() => void Linking.openURL(SUPPORT_PHONE_TEL)} last={!WEB_URL} />
            {WEB_URL ? (
              <>
                <ListRow icon="document-text-outline" title="Partner terms of service" onPress={() => void Linking.openURL(`${WEB_URL}/terms`)} />
                <ListRow icon="lock-closed-outline" title="Partner privacy policy" onPress={() => void Linking.openURL(`${WEB_URL}/privacy`)} last />
              </>
            ) : null}
          </Card>
        </View>

        <Button label="Sign out" variant="outline" onPress={confirmSignOut} />
        <Text style={styles.version}>Sahayak Partner · version 1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: Spacing.screenHorizontal, gap: Spacing.xl, paddingBottom: 48 },
  version: { textAlign: "center", color: Colors.textMuted, fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.regular },
});
