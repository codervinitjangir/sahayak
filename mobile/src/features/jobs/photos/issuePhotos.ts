// ADR-055: the owner's photos of the problem. Pure upload logic, kept apart from
// the screen so it can be tested without React Native.
import { putFile, uploadContentType } from "../../partner/documents";
import { safeguardsApi } from "../../../services/api/safeguards";

export const MAX_ISSUE_PHOTOS = 3;

export interface PickedPhoto {
  uri: string;
  mimeType?: string | null;
}

type Api = Pick<typeof safeguardsApi, "startIssuePhoto" | "confirmIssuePhoto">;

/** Upload one picked photo to a job: ticket, PUT, confirm. Throws on failure. */
export async function uploadIssuePhoto(
  jobId: string,
  photo: PickedPhoto,
  api: Api = safeguardsApi,
  put: typeof putFile = putFile,
): Promise<void> {
  const contentType = uploadContentType(photo.mimeType);
  const ticket = await api.startIssuePhoto(jobId, contentType);
  await put(ticket.upload_url, photo.uri, contentType);
  await api.confirmIssuePhoto(jobId, ticket.photo_id);
}

/** Upload every photo, one at a time (low-end phones, weak signal), and report
 * how many failed. A failed photo never fails the request it belongs to. */
export async function uploadIssuePhotos(
  jobId: string,
  photos: PickedPhoto[],
  upload: (jobId: string, p: PickedPhoto) => Promise<void> = uploadIssuePhoto,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const p of photos.slice(0, MAX_ISSUE_PHOTOS)) {
    try {
      await upload(jobId, p);
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  return { sent, failed };
}
