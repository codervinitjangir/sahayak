// Route line between two points.
//
// By default this draws a straight connector, which is honest about being
// approximate. When EXPO_PUBLIC_ROUTING_URL points at an OSRM-compatible routing
// service you operate (for example a self-hosted OSRM or Valhalla in front of
// OpenStreetMap data), the real driving geometry is fetched from it instead. The
// public OSRM test instance is deliberately NOT used: it has no SLA and its usage
// policy forbids production traffic.
import { useEffect, useState } from "react";
import type { LatLng } from "../../types";

const ROUTING_URL = (process.env.EXPO_PUBLIC_ROUTING_URL ?? "").replace(/\/+$/, "");

export function useRoute(from?: LatLng | null, to?: LatLng | null, enabled = true): LatLng[] {
  const [path, setPath] = useState<LatLng[]>([]);

  const key =
    from && to && enabled
      ? `${from.latitude.toFixed(5)},${from.longitude.toFixed(5)};${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`
      : "";

  useEffect(() => {
    if (!from || !to || !enabled) {
      setPath([]);
      return;
    }
    setPath([from, to]);
    if (!ROUTING_URL) return;

    let cancelled = false;
    const url =
      `${ROUTING_URL}/route/v1/driving/` +
      `${from.longitude},${from.latitude};${to.longitude},${to.latitude}` +
      `?overview=full&geometries=geojson`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        const coords: [number, number][] | undefined = j?.routes?.[0]?.geometry?.coordinates;
        if (!cancelled && coords?.length) {
          setPath(coords.map(([lng, lat]) => ({ latitude: lat, longitude: lng })));
        }
      })
      .catch(() => {
        /* keep the straight connector */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return path;
}
