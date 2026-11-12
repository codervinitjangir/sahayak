// ─── Sahayak — Shared Persistent Map Canvas ──────────────────────────────────
// Continuous full-bleed map background across the entire assistance flow.
// Uses StreetVectorCanvas to render an authentic Uber/Ola-style street vector map reliably
// across all platforms in Expo Go without requiring Google Maps API keys.
import React from "react";
import StreetVectorCanvas, { type StreetVectorCanvasProps } from "./StreetVectorCanvas";

export type SharedMapCanvasProps = StreetVectorCanvasProps;

export default function SharedMapCanvas(props: SharedMapCanvasProps) {
  return <StreetVectorCanvas {...props} />;
}
