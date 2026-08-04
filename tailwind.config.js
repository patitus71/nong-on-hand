/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'app-bg':    '#0f1115',
        'surface-1': '#1b1e26',
        'surface-2': '#22252f',
        'app-border':'#2a2e39',
        'txt-primary':   '#eceef2',
        'txt-secondary': '#9aa0ac',
        'txt-muted':     '#666c78',
        'accent':        '#6d8cff',
        'accent-hover':  '#5a78e8',
        'accent-bg':     '#1c2340',
        'danger':        '#ef5a5a',
        'danger-bg':     '#3a1f22',
        'warning':       '#e3a83e',
        'warning-bg':    '#3a2f1a',
        'success':       '#4fbf7a',
        'success-bg':    '#153323',
      },
      fontFamily: {
        sans: ['Inter', '"IBM Plex Sans Thai"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
