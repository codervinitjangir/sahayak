// Pure geometry helpers for RealMap, kept free of native imports so they are unit-testable.
import type { LatLng } from "../../types";

const M_PER_DEG_LAT = 111_320;

/** Closed ring approximating a circle of `radiusM` metres; fine at city scale. */
export function circlePolygon(center: LatLng, radiusM: number, steps = 64): GeoJSON.Feature<GeoJSON.Polygon> {
  const latR = (center.latitude * Math.PI) / 180;
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = radiusM / (M_PER_DEG_LAT * Math.cos(latR));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([center.longitude + dLng * Math.cos(a), center.latitude + dLat * Math.sin(a)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}
