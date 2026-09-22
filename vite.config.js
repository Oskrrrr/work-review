import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
    base: './',
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            manifest: {
                name: '工作脉络',
                short_name: '工作脉络',
                description: '从 WPS 工作记录生成个人工作时间线与年度复盘',
                theme_color: '#176b4d',
                background_color: '#f4f7f4',
                display: 'standalone',
                start_url: '/',
                icons: [
                    { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
                    { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' }
                ]
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,svg}'],
                navigateFallback: '/index.html'
            }
        })
    ]
});
