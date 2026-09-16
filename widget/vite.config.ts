import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds one self-contained script: dist/bandhu-widget.js exposing window.BandhuAI.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: { entry: 'src/index.tsx', name: 'BandhuAI', formats: ['iife'], fileName: () => 'bandhu-widget.js' },
    cssCodeSplit: false,
    emptyOutDir: true,
  },
  server: { port: 5173 },
});
