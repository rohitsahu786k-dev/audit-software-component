/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Be Vietnam Pro'", "'Segoe UI'", 'system-ui', 'sans-serif'],
      },
      colors: {
        brand:   { DEFAULT: '#c0392b', light: '#fef2f2' },
        accent:  { DEFAULT: '#2563eb', light: '#eff6ff' },
        green:   { DEFAULT: '#16a34a', bg: '#f0fdf4' },
        amber:   { DEFAULT: '#d97706', bg: '#fffbeb' },
        red:     { DEFAULT: '#dc2626', bg: '#fef2f2' },
        purple:  { DEFAULT: '#7c3aed', bg: '#f5f3ff' },
        teal:    { DEFAULT: '#0d9488', bg: '#f0fdfa' },
        bg:      { DEFAULT: '#f5f6fa', 2: '#ffffff', 3: '#eef0f5' },
        border:  { DEFAULT: '#e2e5ed', 2: '#c8cdd8' },
        text:    { DEFAULT: '#1a1d2e', 2: '#4a5068', 3: '#8b92a8' },
      },
      borderRadius: { app: '10px' },
      boxShadow: {
        app:    '0 1px 3px rgba(0,0,0,.08)',
        'app-md': '0 4px 16px rgba(0,0,0,.12)',
      },
      width: { sidebar: '252px' },
    },
  },
  plugins: [],
};
