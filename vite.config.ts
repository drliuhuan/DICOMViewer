import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // dicom-image-loader 的解码 Worker 内部存在代码分割，需使用 ES Module Worker
  worker: {
    format: 'es',
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            /[@\\/]cornerstonejs[\\/]/.test(id) ||
            id.includes('@kitware/vtk.js') ||
            id.includes('dicom-parser')
          ) {
            return 'cornerstone';
          }
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return 'react-vendor';
          }
          return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
