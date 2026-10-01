// ─── Sahayak — Profile Screen (Blinkit Exact Theme & Spacing) ───────────────────────
import React from "react";
import { useNavigation } from "@react-navigation/native";
import AccountView from "../../account/screens/AccountView";

export default function ProfileScreen() {
  const navigation = useNavigation<any>();

  return (
    <AccountView
      onGoToTab={() => {
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate("OwnerHome");
        }
      }}
    />
  );
}
