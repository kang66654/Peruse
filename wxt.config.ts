import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Peruse',
    description: 'Record your reading time and get personalized AI-recommended articles every night',
    version: '1.0.0',
    permissions: ['storage', 'alarms', 'notifications', 'activeTab', 'scripting'],
    host_permissions: ['<all_urls>'],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_popup: 'entrypoints/popup/index.html',
      default_title: 'Peruse',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
  },
  modules: ['@wxt-dev/module-vue'],
});
