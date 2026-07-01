/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@titan-design/react-ui/tailwind.config.js')],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './node_modules/@titan-design/react-ui/dist/**/*.{js,mjs}',
  ],
};
