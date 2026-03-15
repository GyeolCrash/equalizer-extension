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
    sourcemap: true,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/popup/popup.html'),
        offscreen: path.resolve(__dirname, 'src/offscreen.html'),
        background: path.resolve(__dirname, 'src/background.ts')
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
      /**
       * writeBundle 훅: Rollup이 모든 번들 파일을 디스크에 쓴 후 호출
       * 루트 icons 디렉토리의 모든 이미지 파일을 dist/icons로 복사
       * 사용자가 제공한 실제 아이콘 이미지 사용
       */
      writeBundle() {
        const sourceDir = path.resolve(__dirname, 'icons');
        const destDir = path.resolve(__dirname, 'dist/icons');

        // 대상 디렉토리 생성
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
          console.log(`[icons] 디렉토리 생성: ${destDir}`);
        }

        // 루트 icons 디렉토리가 존재하면 모든 파일 복사
        if (fs.existsSync(sourceDir)) {
          const files = fs.readdirSync(sourceDir);
          
          files.forEach((file) => {
            const source = path.join(sourceDir, file);
            const dest = path.join(destDir, file);
            
            // 파일만 복사 (디렉토리 제외)
            if (fs.statSync(source).isFile()) {
              fs.copyFileSync(source, dest);
              console.log(`[icons] 복사: ${file} → dist/icons/`);
            }
          });

          console.log(`✓ 아이콘 복사 완료: ${files.length}개 파일`);
        } else {
          console.warn('[icons] 루트 icons 디렉토리를 찾을 수 없습니다.');
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
