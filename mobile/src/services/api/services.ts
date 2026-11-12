import { apiClient } from "./client";

export interface MobileCatalogService {
  id: number;
  code: string;
  name: string;
  requires_vehicle_equipment: boolean;
  category_id: number;
  category_code: string | null;
  category_name: string | null;
}

export interface ServiceCatalogResponse {
  items: MobileCatalogService[];
  total: number;
}

export const servicesApi = {
  /** Fetch full unauthenticated service catalogue (GET /api/v1/services) */
  listServices: () =>
    apiClient
      .get<ServiceCatalogResponse>("/services")
      .then((r) => r.data.items)
      .catch(() => []),
};
