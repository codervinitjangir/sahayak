import { describe, expect, it } from "vitest";
import { circlePolygon } from "../src/components/map/geo";

// Haversine distance in metres, independent of the implementation under test.
function metres(a: [number, number], b: [number, number]): number {
  const R = 6_371_000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

describe("circlePolygon", () => {
  const center = { latitude: 12.9716, longitude: 77.5946 };

  it("returns a closed GeoJSON ring (first point equals last)", () => {
    const ring = circlePolygon(center, 900).geometry.coordinates[0];
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("puts every vertex at the requested radius, within 1%", () => {
    const ring = circlePolygon(center, 900).geometry.coordinates[0] as [number, number][];
    for (const p of ring) {
      expect(Math.abs(metres([center.longitude, center.latitude], p) - 900)).toBeLessThan(9);
    }
  });

  it("uses [longitude, latitude] order, as GeoJSON requires", () => {
    const [lng, lat] = circlePolygon(center, 900).geometry.coordinates[0][0];
    expect(lng).toBeGreaterThan(77);
    expect(lat).toBeLessThan(13);
  });
});
