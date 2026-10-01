// ─── Sahayak — Shared Persistent Map Canvas ──────────────────────────────────
// Continuous full-bleed map background across the entire assistance flow.
// Uses MockMapCanvas to render an authentic Uber/Ola-style street vector map reliably
// across all platforms in Expo Go without requiring Google Maps API keys.
import React from "react";
import MockMapCanvas, { type MockMapCanvasProps } from "./MockMapCanvas";

export type SharedMapCanvasProps = MockMapCanvasProps;

export default function SharedMapCanvas(props: SharedMapCanvasProps) {
  return <MockMapCanvas {...props} />;
}
