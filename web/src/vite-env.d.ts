/// <reference types="vite/client" />

/**
 * Typed contract for the VITE_* vars documented in .env.example.
 *
 * Without this, `import.meta.env.VITE_PARTNR_API_MOCK` is a silent `undefined`
 * that quietly disables mocking instead of a compile error.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_PARTNER_API_MOCK?: string;
}
