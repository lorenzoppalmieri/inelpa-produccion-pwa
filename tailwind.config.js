/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        inelpa: {
          // Paleta tentativa — ajustar con identidad visual oficial
          primary: '#0f172a',
          accent: '#f59e0b',
        },
      },
      fontSize: {
        // Tamaños grandes pensados para PC panel / pantalla táctil de planta
        'touch-sm': ['1.125rem', '1.5rem'],
        'touch-base': ['1.25rem', '1.75rem'],
        'touch-lg': ['1.5rem', '2rem'],
        'touch-xl': ['2rem', '2.5rem'],
      },
      spacing: {
        // Botones grandes, zonas de toque mínimas de 48x48
        'touch': '3rem',
      },
    },
  },
  plugins: [],
}
