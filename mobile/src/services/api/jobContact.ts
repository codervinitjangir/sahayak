import { apiClient } from "./client";

// ADR-057 owner live location, ADR-058 job chat. Owner and accepted partner only.

export interface OwnerLocation {
  lat?: number | null;
  lng?: number | null;
  accuracy_m?: number | null;
  updated_at?: string | null;
  sharing: boolean;
}

export interface JobMessage {
  id: string;
  sender: "owner" | "partner";
  mine: boolean;
  body: string;
  created_at: string;
}

export interface JobMessageList {
  items: JobMessage[];
  can_send: boolean;
}

export const jobContactApi = {
  async shareOwnerLocation(jobId: string, lat: number, lng: number, accuracy_m?: number | null): Promise<OwnerLocation> {
    const r = await apiClient.put<any>(`/jobs/${jobId}/owner-location`, { lat, lng, accuracy_m: accuracy_m ?? null });
    return r.data;
  },
  async getOwnerLocation(jobId: string): Promise<OwnerLocation> {
    const r = await apiClient.get<any>(`/jobs/${jobId}/owner-location`);
    return r.data;
  },
  async listMessages(jobId: string): Promise<JobMessageList> {
    const r = await apiClient.get<any>(`/jobs/${jobId}/messages`);
    return r.data;
  },
  async sendMessage(jobId: string, body: string): Promise<JobMessage> {
    const r = await apiClient.post<any>(`/jobs/${jobId}/messages`, { body });
    return r.data;
  },
};
