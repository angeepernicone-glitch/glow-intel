// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://glow-intel.angeepernicone.workers.dev', // Update when domain is bought
  vite: {
    plugins: [tailwindcss()]
  },
  integrations: [sitemap()],
});
