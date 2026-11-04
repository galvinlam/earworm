/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Deep studio-console palette. Named semantically so components never
        // hardcode hex values.
        ink: {
          950: '#07080c',
          900: '#0b0d14',
          850: '#10121c',
          800: '#151824',
          700: '#1d2130',
          600: '#272c3d',
          500: '#363c52',
        },
        amber: {
          glow: '#f4b860',
        },
        accent: {
          DEFAULT: '#7c6cff',
          soft: '#9b8fff',
          dim: '#4c42a8',
        },
        mint: '#4ad6a8',
        rose: '#ff6b81',
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 50px -20px rgba(0,0,0,0.8)',
        glow: '0 0 0 1px rgba(124,108,255,0.35), 0 8px 30px -8px rgba(124,108,255,0.45)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%': { transform: 'scale(1.5)', opacity: '0' },
          '100%': { transform: 'scale(1.5)', opacity: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s cubic-bezier(0.22,1,0.36,1) both',
        shimmer: 'shimmer 1.6s linear infinite',
        'pulse-ring': 'pulse-ring 1.4s cubic-bezier(0.4,0,0.6,1) infinite',
      },
    },
  },
  plugins: [],
};
