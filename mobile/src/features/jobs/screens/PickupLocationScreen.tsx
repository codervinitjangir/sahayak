// ─── Sahayak — Pickup Location Screen ─────────────────────────────────────────
// Uber/Ola breakdown language: Persistent Map as canvas + Dynamic Bottom Sheet
import React from "react";
import OwnerHelpFlowScreen from "./OwnerHelpFlowScreen";

export default function PickupLocationScreen() {
  return <OwnerHelpFlowScreen initialStep="pickup_location" />;
}
