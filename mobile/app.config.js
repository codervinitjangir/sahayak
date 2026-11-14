// Static settings live in app.json. Anything secret or per-environment is injected here
// so it never lands in the repository.
//
// Maps need no key: the native map is MapLibre with OpenFreeMap tiles (ADR-031).
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    // FCM push. EAS builds get the file from the GOOGLE_SERVICES_JSON file variable;
    // local builds fall back to mobile/google-services.json (gitignored).
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
  },
});
