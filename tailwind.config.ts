import type { Config } from 'tailwindcss';

export default {
    content: ['./src/**/*.{js,ts,jsx,tsx}', './popup.html'],
    theme: {
        extend: {
            colors: {
                popup: {
                    bg: '#1a1a1a',
                    card: '#2a2a2a',
                    border: '#404040',
                    text: '#ffffff',
                    'text-secondary': '#cccccc',
                    accent: '#4f46e5',
                    'accent-hover': '#4338ca',
                    success: '#10b981',
                    warning: '#f59e0b',
                    error: '#ef4444'
                }
            }
        }
    }
} satisfies Config;
