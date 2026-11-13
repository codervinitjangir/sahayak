// Static settings live in app.json. Anything secret or per-environment is injected here
// so it never lands in the repository. Set GOOGLE_MAPS_API_KEY in the build
// environment (EAS secret or local shell) and restrict the key to this app's bundle
// id / package name and the Maps SDKs in the Google Cloud console.
module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    config: { googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY },
  },
  android: {
    ...config.android,
    config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_API_KEY } },
  },
});
