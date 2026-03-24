import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  server: {
    port: 5173,
    hmr: true
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/popup/popup.html'),
        background: path.resolve(__dirname, 'src/background.ts'),
        offscreen: path.resolve(__dirname, 'src/offscreen.html')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },
  plugins: [
    {
      name: 'copy-manifest',
      generateBundle() {
        const manifestContent = fs.readFileSync(
          path.resolve(__dirname, 'src/manifest.json'),
          'utf-8'
        );
        this.emitFile({
          fileName: 'manifest.json',
          source: manifestContent,
          type: 'asset'
        });
      }
    },
    {
      name: 'copy-icons',
      writeBundle() {
        const sourceDir = path.resolve(__dirname, 'icons');
        const destDir = path.resolve(__dirname, 'dist/icons');

        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }

        if (fs.existsSync(sourceDir)) {
          const files = fs.readdirSync(sourceDir);
          
          files.forEach((file) => {
            const source = path.join(sourceDir, file);
            const dest = path.join(destDir, file);
            
            if (fs.statSync(source).isFile()) {
              fs.copyFileSync(source, dest);
            }
          });
        }
      }
    }
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});