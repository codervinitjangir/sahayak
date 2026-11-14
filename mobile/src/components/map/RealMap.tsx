// Native real map via MapLibre with OpenFreeMap vector tiles (OpenStreetMap data).
// No API key, no account and no billing: see ADR-031. The web build uses
// RealMap.web.tsx (Leaflet) instead. Map data © OpenStreetMap contributors; the
// attribution control stays on, as the licence requires.
import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  ViewAnnotation,
  type CameraRef,
  type LngLat,
} from "@maplibre/maplibre-react-native";
import { Ionicons } from "@expo/vector-icons";

import { Colors } from "../../constants/theme";
import type { LatLng } from "../../types";
import { circlePolygon } from "./geo";
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

// Free, keyless style. To move to a provider with an SLA (e.g. MapTiler), change this URL.
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const ZOOM = 15;
// Keeps the pin in the upper third of the screen, clear of the bottom sheet.
const SHEET_PADDING = { top: 40, right: 40, bottom: 260, left: 40 };

const toLngLat = (p: LatLng): LngLat => [p.longitude, p.latitude];

export default function RealMap({
  userLocation,
  partnerLocation,
  showRoute = false,
  showRadar = false,
  radarRadius = 900,
  draggable = false,
  onUserMarkerDragEnd,
}: RealMapProps) {
  const cameraRef = useRef<CameraRef>(null);
  const route = useRoute(userLocation, partnerLocation, showRoute);

  // Follow the pin; when a partner is on the way, frame both.
  useEffect(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    if (partnerLocation) {
      const lngs = [userLocation.longitude, partnerLocation.longitude];
      const lats = [userLocation.latitude, partnerLocation.latitude];
      cam.fitBounds(
        [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
        { padding: SHEET_PADDING, duration: 400 }
      );
    } else {
      cam.easeTo({ center: toLngLat(userLocation), zoom: ZOOM, padding: SHEET_PADDING, duration: 400 });
    }
  }, [
    userLocation.latitude,
    userLocation.longitude,
    partnerLocation?.latitude,
    partnerLocation?.longitude,
  ]);

  const radar = useMemo(
    () => (showRadar ? circlePolygon(userLocation, radarRadius) : null),
    [showRadar, userLocation.latitude, userLocation.longitude, radarRadius]
  );

  const routeLine = useMemo<GeoJSON.Feature | null>(
    () =>
      showRoute && route.length > 1
        ? {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: route.map(toLngLat) },
          }
        : null,
    [showRoute, route]
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE_URL}
        compass={false}
        logo={false}
        attribution
        attributionPosition={{ top: 8, right: 8 }}
        touchPitch={false}
        touchRotate={false}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: toLngLat(userLocation), zoom: ZOOM, padding: SHEET_PADDING }}
        />

        {radar && (
          <GeoJSONSource id="radar" data={radar}>
            <Layer
              id="radar-fill"
              type="fill"
              paint={{ "fill-color": "#0F766E", "fill-opacity": 0.16 }}
            />
            <Layer
              id="radar-edge"
              type="line"
              paint={{ "line-color": "#0F766E", "line-opacity": 0.9, "line-width": 1.5 }}
            />
          </GeoJSONSource>
        )}

        {routeLine && (
          <GeoJSONSource id="route" data={routeLine}>
            <Layer
              id="route-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{ "line-color": Colors.brand700, "line-width": 5 }}
            />
          </GeoJSONSource>
        )}

        {/* ViewAnnotation supports dragging; Marker does not. */}
        <ViewAnnotation
          id="user"
          title="Your breakdown spot"
          lngLat={toLngLat(userLocation)}
          anchor="bottom"
          draggable={draggable}
          onDragEnd={(e) => {
            const [longitude, latitude] = e.nativeEvent.lngLat;
            onUserMarkerDragEnd?.({ latitude, longitude });
          }}
        >
          <View accessibilityLabel="Your breakdown spot">
            <Ionicons name="location" size={38} color={Colors.brand700} />
          </View>
        </ViewAnnotation>

        {partnerLocation ? (
          <Marker id="partner" lngLat={toLngLat(partnerLocation)} anchor="center">
            <View accessibilityLabel="Partner">
              <Ionicons name="car-sport" size={30} color="#111" />
            </View>
          </Marker>
        ) : null}
      </Map>
    </View>
  );
}
