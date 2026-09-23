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
