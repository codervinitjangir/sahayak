// Vehicle make logos (assets/logos, sources in CREDITS.md). Shown only to
// identify the make the owner picked. Unknown makes fall back to a letter tile.
import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { Typography } from "../../constants/theme";

const LOGOS: Record<string, number> = {
  "ather": require("../../../assets/logos/ather.png"),
  "bajaj": require("../../../assets/logos/bajaj.png"),
  "bmw": require("../../../assets/logos/bmw.png"),
  "hero": require("../../../assets/logos/hero.png"),
  "honda": require("../../../assets/logos/honda.png"),
  "hyundai": require("../../../assets/logos/hyundai.png"),
  "jawa": require("../../../assets/logos/jawa.png"),
  "kia": require("../../../assets/logos/kia.png"),
  "ktm": require("../../../assets/logos/ktm.png"),
  "mahindra": require("../../../assets/logos/mahindra.png"),
  "maruti-suzuki": require("../../../assets/logos/maruti-suzuki.png"),
  "mg": require("../../../assets/logos/mg.png"),
  "nissan": require("../../../assets/logos/nissan.png"),
  "ola": require("../../../assets/logos/ola.png"),
  "renault": require("../../../assets/logos/renault.png"),
  "royal-enfield": require("../../../assets/logos/royal-enfield.png"),
  "skoda": require("../../../assets/logos/skoda.png"),
  "suzuki": require("../../../assets/logos/suzuki.png"),
  "tata": require("../../../assets/logos/tata.png"),
  "toyota": require("../../../assets/logos/toyota.png"),
  "volkswagen": require("../../../assets/logos/volkswagen.png"),
  "yamaha": require("../../../assets/logos/yamaha.png"),
};

export function brandSlug(make?: string | null): string {
  return (make ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function hasBrandLogo(make?: string | null): boolean {
  return brandSlug(make) in LOGOS;
}

export default function BrandLogo({
  make,
  size = 40,
  color = "#111827",
  round = false,
}: {
  make?: string | null;
  size?: number;
  /** Letter-tile colour when there is no logo. */
  color?: string;
  round?: boolean;
}) {
  const src = LOGOS[brandSlug(make)];
  const r = round ? size / 2 : size * 0.22;
  if (src) {
    return (
      <View style={[styles.box, { width: size, height: size, borderRadius: r }]} accessibilityLabel={make ?? undefined}>
        <Image source={src} style={{ width: size * 0.78, height: size * 0.78 }} resizeMode="contain" />
      </View>
    );
  }
  return (
    <View style={[styles.box, { width: size, height: size, borderRadius: r, backgroundColor: color }]} accessibilityLabel={make ?? undefined}>
      <Text style={{ color: "#fff", fontSize: size * 0.42, fontFamily: Typography.fontFamily.bold }}>{(make ?? "?").charAt(0).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: "#fff", alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
