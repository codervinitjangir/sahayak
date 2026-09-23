/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          500: '#14B8A6',
          600: '#0D9488',
          700: '#0F766E', // Primary token
          800: '#115E59',
          900: '#134E4A',
        },
        emergency: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          600: '#DC2626',
          700: '#B91C1C', // Danger token
          800: '#991B1B',
        },
        // Partner-console accent — the de-facto choice across 40+ usages in
        // PartnerDashboard, Preferences, OfferTimer focus rings, and toggles.
        // Registered here so every partner page references one token instead
        // of hardcoding the hex. brand-700/teal remains the owner-facing primary.
        accent: {
          DEFAULT: '#F03F3F',
          hover: '#D93434',
        },
        status: {
          success: '#15803D',
          warning: '#B45309',
          danger: '#B91C1C',
          info: '#0284C7',
        },
        surface: '#FFFFFF',
        canvas: '#F8FAFC',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      // `shadow-xs` / `shadow-2xs` are Tailwind v4 names and do not exist in
      // v3, so every one of the ~30 already written across App, Preferences,
      // VerificationStatus and PartnerSignup was silently doing nothing and
      // those panels rendered dead flat. These are the v4 values, which is
      // what the markup was written against.
      boxShadow: {
        '2xs': '0 1px rgb(0 0 0 / 0.05)',
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      },
      // Same story: `backdrop-blur-xs` is a v4 name (3 uses).
      backdropBlur: {
        xs: '4px',
      },
    },
  },
  plugins: [],
}
