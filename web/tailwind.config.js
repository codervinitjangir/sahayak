/** @type {import('tailwindcss').Config} */
// Tokens mirror docs/DESIGN-SYSTEM.md and mobile/src/constants/theme.ts.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F1F2F4',
          100: '#E4E6EA',
          200: '#D4D7DC',
          500: '#3A3D44',
          600: '#24262B',
          700: '#111111', // primary action
          800: '#000000',
          900: '#141518',
        },
        emergency: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          600: '#DC2626',
          700: '#B91C1C',
          800: '#991B1B',
        },
        // Partner console accent: kept as an alias of the emergency red so the
        // existing partner markup keeps resolving to one token.
        accent: {
          DEFAULT: '#DC2626',
          hover: '#B91C1C',
        },
        status: {
          success: '#15803D',
          warning: '#B45309',
          danger: '#B91C1C',
          info: '#0369A1',
        },
        ink: {
          DEFAULT: '#111111',
          soft: '#475569',
          muted: '#64748B',
        },
        line: {
          DEFAULT: '#E3E5E9',
          subtle: '#EEF2F6',
        },
        surface: '#FFFFFF',
        canvas: '#EEF0F3',
        // Legacy alias, retained so shared primitives keep compiling; same as surface.
        paper: { DEFAULT: '#F6F8FA', card: '#FFFFFF' },
        pastel: {
          blue: '#AFCBEA', 'blue-deep': '#28486B',
          sage: '#C7DAB9', 'sage-deep': '#33502A',
          butter: '#F3D98B', 'butter-deep': '#6B4F0E',
          coral: '#F0BBA9', 'coral-deep': '#7A3421',
          mint: '#9BD8A9',
        },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Urbanist', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        control: '999px',
        card: '24px',
        sheet: '32px',
      },
      boxShadow: {
        '2xs': '0 1px rgb(0 0 0 / 0.05)',
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        float: '0 12px 32px -8px rgba(15, 23, 42, 0.18)',
        card: '0 1px 2px rgba(15, 23, 42, 0.04)',
      },
      backdropBlur: {
        xs: '4px',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.55' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.8s ease-out infinite',
      },
    },
  },
  plugins: [],
};
