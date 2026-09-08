// ─── Shared TypeScript types ──────────────────────────────────────────────────

export type UserRole = "owner" | "partner";

export interface User {
  id: string;
  full_name: string;
  phone: string;
  email?: string;
  role: UserRole;
  avatar_url?: string;
  created_at: string;
}

export interface Vehicle {
  id: string;
  owner_id: string;
  make: string;
  model: string;
  year: number;
  license_plate: string;
  vehicle_type: "two_wheeler" | "four_wheeler" | "heavy";
}

export interface Location {
  latitude: number;
  longitude: number;
  address?: string;
}

export type JobStatus =
  | "pending"
  | "assigned"
  | "en_route"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface Job {
  id: string;
  owner_id: string;
  partner_id?: string;
  vehicle_id: string;
  service_type: string;
  status: JobStatus;
  description?: string;
  location: Location;
  created_at: string;
  updated_at: string;
}

export interface Partner {
  id: string;
  user_id: string;
  business_name: string;
  services: string[];
  rating: number;
  total_jobs: number;
  location: Location;
  distance_km?: number; // computed during dispatch
}
