
// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',

  adapter: vercel(),

  server: {
    host: true,
    port: 4321,
  },

  devToolbar: {
    enabled: false,
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
