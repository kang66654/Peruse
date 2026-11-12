import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

async function loadSettings() {
  vi.resetModules();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  return import('../src/utils/settings');
}

describe('默认设置与 Provider', () => {
  it('默认设置符合产品定义', async () => {
    const s = await loadSettings();
    const defaults = s.defaultSettings();
    expect(defaults.provider).toBe('openai');
    expect(defaults.pushTime).toBe('21:00');
    expect(defaults.notify).toBe(true);
    expect(defaults.digestCount).toBe(5);
    expect(defaults.interests).toEqual(['技术', '开源', 'AI']);
    expect(defaults.blacklist).toEqual(['youtube.com', 'x.com', 'twitter.com']);
    expect(defaults.onboarded).toBe(false);
    expect(Object.keys(defaults.profiles).length).toBe(s.PROVIDERS.length);
    expect(s.PROVIDERS.map((p) => p.id)).toContain('deepseek');
    expect(s.PROVIDERS.map((p) => p.id)).toContain('ollama');
  });

  it('空存储时读取默认值，未知 Provider 回退到第一个', async () => {
    const s = await loadSettings();
    expect((await s.getSettings()).provider).toBe('openai');
    expect(s.getProviderPreset('not-exist').id).toBe(s.PROVIDERS[0].id);
    expect(s.isLocalProvider('ollama')).toBe(true);
    expect(s.isLocalProvider('openai')).toBe(false);
  });

  it('保存设置会补全默认 profile，并夹取推荐数量', async () => {
    const s = await loadSettings();
    let saved = await s.saveSettings({ interests: ['分布式系统'] });
    expect(saved.interests).toEqual(['分布式系统']);
    // 其余 Provider profile 仍然完整
    expect(saved.profiles.anthropic.baseUrl).toContain('anthropic.com');

    saved = await s.saveSettings({ digestCount: 0 });
    expect(saved.digestCount).toBe(1);
    saved = await s.saveSettings({ digestCount: 99 });
    expect(saved.digestCount).toBe(8);

    const reloaded = await s.getSettings();
    expect(reloaded.digestCount).toBe(8);
    expect(reloaded.interests).toEqual(['分布式系统']);
  });

  it('切换 Provider 不会丢失各家的 Key 配置', async () => {
    const s = await loadSettings();
    await s.updateActiveProfile({ apiKey: 'sk-openai' });
    await s.setProvider('deepseek');
    await s.updateActiveProfile({ apiKey: 'sk-deepseek', model: 'deepseek-chat' });

    expect(s.getActiveProfile(await s.getSettings()).apiKey).toBe('sk-deepseek');

    await s.setProvider('openai');
    expect(s.getActiveProfile(await s.getSettings()).apiKey).toBe('sk-openai');
  });

  it('watchSettings 在保存时回调，取消订阅后不再回调', async () => {
    const s = await loadSettings();
    const seen: string[] = [];
    const stop = s.watchSettings((settings) => seen.push(settings.pushTime));

    await s.saveSettings({ pushTime: '08:30' });
    expect(seen).toContain('08:30');

    stop();
    await s.saveSettings({ pushTime: '22:00' });
    expect(seen).not.toContain('22:00');
  });

  it('时间解析与格式化健壮', async () => {
    const s = await loadSettings();
    expect(s.parsePushTime('21:00')).toEqual({ hours: 21, minutes: 0 });
    expect(s.parsePushTime('9:05')).toEqual({ hours: 9, minutes: 5 });
    expect(s.parsePushTime('25:99')).toEqual({ hours: 23, minutes: 59 });
    expect(s.parsePushTime('')).toEqual({ hours: 21, minutes: 0 });

    const date = new Date(2026, 10, 2, 8, 5);
    expect(s.formatTime(date)).toBe('08:05');
  });
});
