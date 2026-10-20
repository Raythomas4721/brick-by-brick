import { realpathSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Windows can redirect this folder to another physical path; resolving through one
// canonical root keeps Vite from bundling two copies of React.
const root = realpathSync.native(process.cwd());

export default defineConfig({
  root,
  plugins: [react()],
  base: './',
  resolve: { dedupe: ['react', 'react-dom'] },
  test: { globals: true },
});
