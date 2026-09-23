---
name: maps-integration
description: Guidelines and patterns for integrating Google Maps API, handling location pickers, GPS fallbacks, and mock map representations.
---

# Skill: Maps Integration

## 1. Google Maps Architecture
- **API Boundary**: Keep maps enrichment non-blocking. A failure of Google Maps must never prevent an owner from submitting a breakdown job or a partner from accepting.
- **Coordinates Contract**:
  - Latitude: Floating point between `-90.0` and `90.0` (Bengaluru is roughly `12.9716`).
  - Longitude: Floating point between `-180.0` and `180.0` (Bengaluru is roughly `77.5946`).
  - Address text: Human-readable string.

## 2. LocationPicker Patterns
- **Three-Tier Fallback Mechanism**:
  1. **Device GPS**: Use browser `navigator.geolocation.getCurrentPosition` with high accuracy.
  2. **Interactive Map Pin**: Interactive draggable pin / map click to update coordinates.
  3. **Address Search / Quick Landmarks**: Bengaluru hotspots (e.g. Indiranagar, Koramangala, Whitefield, MG Road, Electronic City, Hebbal) with manual coordinate input fallback.
- **Offline / Mock Mode**:
  - When `VITE_GOOGLE_MAPS_API_KEY` is not provided or fails to load, render a clean styled SVG interactive mock map with a draggable pin so developers and testers are never blocked.

## 3. Route & ETA Rendering
- Label all ETAs as "Estimated Arrival Time".
- Display route polyline between partner coordinates and breakdown location when `partner_en_route`.
