/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Material-style tonal palette, warmed slightly for the Gulf market.
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          200: '#bcd3ff',
          300: '#8eb6ff',
          400: '#598eff',
          500: '#3366f2',
          600: '#1f47d6',
          700: '#1a38ad',
          800: '#1b328a',
          900: '#1c2f6d',
        },
        sand: { 50: '#faf8f5', 100: '#f3efe8', 200: '#e6ded1' },
      },
      fontFamily: {
        sans: ['Inter', 'Roboto', 'system-ui', '-apple-system', 'Segoe UI', 'Arial', 'sans-serif'],
        arabic: ['Noto Kufi Arabic', 'Tajawal', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        // Material elevation levels 1 and 2.
        e1: '0 1px 2px 0 rgb(0 0 0 / 0.06), 0 1px 3px 1px rgb(0 0 0 / 0.08)',
        e2: '0 1px 2px 0 rgb(0 0 0 / 0.06), 0 2px 6px 2px rgb(0 0 0 / 0.10)',
      },
    },
  },
  plugins: [],
};
