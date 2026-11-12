// stores/settings.ts — Pinia 设置 store
import { defineStore } from 'pinia';
import {
  defaultSettings,
  getActiveProfile,
  getProviderPreset,
  getSettings,
  isLocalProvider,
  saveSettings,
  type ProviderId,
  type ProviderProfile,
  type Settings,
} from '../utils/settings';

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: defaultSettings() as Settings,
    loaded: false,
  }),
  getters: {
    preset: (state) => getProviderPreset(state.settings.provider),
    profile: (state): ProviderProfile => getActiveProfile(state.settings),
    isLocal(): boolean {
      return isLocalProvider(this.settings.provider);
    },
  },
  actions: {
    async load() {
      this.settings = await getSettings();
      this.loaded = true;
      return this.settings;
    },
    async update(patch: Partial<Settings>) {
      this.settings = await saveSettings(patch);
      return this.settings;
    },
    async chooseProvider(id: ProviderId) {
      this.settings = await saveSettings({ provider: id });
      return this.settings;
    },
    async updateProfile(patch: Partial<ProviderProfile>) {
      const profiles = {
        ...this.settings.profiles,
        [this.settings.provider]: { ...this.profile, ...patch },
      };
      this.settings = await saveSettings({ profiles });
      return this.settings;
    },
  },
});
