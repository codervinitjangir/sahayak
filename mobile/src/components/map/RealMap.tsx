// Native entry for the map. MapLibre ships native code that Expo Go does not
// contain, and importing it there throws at startup ("MLRNCameraModule could not
// be found"), taking the whole app down. So the native map is only required when
// its module is registered; otherwise a static placeholder keeps every other
// screen usable. A development build (EAS) has the module and gets the real map.
import React from "react";
import { View, Text, StyleSheet, TurboModuleRegistry, NativeModules } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Typography } from "../../constants/theme";
import type { RealMapProps } from "./RealMapNative";

export type { RealMapProps };

function hasMapLibre(): boolean {
  try {
    return Boolean(TurboModuleRegistry.get("MLRNCameraModule") ?? NativeModules.MLRNCameraModule);
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Native: React.ComponentType<RealMapProps> | null = hasMapLibre() ? require("./RealMapNative").default : null;

export default function RealMap(props: RealMapProps) {
  if (Native) return <Native {...props} />;
  return (
    <View style={styles.fallback} accessible accessibilityLabel="Map not available in this build">
      <Ionicons name="map-outline" size={36} color={Colors.textMuted} />
      <Text style={styles.text}>Map needs the full app build</Text>
      <Text style={styles.sub}>Location and requests still work.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#DADDE2", alignItems: "center", justifyContent: "center", gap: 6, paddingBottom: 260 },
  text: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textSecondary },
  sub: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.regular, color: Colors.textMuted },
});
