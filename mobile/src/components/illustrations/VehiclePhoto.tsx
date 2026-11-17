// A real photo of the owner's vehicle model when we have one (assets/vehicles),
// otherwise the generic car or bike photo. Matching is forgiving: "i20 Asta"
// still finds the Hyundai i20 photo.
import React from "react";
import { Image } from "react-native";
import ServiceArt from "./ServiceArt";
import { VEHICLE_PHOTOS } from "./vehiclePhotoMap";

const slug = (s?: string | null) => (s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function vehiclePhotoFor(make?: string | null, model?: string | null): number | undefined {
  const mk = slug(make);
  const md = slug(model);
  if (!mk || !md) return undefined;
  const exact = VEHICLE_PHOTOS[`${mk}-${md}`];
  if (exact) return exact;
  // Owner typed extra words (trim, year): longest catalogue model that prefixes theirs.
  let best: { len: number; src: number } | undefined;
  for (const [key, src] of Object.entries(VEHICLE_PHOTOS)) {
    if (!key.startsWith(mk + "-")) continue;
    const m = key.slice(mk.length + 1);
    if ((md.startsWith(m + "-") || md === m) && (!best || m.length > best.len)) best = { len: m.length, src };
  }
  return best?.src;
}

export default function VehiclePhoto({
  make,
  model,
  type,
}: {
  make?: string | null;
  model?: string | null;
  type?: "two_wheeler" | "four_wheeler" | string | null;
}) {
  const src = vehiclePhotoFor(make, model);
  if (src) {
    return <Image source={src} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors />;
  }
  return <ServiceArt name={type === "two_wheeler" ? "bike" : "car"} fill />;
}
