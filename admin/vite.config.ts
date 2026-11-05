import { fileURLToPath, URL } from 'node:url'

import { config } from '@novel-plus/shared'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // 两端端口都来自 packages/shared（唯一出处）。dev 下允许用 VITE_SITE_BASE_API 临时指向别的后端。
  const backendOrigin = env.VITE_SITE_BASE_API || `http://localhost:${config.ports.server}`

  return {
    plugins: [vue(), vueJsx(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: config.ports.admin,
      host: true,
      proxy: {
        '/api': {
          target: backendOrigin,
          changeOrigin: true,
        },
      },
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'echarts',
                test: /\/echarts/,
              },
              {
                name: 'chroma-js',
                test: /\/chroma-js/,
              },
              {
                name: 'es-toolkit',
                test: /\/es-toolkit/,
              },
              {
                name: 'naive-ui',
                test: /\/naive-ui/,
              },
              {
                name: 'dnd-kit',
                test: /\/@dnd-kit\/vue/,
              },
              {
                name: 'vueuse',
                test: /\/vueuse/,
              },
              {
                name: 'vue-router',
                test: /\/vue-router/,
              },
              {
                name: 'pinia',
                test: /\/pinia/,
              },
              {
                name: 'axios',
                test: /\/axios/,
              },
              {
                name: 'vue',
                test: /\/vue/,
              },
            ],
          },

          assetFileNames: (asset) => {
            const notHash = ['topography.svg', 'texture.png', 'noise.png']
            if (asset.names?.some((name) => notHash.includes(name))) {
              return 'assets/[name][extname]'
            }
            return 'assets/[name]-[hash][extname]'
          },

          minify: {
            compress: {
              dropConsole: true,
              dropDebugger: true,
            },
          },
        },
      },
    },
  }
})
