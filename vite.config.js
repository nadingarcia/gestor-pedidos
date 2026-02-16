import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  
  // Configuração base para produção
  base: './',
  
  // Resolve de módulos
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@components': path.resolve(__dirname, './src/components'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@assets': path.resolve(__dirname, './src/assets'),
    }
  },
  
  // Configurações do servidor de desenvolvimento
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    open: false, // Não abrir navegador automaticamente (Electron vai abrir)
  },
  
  // Configurações de build
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false, // Desabilitar sourcemaps em produção
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    rollupOptions: {
      output: {
        manualChunks: {
          // Separar vendor chunks para melhor cache
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        }
      }
    },
    chunkSizeWarningLimit: 1000, // Aumentar limite de warning
  },
  
  // Otimizações
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom']
  },
  
  // Preview (para testar build)
  preview: {
    port: 4173,
    strictPort: true,
  }
})