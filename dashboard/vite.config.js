import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Cashy',
        short_name: 'Cashy',
        description: 'Gestión de cashflow del consultorio',
        theme_color: '#0747A6',
        background_color: '#F4F5F7',
        display: 'standalone',
        start_url: '/',
        orientation: 'portrait',
        // Chrome pide PNG de 192 y 512 para habilitar el banner de instalación;
        // con sólo el SVG la instalación en Android queda a medias. Los PNG van
        // aplanados (sin alfa) porque Android aplica su propia máscara y las
        // esquinas transparentes se verían negras.
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
