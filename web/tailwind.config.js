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
    },
  },
  plugins: [],
}
