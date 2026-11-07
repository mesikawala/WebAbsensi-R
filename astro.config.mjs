// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  server: {
    host: true,
    port: 4321,
  },

  devToolbar: {
    enabled: false,
  },

  vite: {
    plugins: [tailwindcss()]
  },

  adapter: vercel()
});