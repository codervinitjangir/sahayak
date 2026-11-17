// Owner settings: everything that is not used every day lives here, so the
// Account tab stays short (notifications, payments, help, legal, your data,
// delete account, sign out).
import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Linking, Share } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Colors, Spacing, Typography } from "../../../constants/theme";
import ScreenHero from "../../../components/ui/ScreenHero";
import Card from "../../../components/ui/Card";
import Button from "../../../components/ui/Button";
import { ListRow, SectionHeader } from "../../../components/ui/kit";
import { showDialog } from "../../../components/ui/AppDialog";
import { useAuthStore } from "../../../store/authStore";
import { usersApi } from "../../../services/api/users";
import { WEB_URL } from "../../../constants";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL } from "../../../constants/support";

export default function OwnerSettingsScreen() {
  const navigation = useNavigation();
  const logout = useAuthStore((s) => s.logout);
  const [exporting, setExporting] = useState(false);

  const exportData = async () => {
    setExporting(true);
    try {
      const data = await usersApi.exportMe();
      await Share.share({ title: "My Sahayak data", message: JSON.stringify(data, null, 2) });
    } catch {
      showDialog("Could not export", "Check your connection and try again.");
    } finally {
      setExporting(false);
    }
  };

  const confirmDelete = () =>
    showDialog(
      "Delete your account?",
      "Your name, phone, email, vehicles and notifications are erased and you are signed out. Past jobs stay on record without your details. This cannot be undone.",
      [
        { text: "Keep my account", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: async () => {
            try {
              await usersApi.deleteMe();
              logout();
            } catch (err: any) {
              const code = err?.response?.data?.error?.code;
              showDialog("Could not delete", code === "ACCOUNT_HAS_ACTIVE_JOB" ? "Finish or cancel your active request first." : "Check your connection and try again.");
            }
          },
        },
      ]
    );

  const confirmSignOut = () =>
    showDialog("Sign out?", "You will need to verify your number again to sign back in.", [
      { text: "Stay signed in", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: logout },
    ]);

  return (
    <View style={styles.root}>
      <ScreenHero title="Settings" left={{ icon: "chevron-back", onPress: () => navigation.goBack(), label: "Back" }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View>
          <SectionHeader title="Notifications" />
          <Card noPad>
            <ListRow icon="notifications-outline" title="Notification sound and banners" subtitle="Partner updates, arrival and completion alerts are managed in your phone's settings." onPress={() => void Linking.openSettings()} last />
          </Card>
        </View>

        <View>
          <SectionHeader title="Payments" />
          <Card noPad>
            <ListRow icon="card-outline" title="How you pay" subtitle="UPI (Google Pay, PhonePe, Paytm, QR) or cash to the partner" last />
          </Card>
        </View>

        <View>
          <SectionHeader title="Help and legal" />
          <Card noPad>
            <ListRow icon="call-outline" title="Sahayak support" subtitle={SUPPORT_PHONE_DISPLAY} onPress={() => void Linking.openURL(SUPPORT_PHONE_TEL)} />
            <ListRow icon="mail-outline" title="Email support" subtitle="support@sahayak.app" onPress={() => void Linking.openURL("mailto:support@sahayak.app")} last={!WEB_URL} />
            {WEB_URL ? (
              <>
                <ListRow icon="document-text-outline" title="Terms of service" onPress={() => void Linking.openURL(`${WEB_URL}/terms`)} />
                <ListRow icon="lock-closed-outline" title="Privacy policy" onPress={() => void Linking.openURL(`${WEB_URL}/privacy`)} last />
              </>
            ) : null}
          </Card>
        </View>

        <View>
          <SectionHeader title="Your data" />
          <Card noPad>
            <ListRow icon="download-outline" title={exporting ? "Preparing your data…" : "Download my data"} subtitle="Everything Sahayak stores about you" onPress={exporting ? undefined : () => void exportData()} />
            <ListRow icon="trash-outline" title="Delete account" subtitle="Erase your details and sign out" onPress={confirmDelete} last />
          </Card>
        </View>

        <Button label="Sign out" variant="outline" onPress={confirmSignOut} />
        <Text style={styles.version}>Sahayak · version 1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: Spacing.screenHorizontal, gap: Spacing.xl, paddingBottom: 48 },
  version: { textAlign: "center", color: Colors.textMuted, fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.regular },
});
