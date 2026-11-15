// ─── Sahayak: notification presentation + routing ─────────────────────────────
// One table that turns a backend notification event (notification_service
// NOTIFICATION_EVENTS) into what the user sees and where a tap takes them.
// Shared by the in-app list and by push taps so the two cannot disagree.
// Pure: no React Native imports, so it is unit-testable.

export type NotificationTone = "brand" | "success" | "warning" | "danger" | "info";

export interface NotificationMeta {
  title: string;
  icon: string; // Ionicons glyph name
  tone: NotificationTone;
}

const META: Record<string, NotificationMeta> = {
  job_offered: { title: "New job offer", icon: "flash", tone: "brand" },
  job_accepted: { title: "Partner assigned", icon: "person-circle", tone: "info" },
  job_partner_en_route: { title: "Partner on the way", icon: "navigate", tone: "info" },
  job_in_progress: { title: "Work started", icon: "construct", tone: "brand" },
  job_completed: { title: "Request completed", icon: "checkmark-circle", tone: "success" },
  job_cancelled_by_owner: { title: "Job cancelled by owner", icon: "close-circle", tone: "danger" },
  job_cancelled_by_partner: { title: "Partner cancelled", icon: "refresh-circle", tone: "warning" },
  job_cancelled_by_support: { title: "Cancelled by Sahayak", icon: "close-circle", tone: "danger" },
  job_no_match_found: { title: "No partner found", icon: "alert-circle", tone: "warning" },
  job_reassigned_by_support: { title: "Job moved", icon: "swap-horizontal", tone: "warning" },
  job_reassigning: { title: "Finding another partner", icon: "search", tone: "info" },
};

export function notificationMeta(event: string): NotificationMeta {
  return (
    META[event] ?? {
      title: event.replace(/^job_/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      icon: "notifications",
      tone: "brand",
    }
  );
}

export type NotificationRoute =
  | { name: "OwnerFlow"; params: { jobId: string } }
  | { name: "ActiveJob"; params: { jobId: string } }
  | { name: "PartnerHome"; params?: undefined }
  | null;

/** Where tapping a notification should land. null = stay where you are. */
export function routeForNotification(
  role: "owner" | "partner" | string | undefined,
  event: string,
  jobId: string | null | undefined
): NotificationRoute {
  if (role === "partner") {
    // An offer opens from the dashboard, which re-reads it live: the push
    // carries no offer payload and an expired offer must not open.
    if (event === "job_offered") return { name: "PartnerHome" };
    // A job that left the partner has nothing to act on.
    if (!jobId || event.startsWith("job_cancelled") || event === "job_reassigned_by_support") {
      return { name: "PartnerHome" };
    }
    return { name: "ActiveJob", params: { jobId } };
  }
  if (!jobId) return null;
  return { name: "OwnerFlow", params: { jobId } };
}
