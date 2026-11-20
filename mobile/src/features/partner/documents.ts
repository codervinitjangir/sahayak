// ─── Partner documents (ADR-038) ──────────────────────────────────────────────
// Labels and the two-step upload: ask the backend for a one-time URL, PUT the
// file straight to the private bucket, then confirm. The phone never holds a
// storage key and never gets a document back.

import type { DocType, PartnerDocumentItem } from "../../services/api/partner";

export const DOC_LABEL: Record<DocType, { title: string; hint: string }> = {
  driving_licence: { title: "Driving licence", hint: "Front side, all four corners visible" },
  photo_id: { title: "Photo ID", hint: "Aadhaar, voter ID or passport" },
  tow_vehicle_rc: { title: "Tow vehicle RC", hint: "Registration certificate of your tow truck" },
  tow_equipment_photo: { title: "Tow equipment photo", hint: "Your flatbed or wheel-lift, clearly shown" },
};

export const STATUS_LABEL: Record<PartnerDocumentItem["status"], string> = {
  missing: "Not uploaded",
  pending: "Under review",
  approved: "Approved",
  rejected: "Needs a new upload",
  expired: "Expired, upload again",
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** May the partner (re)upload this document now? Not while it is approved or in review. */
export function canUpload(status: PartnerDocumentItem["status"]): boolean {
  return status === "missing" || status === "rejected" || status === "expired";
}

/** The picker's mime type, narrowed to what the bucket accepts. */
export function uploadContentType(mime?: string | null): "image/jpeg" | "image/png" | "image/webp" {
  return mime === "image/png" || mime === "image/webp" ? mime : "image/jpeg";
}

/** PUT a local file (file:// or content:// uri) to a signed upload URL. */
export async function putFile(uploadUrl: string, uri: string, contentType: string, send: typeof fetch = fetch): Promise<void> {
  const blob = await (await send(uri)).blob();
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error("TOO_LARGE");
  const res = await send(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
  if (!res.ok) throw new Error(`UPLOAD_${res.status}`);
}
