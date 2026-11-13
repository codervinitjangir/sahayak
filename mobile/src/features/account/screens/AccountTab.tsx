import React from "react";
import { View, Text, ScrollView, StyleSheet, Alert, Linking } from "react-native";
import { Colors, Typography, Spacing } from "../../../constants/theme";
import { useAuthStore } from "../../../store/authStore";
import Card from "../../../components/ui/Card";
import Button from "../../../components/ui/Button";
import { ListRow, SectionHeader, Skeleton } from "../../../components/ui/kit";
import { EMERGENCY_NUMBER } from "../../../components/ui/SafetyActions";
import { WEB_URL } from "../../../constants";
import { useMyVehicles } from "../../shared/ownerData";

export default function AccountTab({ onAddVehicle }: { onAddVehicle: () => void }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const vehicles = useMyVehicles();

  const confirmSignOut = () =>
    Alert.alert("Sign out?", "You will need to verify your number again to sign back in.", [
      { text: "Stay signed in", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: logout },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.title} accessibilityRole="header">
        Account
      </Text>

      <Card>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.name ?? "U").trim().charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name ?? "Vehicle owner"}</Text>
            {user?.phone ? <Text style={styles.phone}>{user.phone}</Text> : null}
          </View>
        </View>
      </Card>

      <View>
        <SectionHeader title="My vehicles" action="Add" onAction={onAddVehicle} />
        <Card noPad>
          {vehicles.isLoading ? (
            <View style={{ padding: Spacing.base }}>
              <Skeleton height={20} />
            </View>
          ) : vehicles.isError ? (
            <ListRow icon="alert-circle-outline" title="Could not load vehicles" subtitle="Pull down on Home to retry" last />
          ) : (vehicles.data ?? []).length === 0 ? (
            <ListRow icon="add-circle-outline" title="Add your first vehicle" subtitle="Needed to request help" onPress={onAddVehicle} last />
          ) : (
            (vehicles.data ?? []).map((v, i, arr) => (
              <ListRow
                key={v.id}
                icon={v.vehicle_type === "two_wheeler" ? "bicycle-outline" : "car-outline"}
                title={`${v.make} ${v.model}`}
                subtitle={v.vehicle_number}
                last={i === arr.length - 1}
              />
            ))
          )}
        </Card>
      </View>

      <View>
        <SectionHeader title="Safety" />
        <Card noPad>
          <ListRow
            icon="call-outline"
            title={`Call emergency services (${EMERGENCY_NUMBER})`}
            onPress={() => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`)}
            last
          />
        </Card>
      </View>

      <View>
        <SectionHeader title="About" />
        <Card noPad>
          <ListRow
            icon="shield-checkmark-outline"
            title="Your privacy"
            subtitle="A partner sees your phone number only after they are assigned to your request."
            last={!WEB_URL}
          />
          {WEB_URL ? (
            <>
              <ListRow icon="document-text-outline" title="Terms of service" onPress={() => void Linking.openURL(`${WEB_URL}/terms`)} />
              <ListRow icon="lock-closed-outline" title="Privacy policy" onPress={() => void Linking.openURL(`${WEB_URL}/privacy`)} last />
            </>
          ) : null}
        </Card>
      </View>

      <Button label="Sign out" variant="outline" onPress={confirmSignOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.screenHorizontal, gap: Spacing.xl, paddingBottom: Spacing["4xl"] },
  title: { fontSize: Typography.fontSize["4xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, letterSpacing: Typography.letterSpacing.display },
  profile: { flexDirection: "row", alignItems: "center", gap: Spacing.base },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.brand700, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.bold },
  name: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  phone: { marginTop: 2, fontSize: Typography.fontSize.base, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular },
});
