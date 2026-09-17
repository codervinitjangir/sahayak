import axios from "axios";
import { API_BASE_URL } from "../../constants";

// ─── Axios instance ───────────────────────────────────────────────────────────
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

// ─── Auth token interceptor ───────────────────────────────────────────────────
// TODO: wire up Zustand auth store token once auth is implemented
apiClient.interceptors.request.use((config) => {
  // const token = useAuthStore.getState().token;
  // if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── Response envelope unwrapping ─────────────────────────────────────────────
// The backend wraps every success as `{ data: ..., meta: { request_id } }`.
// Axios puts the HTTP body on `res.data`, so without this step each call site
// receives the envelope where it expects the payload. That failure is silent:
// the generics below are asserted, not validated, so TypeScript stays quiet and
// every field read comes back undefined at runtime. Unwrapped once here, at the
// contract boundary, so the call sites in jobs.ts stay as they are.
apiClient.interceptors.response.use(
  (res) => {
    const body: unknown = res.data;
    // Guarded rather than unconditional: anything that is not an envelope
    // (a proxy error page, a third-party endpoint) passes through untouched
    // instead of being turned into undefined.
    if (
      body !== null &&
      typeof body === "object" &&
      "data" in body &&
      "meta" in body
    ) {
      res.data = (body as { data: unknown }).data;
    }
    return res;
  },
  (error) => {
    // Failures use a different envelope — `{ error: { code, message },
    // request_id }` — so they are left intact for the caller to read.
    console.error("[API Error]", error?.response?.data ?? error.message);
    return Promise.reject(error);
  }
);
