/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // rgb(var(--x) / <alpha-value>) — NOT a plain hex/var() — so that Tailwind's
        // opacity modifiers (bg-success/10, border-danger/40, ...) keep working once
        // --x holds an "R G B" triple that flips between the light/dark palettes in
        // globals.css. See the comment above :root there before touching this list.
        'app-bg':    'rgb(var(--bg) / <alpha-value>)',
        'surface-1': 'rgb(var(--surface-1) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        'surface-3': 'rgb(var(--surface-3) / <alpha-value>)',
        'app-border':'rgb(var(--border) / <alpha-value>)',
        'txt-primary':   'rgb(var(--text-primary) / <alpha-value>)',
        'txt-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',
        'txt-muted':     'rgb(var(--text-muted) / <alpha-value>)',
        'accent':        'rgb(var(--accent) / <alpha-value>)',
        'accent-hover':  'rgb(var(--accent-hover) / <alpha-value>)',
        'accent-bg':     'rgb(var(--accent-bg) / <alpha-value>)',
        'danger':        'rgb(var(--danger) / <alpha-value>)',
        'danger-bg':     'rgb(var(--danger-bg) / <alpha-value>)',
        'warning':       'rgb(var(--warning) / <alpha-value>)',
        'warning-bg':    'rgb(var(--warning-bg) / <alpha-value>)',
        'success':       'rgb(var(--success) / <alpha-value>)',
        'success-bg':    'rgb(var(--success-bg) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Thai"', '"IBM Plex Sans"', 'Inter', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
