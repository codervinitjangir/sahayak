# Rule: Typed API Client & Error Handling Conventions

## API Architecture
- Base Endpoint: `/api/v1`
- Content Type: `application/json`
- Auth Header: `Authorization: Bearer <token>`

## Envelopes

### Standard Response Envelope
All successful API responses return a structured data payload with metadata:
```json
{
  "data": { ... },
  "meta": {
    "request_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
  }
}
```

### Standard Error Envelope
All API errors return a uniform error object:
```json
{
  "error": {
    "code": "INVALID_STATE",
    "message": "Job cannot be completed before it is in progress."
  },
  "request_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

## Idempotency Key Requirement
- For state-creating requests (specifically `POST /jobs`), the client **MUST** generate and send an `Idempotency-Key` HTTP header (UUID v4).
- This prevents duplicate job submissions if a user on a flaky network taps submit multiple times.

## HTTP Status Handling
- `400`: Validation failure (display field errors).
- `401`: Unauthorized / expired session (trigger refresh or redirect to login).
- `403`: Forbidden (user role lacks permission for this endpoint).
- `404`: Not Found (resource does not exist or user lacks access).
- `409`: Conflict (e.g. concurrent accept race or invalid state transition).
- `422`: Unprocessable Entity (schema mismatch).
- `429`: Throttled / Rate limited.
- `500`: Internal Server Error (display polite emergency-recovery fallback message).
