import { ApiResponse, ApiErrorResponse } from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

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

  const token = localStorage.getItem('sahayak_token');
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
    throw new ApiError(response.status, errorDetail, errorPayload?.request_id);
  }

  return json as ApiResponse<T>;
}
