import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.AI_API_KEY': JSON.stringify(env.AI_API_KEY),
      'process.env.AI_MAX_RECURSION_DEPTH': JSON.stringify(env.AI_MAX_RECURSION_DEPTH),
      'process.env.AI_MODEL': JSON.stringify(env.AI_MODEL),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_MODEL': JSON.stringify(env.GEMINI_MODEL),
      'process.env.GEMINIBASE_URL': JSON.stringify(env.GEMINIBASE_URL),
      'process.env.GEMINI_BASE_URL': JSON.stringify(env.GEMINI_BASE_URL),
      'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
