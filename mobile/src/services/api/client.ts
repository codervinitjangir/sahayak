import axios from "axios";
import { API_BASE_URL } from "../constants";

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

// ─── Global error handler ─────────────────────────────────────────────────────
apiClient.interceptors.response.use(
  (res) => res,
  (error) => {
    console.error("[API Error]", error?.response?.data ?? error.message);
    return Promise.reject(error);
  }
);
