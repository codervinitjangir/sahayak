import { apiClient } from "./client";

export interface MobileCatalogService {
  id: number;
  code: string;
  name: string;
  requires_vehicle_equipment: boolean;
  /** ADR-056: car wash. POST /jobs refuses it without scheduled_for. */
  booking_only?: boolean;
  base_price: number | null;
  category_id: number;
  category_code: string | null;
  category_name: string | null;
}

export interface ServiceCatalogResponse {
  items: MobileCatalogService[];
  total: number;
}

export const servicesApi = {
  /** Fetch full unauthenticated service catalogue (GET /api/v1/services)
   *
   * Errors are surfaced rather than swallowed: an empty catalogue and a failed
   * request look identical to a screen that catches to [], and the owner then
   * sees "no services" on a network blip. Callers decide how to retry.
   */
  listServices: () =>
    apiClient
      .get<ServiceCatalogResponse>("/services")
      .then((r) => r.data.items),
};
