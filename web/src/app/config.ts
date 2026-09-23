/**
 * App-level runtime configuration.
 *
 * `IS_DEMO_MODE` gates the seeded identities and placeholder data that make the app
 * usable without a backend. It defaults to on during development and off in a
 * production build, so demo scaffolding can never silently ship. Override it
 * explicitly with `VITE_DEMO_MODE=true|false`.
 */

function readDemoModeFlag(): boolean {
  const explicit = import.meta.env.VITE_DEMO_MODE;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return Boolean(import.meta.env.DEV);
}

export const IS_DEMO_MODE = readDemoModeFlag();
