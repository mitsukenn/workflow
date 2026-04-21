import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 用の base path。
// リポジトリ名が `workflow-board` 以外の場合は環境変数 BASE で上書きしてください。
// 例: BASE=/my-repo/ npm run build
const base = process.env.BASE || '/workflow/';

export default defineConfig({
  plugins: [react()],
  base,
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
