/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'gym-dark': '#0b0f14',
        'gym-card': '#161b22',
        'gym-border': '#30363d',
        'gym-accent': '#00d9ff',
        'gym-accent-red': '#ff0050',
      },
    },
  },
  plugins: [],
}
