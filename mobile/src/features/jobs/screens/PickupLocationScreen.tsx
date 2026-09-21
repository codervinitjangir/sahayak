// ─── Sahayak — Pickup Location Screen ────────────────────────────────────────
// Figma: owner-pickup-location — full-screen map, top overlay, bottom sheet
import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Animated,
  StatusBar,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"
import type { RouteProp } from "@react-navigation/native";

import { Colors, Typography, Spacing, Radius, Shadows, ServiceConfig } from "../../../constants/theme";
import Button from "../../../components/ui/Button";
import { jobsApi } from "../../../services/api";
import { useJobStore } from "../../../store/jobStore";
import type { OwnerStackParamList, LatLng, ServiceType } from "../../../types";
import type { ViewStyle } from "react-native";

type Nav = NativeStackNavigationProp<OwnerStackParamList, "PickupLocation">;
type Route = RouteProp<OwnerStackParamList, "PickupLocation">;

const BENGALURU = { latitude: 12.9716, longitude: 77.5946 };
const DEFAULT_DELTA = { latitudeDelta: 0.012, longitudeDelta: 0.012 };

export default function PickupLocationScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { setDraftPickupLocation } = useJobStore();

  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState({ ...BENGALURU, ...DEFAULT_DELTA });
  const [markerCoord, setMarkerCoord] = useState<LatLng>(BENGALURU);
  const [address, setAddress] = useState("Locating you…");
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const svcKey = (route.params.serviceType || "mechanic") as keyof typeof ServiceConfig;
  const serviceCfg = ServiceConfig[svcKey] ?? ServiceConfig["mechanic"];

  useEffect(() => {
    fetchCurrentLocation();
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, []);

  const fetchCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setAddress("MG Road, Bengaluru, Karnataka"); // fallback
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      setMarkerCoord({ latitude, longitude });
      setRegion({ latitude, longitude, ...DEFAULT_DELTA });
      mapRef.current?.animateToRegion({ latitude, longitude, ...DEFAULT_DELTA }, 600);
      reverseGeocode(latitude, longitude);
    } catch {
      setAddress("MG Road, Bengaluru, Karnataka");
    }
  };

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const [result] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (result) {
        const parts = [result.street, result.district, result.city].filter(Boolean);
        setAddress(parts.join(", "));
      }
    } catch {
      setAddress("Current Location");
    }
  };

  const onMarkerDragEnd = (e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setMarkerCoord({ latitude, longitude });
    reverseGeocode(latitude, longitude);
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const loc = { ...markerCoord, address };
      setDraftPickupLocation(loc);
      const job = await jobsApi.createJob({
        serviceType: route.params.serviceType,
        vehicleId: route.params.vehicleId,
        subServiceId: route.params.subServiceId,
        notes: route.params.notes,
        pickupLocation: loc,
      });
      nav.navigate("FindingPartner", { jobId: job.id });
    } catch {
      Alert.alert("Error", "Could not create your request. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const sheetTranslate = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [200, 0],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* ── Full-Screen Map (Figma: map-background) ── */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={region}
        showsUserLocation={false}
        showsMyLocationButton={false}
      >
        <Marker
          coordinate={markerCoord}
          draggable
          onDragEnd={onMarkerDragEnd}
          pinColor={Colors.primary}
        />
      </MapView>

      {/* ── Top Overlay (Figma: top-overlay) ── */}
      <SafeAreaView style={styles.topOverlay} edges={["top"]}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => nav.goBack()}>
            <Ionicons name="arrow-back" size={20} color={Colors.textPrimary} />
          </TouchableOpacity>

          {/* Search bar */}
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search location…"
              placeholderTextColor={Colors.textMuted}
              value={searchText}
              onChangeText={setSearchText}
            />
          </View>
        </View>

        {/* Service chip */}
        <View style={[styles.serviceChip, { backgroundColor: serviceCfg.bg }]}>
          <Ionicons name={serviceCfg.icon as any} size={14} color={serviceCfg.color} />
          <Text style={[styles.serviceChipText, { color: serviceCfg.color }]}>
            {serviceCfg.label}
          </Text>
        </View>
      </SafeAreaView>

      {/* ── My Location Button ── */}
      <TouchableOpacity style={styles.myLocBtn} onPress={fetchCurrentLocation}>
        <Ionicons name="locate" size={22} color={Colors.primary} />
      </TouchableOpacity>

      {/* ── Bottom Sheet (Figma: bottom-overlay) ── */}
      <Animated.View
        style={[styles.sheet, Shadows.sheet as ViewStyle, { transform: [{ translateY: sheetTranslate }] }]}
      >
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetLabel}>Pickup Location</Text>

        <View style={styles.addressRow}>
          <View style={styles.addressIcon}>
            <Ionicons name="location" size={20} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.addressText} numberOfLines={2}>
              {address}
            </Text>
            <Text style={styles.addressHint}>Drag the pin to adjust</Text>
          </View>
        </View>

        <Button
          label="Confirm & Find Partner"
          onPress={handleConfirm}
          loading={loading}
          icon={<Ionicons name="checkmark-circle" size={18} color={Colors.textWhite} />}
          iconPosition="right"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  map: { ...StyleSheet.absoluteFill },

  topOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    ...(Shadows.card as object),
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surfaceWhite,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    height: 44,
    gap: 8,
    ...(Shadows.card as object),
  },
  searchInput: {
    flex: 1,
    fontSize: Typography.fontSize.base,
    color: Colors.textPrimary,
    fontFamily: Typography.fontFamily.regular,
  },
  serviceChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    marginLeft: 52,
  },
  serviceChipText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
  },

  myLocBtn: {
    position: "absolute",
    right: Spacing.lg,
    bottom: 220,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    ...(Shadows.card as object),
  },

  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surfaceWhite,
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
    padding: Spacing.lg,
    paddingBottom: Platform.OS === "ios" ? 34 : Spacing.lg,
    gap: Spacing.base,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.shimmerBase,
    alignSelf: "center",
    marginBottom: Spacing.xs,
  },
  sheetLabel: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  addressIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  addressText: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  addressHint: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textMuted,
    fontFamily: Typography.fontFamily.regular,
    marginTop: 2,
  },
});

