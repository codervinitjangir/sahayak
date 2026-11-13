/** @type {import('tailwindcss').Config} */
// Tokens mirror docs/DESIGN-SYSTEM.md and mobile/src/constants/theme.ts.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          500: '#14B8A6',
          600: '#0D9488',
          700: '#0F766E', // primary action
          800: '#115E59',
          900: '#134E4A',
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
          DEFAULT: '#0F172A',
          soft: '#475569',
          muted: '#64748B',
        },
        line: {
          DEFAULT: '#E2E8F0',
          subtle: '#EEF2F6',
        },
        surface: '#FFFFFF',
        canvas: '#F6F8FA',
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
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        control: '12px',
        card: '16px',
        sheet: '24px',
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
