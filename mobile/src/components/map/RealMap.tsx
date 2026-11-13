// Native real map (Apple Maps on iOS, Google Maps on Android) via react-native-maps.
// The web build uses RealMap.web.tsx (Leaflet + OpenStreetMap) instead.
import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";

import { Colors } from "../../constants/theme";
import type { LatLng } from "../../types";
import { useRoute } from "./useRoute";

export interface RealMapProps {
  userLocation: LatLng;
  partnerLocation?: LatLng | null;
  showRoute?: boolean;
  showRadar?: boolean;
  radarRadius?: number;
  draggable?: boolean;
  onUserMarkerDragEnd?: (coord: LatLng) => void;
}

const DELTA = 0.012;

export default function RealMap({
  userLocation,
  partnerLocation,
  showRoute = false,
  showRadar = false,
  radarRadius = 900,
  draggable = false,
  onUserMarkerDragEnd,
}: RealMapProps) {
  const mapRef = useRef<MapView>(null);
  const route = useRoute(userLocation, partnerLocation, showRoute);

  // Centre slightly south of the pin so it sits in the upper third, clear of the sheet.
  useEffect(() => {
    mapRef.current?.animateToRegion(
      {
        latitude: userLocation.latitude - DELTA * 0.18,
        longitude: userLocation.longitude,
        latitudeDelta: DELTA,
        longitudeDelta: DELTA,
      },
      400
    );
  }, [userLocation.latitude, userLocation.longitude]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: userLocation.latitude - DELTA * 0.18,
          longitude: userLocation.longitude,
          latitudeDelta: DELTA,
          longitudeDelta: DELTA,
        }}
        showsCompass={false}
        toolbarEnabled={false}
        userInterfaceStyle="light"
        showsPointsOfInterests={false}
      >
        {showRadar && (
          <Circle
            center={userLocation}
            radius={radarRadius}
            strokeColor="rgba(15,118,110,0.9)"
            fillColor="rgba(15,118,110,0.16)"
          />
        )}
        {showRoute && route.length > 1 && (
          <Polyline coordinates={route} strokeColor={Colors.brand700} strokeWidth={5} />
        )}
        <Marker
          coordinate={userLocation}
          draggable={draggable}
          onDragEnd={(e) => onUserMarkerDragEnd?.(e.nativeEvent.coordinate)}
          title="Your breakdown spot"
        >
          <Ionicons name="location" size={38} color={Colors.brand700} />
        </Marker>
        {partnerLocation && (
          <Marker coordinate={partnerLocation} title="Partner">
            <Ionicons name="car-sport" size={30} color="#111" />
          </Marker>
        )}
      </MapView>
    </View>
  );
}
