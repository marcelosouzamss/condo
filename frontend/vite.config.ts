import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/** Alvo do proxy em desenvolvimento: mesmo backend padrão usado pelo app móvel. */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget =
    env.VITE_DEV_PROXY_TARGET?.trim() ||
    env.VITE_PROXY_API?.trim() ||
    'http://18.191.229.62:5050';

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/uploads': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
