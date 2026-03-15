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
      'process.env.AI_INDEX_CONCURRENCY': JSON.stringify(env.AI_INDEX_CONCURRENCY),
      'process.env.AI_MAX_ANALYSIS_NODES': JSON.stringify(env.AI_MAX_ANALYSIS_NODES),
      'process.env.AI_MAX_DRILLDOWN_PER_LEVEL': JSON.stringify(env.AI_MAX_DRILLDOWN_PER_LEVEL),
      'process.env.AI_MAX_ENTRY_FILE_CANDIDATES': JSON.stringify(env.AI_MAX_ENTRY_FILE_CANDIDATES),
      'process.env.AI_MAX_HEURISTIC_SEARCH_FILES': JSON.stringify(env.AI_MAX_HEURISTIC_SEARCH_FILES),
      'process.env.AI_MAX_INDEX_FILES': JSON.stringify(env.AI_MAX_INDEX_FILES),
      'process.env.AI_MAX_OUTPUT_TOKENS': JSON.stringify(env.AI_MAX_OUTPUT_TOKENS),
      'process.env.AI_MAX_PROJECT_SEARCH_FILES': JSON.stringify(env.AI_MAX_PROJECT_SEARCH_FILES),
      'process.env.AI_MAX_RECURSION_DEPTH': JSON.stringify(env.AI_MAX_RECURSION_DEPTH),
      'process.env.AI_MODEL': JSON.stringify(env.AI_MODEL),
      'process.env.AI_MODEL_ENTRY': JSON.stringify(env.AI_MODEL_ENTRY),
      'process.env.AI_MODEL_FAST': JSON.stringify(env.AI_MODEL_FAST),
      'process.env.AI_MODEL_FILE_GUESS': JSON.stringify(env.AI_MODEL_FILE_GUESS),
      'process.env.AI_MODEL_FUNCTION': JSON.stringify(env.AI_MODEL_FUNCTION),
      'process.env.AI_MODEL_PROJECT': JSON.stringify(env.AI_MODEL_PROJECT),
      'process.env.AI_REQUEST_TIMEOUT_MS': JSON.stringify(env.AI_REQUEST_TIMEOUT_MS),
      'process.env.AI_ENABLE_THINKING': JSON.stringify(env.AI_ENABLE_THINKING),
      'process.env.AI_USE_STREAM': JSON.stringify(env.AI_USE_STREAM),
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
