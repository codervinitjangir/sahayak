import { useQuery } from "@tanstack/react-query";
import { jobsApi } from "../../services/api/jobs";
import { vehiclesApi } from "../../services/api/vehicles";
import { servicesApi } from "../../services/api/services";
import { notificationsApi } from "../../services/api/notifications";
import { TERMINAL_STATUSES, type BackendJobStatus } from "../../components/ui/kit";

/** Re-poll while a request is in flight; stay quiet otherwise. */
const ACTIVE_POLL_MS = 8000;

export const QK = {
  jobs: ["owner", "jobs"] as const,
  vehicles: ["owner", "vehicles"] as const,
  services: ["catalogue"] as const,
  unread: ["owner", "unread"] as const,
  notifications: ["owner", "notifications"] as const,
};

export function useMyJobs() {
  return useQuery({
    queryKey: QK.jobs,
    queryFn: () => jobsApi.fetchMyJobs(50, 0).then((p) => p.items),
    refetchInterval: (q) =>
      q.state.data?.some((j) => !TERMINAL_STATUSES.includes(j.status as BackendJobStatus)) ? ACTIVE_POLL_MS : false,
  });
}

export function useMyVehicles() {
  return useQuery({ queryKey: QK.vehicles, queryFn: () => vehiclesApi.fetchVehicles() });
}

export function useCatalogue() {
  return useQuery({ queryKey: QK.services, queryFn: () => servicesApi.listServices(), staleTime: 15 * 60_000 });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: QK.unread,
    queryFn: () => notificationsApi.getUnreadCount(),
    refetchInterval: 30_000,
  });
}

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: QK.notifications,
    queryFn: () => notificationsApi.listNotifications(30, 0),
    enabled,
  });
}

export const isActiveStatus = (s: string) => !TERMINAL_STATUSES.includes(s as BackendJobStatus);

export function formatWhen(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `Today, ${time}` : `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}
