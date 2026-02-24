import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Distroy',
    description: 'GDPR-compliant mass deletion of your Discord messages.',
    default_locale: 'en',
    permissions: ['storage'],
    action: {
      default_title: 'Distroy',
    },
    host_permissions: ['*://discord.com/*', '*://*.discord.com/*'],
  },
});
