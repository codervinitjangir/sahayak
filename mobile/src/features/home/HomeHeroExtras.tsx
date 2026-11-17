// Owner home hero extras: the vehicle chip and the auto-advancing banner
// carousel. Every banner states something true about Sahayak; no prices,
// warranties or counts that the backend does not give us.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions, AccessibilityInfo } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Typography, Spacing, Hero } from "../../constants/theme";
import ServiceArt, { type ArtName } from "../../components/illustrations/ServiceArt";
import type { MobileVehicle as BackendVehicle } from "../../services/api/vehicles";
import BrandLogo, { hasBrandLogo } from "../../components/brand/BrandLogo";

export function VehicleChip({ vehicle, onPress }: { vehicle?: BackendVehicle; onPress: () => void }) {
  const two = vehicle?.vehicle_type === "two_wheeler";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={vehicle ? `Your vehicle: ${vehicle.make} ${vehicle.model}` : "Add your vehicle"}
      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.chipArt}>
        {vehicle && hasBrandLogo(vehicle.make) ? <BrandLogo make={vehicle.make} size={36} round /> : <ServiceArt name={two ? "bike" : "car"} fill />}
      </View>
      <Text style={styles.chipText} numberOfLines={1}>
        {vehicle ? `${vehicle.make} ${vehicle.model}` : "Add vehicle"}
      </Text>
      <Ionicons name={vehicle ? "chevron-down" : "add"} size={16} color="#fff" />
    </Pressable>
  );
}

/** Account hero: the owner's main vehicle as a full-width glass card. */
export function VehicleCard({ vehicle, count, onPress }: { vehicle?: BackendVehicle; count: number; onPress: () => void }) {
  const two = vehicle?.vehicle_type === "two_wheeler";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={vehicle ? `Your vehicle ${vehicle.make} ${vehicle.model}, ${vehicle.vehicle_number}. Open garage` : "Add your vehicle"}
      style={({ pressed }) => [styles.vcard, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.vcardArt}>
        {vehicle && hasBrandLogo(vehicle.make) ? <BrandLogo make={vehicle.make} size={48} /> : <ServiceArt name={two ? "bike" : "car"} fill />}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.vcardKicker}>{vehicle ? (count > 1 ? `My garage · ${count} vehicles` : "My vehicle") : "No vehicle yet"}</Text>
        <Text style={styles.vcardName} numberOfLines={1}>{vehicle ? `${vehicle.make} ${vehicle.model}` : "Add your vehicle"}</Text>
        {vehicle ? <Text style={styles.vcardPlate}>{vehicle.vehicle_number}</Text> : null}
      </View>
      <Ionicons name={vehicle ? "chevron-forward" : "add-circle"} size={22} color="#fff" />
    </Pressable>
  );
}

type Slide = { art: ArtName; kicker: string; title: string; body: string; tags?: string[]; onPress?: () => void };

export function HeroCarousel({ slides }: { slides: Slide[] }) {
  const { width } = useWindowDimensions();
  const w = width - Spacing.screenHorizontal * 2;
  const ref = useRef<any>(null);
  const [i, setI] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill);
  }, []);

  useEffect(() => {
    if (still || slides.length < 2) return;
    const id = setInterval(() => {
      setI((cur) => {
        const next = (cur + 1) % slides.length;
        ref.current?.scrollTo({ x: next * w, animated: true });
        return next;
      });
    }, 4500);
    return () => clearInterval(id);
  }, [still, slides.length, w]);

  return (
    <View>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setI(Math.round(e.nativeEvent.contentOffset.x / w))}
        style={{ width: w }}
      >
        {slides.map((s) => (
          <Pressable
            key={s.title}
            onPress={s.onPress}
            disabled={!s.onPress}
            accessibilityRole={s.onPress ? "button" : "text"}
            accessibilityLabel={`${s.kicker}. ${s.title}. ${s.body}`}
            style={[styles.slide, { width: w }]}
          >
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.kicker}>{s.kicker}</Text>
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.body} numberOfLines={2}>{s.body}</Text>
              {s.tags ? (
                <View style={styles.tags}>
                  {s.tags.map((t) => (
                    <Text key={t} style={styles.tag}>{t}</Text>
                  ))}
                </View>
              ) : null}
            </View>
            <ServiceArt name={s.art} width={118} height={104} radius={18} />
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {slides.map((s, k) => (
          <View key={s.title} style={[styles.dot, k === i && styles.dotOn]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    paddingLeft: 4,
    paddingRight: 12,
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: Hero.glass,
    borderWidth: 1,
    borderColor: Hero.glassBorder,
    maxWidth: "100%",
  },
  chipArt: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  chipText: { color: "#fff", fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, flexShrink: 1 },
  vcard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 20, backgroundColor: Hero.glass, borderWidth: 1, borderColor: Hero.glassBorder },
  vcardArt: { width: 56, height: 56, borderRadius: 14, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  vcardKicker: { color: Hero.textSoft, fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.medium },
  vcardName: { color: "#fff", fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold },
  vcardPlate: { alignSelf: "flex-start", color: "#111827", backgroundColor: "#FDE68A", fontSize: 12, fontFamily: Typography.fontFamily.bold, letterSpacing: 1, paddingHorizontal: 8, paddingVertical: 1, borderRadius: 4, overflow: "hidden" },
  slide: { flexDirection: "row", alignItems: "center", minHeight: 128 },
  kicker: { color: "#86EFAC", fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold, letterSpacing: 0.6, textTransform: "uppercase" },
  title: { marginTop: 4, color: "#fff", fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.bold, lineHeight: 28 },
  body: { marginTop: 4, color: Hero.textSoft, fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.regular, lineHeight: 19 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  tag: { color: "#fff", fontSize: 11, fontFamily: Typography.fontFamily.medium, borderWidth: 1, borderColor: Hero.glassBorder, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  dotOn: { width: 20, backgroundColor: "#fff" },
});
