/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'app-bg':    '#EEF0F4',
        'surface-1': '#FFFFFF',
        'surface-2': '#F6F7F9',
        'surface-3': '#F0F2F5',
        'app-border':'#C4CBD5',
        'txt-primary':   '#16181D',
        'txt-secondary': '#5D6470',
        'txt-muted':     '#7B828E',
        'accent':        '#1355E0',
        'accent-hover':  '#0B44B8',
        'accent-bg':     '#E7EEFC',
        'danger':        '#9A4E00',
        'danger-bg':     '#FEF3E7',
        'warning':       '#9A4E00',
        'warning-bg':    '#FEF3E7',
        'success':       '#0B6650',
        'success-bg':    '#E3F1EC',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Thai"', '"IBM Plex Sans"', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
