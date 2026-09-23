import { ApiResponse, ApiErrorResponse } from '../types/api';
import { clearAuthToken, getAuthToken } from './authToken';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

/**
 * Dispatched on the window when the API rejects our credentials, so session state
 * can reset. There is no login route yet, so we signal rather than redirect.
 */
export const UNAUTHORIZED_EVENT = 'sahayak:unauthorized';

/**
 * Generates a UUID v4 for the `Idempotency-Key` header.
 *
 * `crypto.randomUUID` only exists in a secure context, so it is absent when the app
 * is opened over plain http on a LAN IP — a normal way to test a mobile-first app on
 * a real phone. Falling back keeps job submission working there instead of throwing.
 */
export function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class ApiError extends Error {
  public code: string;
  public status: number;
  public requestId?: string;
  public details?: Record<string, unknown>;

  constructor(status: number, errorDetail: { code: string; message: string; details?: Record<string, unknown> }, requestId?: string) {
    super(errorDetail.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = errorDetail.code;
    this.details = errorDetail.details;
    this.requestId = requestId;
  }
}

interface RequestOptions extends RequestInit {
  idempotencyKey?: string;
}

export async function apiClient<T>(endpoint: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { idempotencyKey, headers = {}, ...rest } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string>),
  };

  const token = getAuthToken();
  if (token) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  if (idempotencyKey) {
    requestHeaders['Idempotency-Key'] = idempotencyKey;
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...rest,
    headers: requestHeaders,
  });

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(response.status, {
      code: 'PARSE_ERROR',
      message: 'Invalid response from server',
    });
  }

  if (!response.ok) {
    const errorPayload = json as ApiErrorResponse | null;
    const errorDetail = errorPayload?.error || {
      code: `HTTP_${response.status}`,
      message: response.statusText || 'An unexpected error occurred',
    };

    // Session expired or credentials rejected: drop the stale token so we stop
    // sending it, and let the app reset its session state.
    if (response.status === 401) {
      clearAuthToken();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
      }
    }

    throw new ApiError(response.status, errorDetail, errorPayload?.request_id);
  }

  return json as ApiResponse<T>;
}
