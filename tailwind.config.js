/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        hebrew: ['Taamey D Web', 'Frank Ruehl CLM', 'David CLM', 'Times New Roman', 'serif'],
      },
    },
  },
  plugins: [],
}
