/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        oled: '#000000',
        surface: '#09090b',
        elevated: '#18181b',
        border: '#27272a',
        accent: {
          DEFAULT: '#dc2626',
          light: '#ef4444',
          dark: '#991b1b',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'accent-glow': '0 0 0 1px rgba(220,38,38,0.35), 0 8px 24px -8px rgba(220,38,38,0.45)',
      },
    },
  },
  plugins: [],
};
