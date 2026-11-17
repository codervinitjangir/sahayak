// One login, two profiles (ADR-034). Shown on the owner Account tab and the
// partner home: switch between owner and partner mode, or add the missing one.
import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Colors, Spacing } from "../../constants/theme";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import { showDialog } from "../../components/ui/AppDialog";
import { useAuthStore } from "../../store/authStore";
import { usersApi } from "../../services/api/users";

const e164 = (phone: string) => (phone ? `+${phone.replace(/^\+/, "")}` : "");

export default function ProfileSwitchCard() {
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const profiles = useAuthStore((s) => s.profiles);
  const switchProfile = useAuthStore((s) => s.switchProfile);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const isPartner = user.role === "partner";
  const hasOther = isPartner ? profiles.includes("user") : profiles.includes("partner");

  const doSwitch = async () => {
    setBusy(true);
    const ok = await switchProfile(isPartner ? "user" : "partner");
    setBusy(false);
    if (!ok) showDialog("Could not switch", "Check your connection and try again.");
  };

  const becomeOwner = async () => {
    setBusy(true);
    try {
      const name = user.name && user.name !== "Service partner" ? user.name : "Sahayak user";
      await usersApi.createOwner(name, e164(user.phone));
      const ok = await switchProfile("user");
      if (!ok) showDialog("Owner profile created", "Switch again in a moment.");
    } catch (e: any) {
      showDialog(
        "Could not create owner profile",
        e?.response?.data?.error?.message ?? "Check your connection and try again."
      );
    } finally {
      setBusy(false);
    }
  };

  let message: string;
  if (hasOther) {
    message = `This number also has ${isPartner ? "an owner" : "a partner"} profile. Switch any time; nothing is lost.`;
  } else if (isPartner) {
    message = "Need help with your own vehicle? Add an owner profile to this number.";
  } else {
    message = "Mechanic or tow operator? Earn with Sahayak using this same number.";
  }

  return (
    <Card>
      <Text style={styles.title}>{isPartner ? "Partner mode" : "Owner mode"}</Text>
      <Text style={styles.sub}>{message}</Text>
      <View style={{ marginTop: Spacing.md }}>
        {hasOther ? (
          <Button
            label={isPartner ? "Switch to owner mode" : "Switch to partner mode"}
            variant="outline"
            loading={busy}
            onPress={doSwitch}
          />
        ) : isPartner ? (
          <Button label="Use Sahayak as a vehicle owner" variant="outline" loading={busy} onPress={becomeOwner} />
        ) : (
          <Button label="Become a partner" onPress={() => navigation.navigate("BecomePartner")} />
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "700", color: Colors.textPrimary },
  sub: { fontSize: 15, color: Colors.textSecondary, marginTop: 4, lineHeight: 21 },
});
