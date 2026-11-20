import { describe, expect, it, vi } from "vitest";
import { canUpload, putFile, uploadContentType, DOC_LABEL, MAX_UPLOAD_BYTES } from "../src/features/partner/documents";

describe("partner documents (ADR-038)", () => {
  it("allows an upload only when nothing usable is on file", () => {
    expect(["missing", "rejected", "expired"].every((s) => canUpload(s as never))).toBe(true);
    expect(canUpload("pending")).toBe(false);
    expect(canUpload("approved")).toBe(false);
  });

  it("sends only types the bucket accepts", () => {
    expect(uploadContentType("image/png")).toBe("image/png");
    expect(uploadContentType("image/heic")).toBe("image/jpeg");
    expect(uploadContentType(undefined)).toBe("image/jpeg");
  });

  it("labels every document type the backend can require", () => {
    expect(Object.keys(DOC_LABEL).sort()).toEqual(["driving_licence", "photo_id", "tow_equipment_photo", "tow_vehicle_rc"]);
  });

  it("PUTs the file with its type, and refuses one over 5 MB before sending", async () => {
    const small = { blob: async () => ({ size: 10 }) };
    const send = vi.fn().mockResolvedValueOnce(small).mockResolvedValueOnce({ ok: true });
    await putFile("https://u/up", "file:///a.jpg", "image/jpeg", send as never);
    expect(send.mock.calls[1]).toEqual(["https://u/up", expect.objectContaining({ method: "PUT", headers: { "Content-Type": "image/jpeg" } })]);

    const big = vi.fn().mockResolvedValueOnce({ blob: async () => ({ size: MAX_UPLOAD_BYTES + 1 }) });
    await expect(putFile("https://u/up", "file:///b.jpg", "image/jpeg", big as never)).rejects.toThrow("TOO_LARGE");
    expect(big).toHaveBeenCalledTimes(1);
  });

  it("a failed PUT is an error, not a silent success", async () => {
    const send = vi.fn().mockResolvedValueOnce({ blob: async () => ({ size: 1 }) }).mockResolvedValueOnce({ ok: false, status: 400 });
    await expect(putFile("https://u/up", "file:///c.jpg", "image/jpeg", send as never)).rejects.toThrow("UPLOAD_400");
  });
});
