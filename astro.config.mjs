// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://glowintel.com', // Update this when you buy your domain
  vite: {
    plugins: [tailwindcss()]
  },
  integrations: [sitemap()],
});
