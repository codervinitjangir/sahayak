export type JobStatus =
  | 'requested'
  | 'matching'
  | 'assigned'
  | 'partner_en_route'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_match_found';

export type AssignmentStatus =
  | 'offered'
  | 'accepted'
  | 'rejected'
  | 'timed_out'
  | 'completed';

export interface LocationPoint {
  lat: number;
  lng: number;
  address?: string;
}

export interface ServiceCategory {
  id: number;
  code: string;
  name: string;
}

export interface Service {
  id: number;
  category_id: number;
  code: string;
  name: string;
  requires_vehicle_equipment: boolean;
  category?: ServiceCategory;
  estimated_price?: number;
}

export interface JobAssignment {
  id: string;
  job_id: string;
  partner_id: string;
  status: AssignmentStatus;
  offered_at: string;
  responded_at?: string;
  accepted_at?: string;
  distance_at_offer_m?: number;
  estimated_arrival_min?: number;
  matching_score?: number;
  assignment_rank?: number;
  rejection_reason?: string;
  score_components?: {
    distance: number;
    load: number;
    skill: number;
    rating: number;
  };
  partner_name?: string;
  partner_phone?: string;
  partner_rating?: number | string;
  partner_rating_count?: number;
  was_baseline_choice?: boolean;
}

export interface JobTimelineEvent {
  status: JobStatus;
  timestamp?: string;
  created_at?: string;
  note?: string;
  title?: string;
  description?: string;
}

export interface Job {
  id: string;
  user_id?: string;
  vehicle_id: string;
  vehicle_number?: string;
  service_id?: number;
  service_code?: string;
  service?: Service;
  status: JobStatus;
  pickup_location?: LocationPoint;
  pickup_lat?: number;
  pickup_lng?: number;
  pickup_address_text?: string;
  drop_location?: LocationPoint;
  drop_lat?: number;
  drop_lng?: number;
  issue_description?: string;
  issue_photo_urls?: string[];
  price_estimate?: number;
  price_final?: number;
  requested_at: string;
  completed_at?: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  current_assignment?: JobAssignment;
  timeline?: JobTimelineEvent[] | Partial<Record<JobStatus, string>>;
  partner?: {
    id: string;
    name: string;
    phone: string;
    rating_avg: number;
    rating_count: number;
  };
}

export interface CreateJobPayload {
  service_code: string;
  pickup_lat: number;
  pickup_lng: number;
  vehicle_id?: string;
  pickup_address_text?: string;
  drop_lat?: number;
  drop_lng?: number;
  issue_description?: string;
  issue_photo_urls?: string[];
  /** @deprecated Kept for backward compatibility */
  service_id?: number;
  /** @deprecated Kept for backward compatibility */
  pickup?: LocationPoint;
  /** @deprecated Kept for backward compatibility */
  drop_location?: LocationPoint;
}

export interface RatingItem {
  id: string;
  job_id: string;
  rated_by: 'user' | 'partner';
  rating: number;
  comment?: string | null;
  created_at: string;
}

export interface JobRatingsResponse {
  job_id: string;
  job_status: string;
  ratings: RatingItem[];
  can_rate: boolean;
}


/** One row of `GET /api/v1/services`. No price — the backend holds none. */
export interface ServiceCatalogItem {
  id: number;
  code: string;
  name: string;
  requires_vehicle_equipment: boolean;
  category_id?: number | null;
  category_code?: string | null;
  category_name?: string | null;
}

export interface ServiceCatalogResponse {
  items: ServiceCatalogItem[];
  total: number;
}

/**
 * One row of `GET /api/v1/jobs` — a job the caller was party to.
 *
 * `counterpart_name` is the partner for an owner and the owner for a partner.
 * There is no phone number here by design: contact details are released on
 * `GET /jobs/{id}`, where ADR-017's gate lives. And no `price_estimate`, because
 * nothing server-side ever writes one.
 */
export interface JobHistoryItem {
  id: string;
  status: JobStatus;
  service_code: string;
  service_name: string;
  vehicle_id?: string | null;
  vehicle_number?: string | null;
  pickup_address_text?: string | null;
  issue_description?: string | null;
  price_final?: number | string | null;
  requested_at: string;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  counterpart_name?: string | null;
}

/** Paginated exactly like the notification feed — same fields, same `has_more`. */
export interface JobHistoryPage {
  items: JobHistoryItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}
