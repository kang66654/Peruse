// utils/settings.ts — 设置与 LLM Provider 预置
export type ProviderProtocol = 'openai' | 'anthropic' | 'gemini';

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'zhipu'
  | 'kimi'
  | 'qwen'
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'
  | 'vllm'
  | 'custom';

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  local?: boolean;
  note?: string;
}

export interface ProviderProfile {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface Settings {
  provider: ProviderId;
  profiles: Record<string, ProviderProfile>;
  pushTime: string; // HH:mm
  notify: boolean;
  digestCount: number;
  interests: string[];
  blacklist: string[];
  onboarded: boolean;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'o4-mini'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-haiku-4',
    models: ['claude-haiku-4', 'claude-sonnet-4', 'claude-opus-4'],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    note: '国内直连，便宜',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4.5'],
    note: '有免费额度',
  },
  {
    id: 'kimi',
    label: 'Moonshot Kimi',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2'],
  },
  {
    id: 'qwen',
    label: '通义千问',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-turbo',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    models: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4', 'deepseek/deepseek-chat'],
    note: '一个 Key 调 100+ 模型',
  },
  {
    id: 'ollama',
    label: 'Ollama（本地）',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    models: ['qwen2.5:7b', 'llama3.2', 'deepseek-r1:7b'],
    local: true,
    note: '无需 Key，数据不出本机',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio（本地）',
    protocol: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    models: ['local-model'],
    local: true,
    note: '无需 Key，数据不出本机',
  },
  {
    id: 'vllm',
    label: 'vLLM（本地）',
    protocol: 'openai',
    baseUrl: 'http://localhost:8000/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    models: ['Qwen/Qwen2.5-7B-Instruct'],
    local: true,
    note: '自托管 GPU 服务',
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容）',
    protocol: 'openai',
    baseUrl: '',
    defaultModel: '',
    models: [],
    note: '兼容任意 /chat/completions 端点',
  },
];

export const DEFAULT_INTERESTS = ['技术', '开源', 'AI'];

const STORAGE_KEY = 'peruse:settings';

export function getProviderPreset(id: string): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

export function isLocalProvider(id: string): boolean {
  return Boolean(getProviderPreset(id).local);
}

function buildDefaultProfiles(): Record<string, ProviderProfile> {
  const profiles: Record<string, ProviderProfile> = {};
  for (const provider of PROVIDERS) {
    profiles[provider.id] = {
      baseUrl: provider.baseUrl,
      model: provider.defaultModel,
      apiKey: '',
    };
  }
  return profiles;
}

export function defaultSettings(): Settings {
  return {
    provider: 'openai',
    profiles: buildDefaultProfiles(),
    pushTime: '21:00',
    notify: true,
    digestCount: 5,
    interests: [...DEFAULT_INTERESTS],
    blacklist: ['youtube.com', 'x.com', 'twitter.com'],
    onboarded: false,
  };
}

function mergeSettings(raw: Partial<Settings> | undefined): Settings {
  const defaults = defaultSettings();
  if (!raw) return defaults;

  const profiles = buildDefaultProfiles();
  for (const [id, profile] of Object.entries(raw.profiles || {})) {
    profiles[id] = { ...profiles[id], ...profile };
  }

  return {
    ...defaults,
    ...raw,
    profiles,
    interests: Array.isArray(raw.interests) ? raw.interests : defaults.interests,
    blacklist: Array.isArray(raw.blacklist) ? raw.blacklist : defaults.blacklist,
    digestCount: Math.min(
      8,
      Math.max(1, Number.isFinite(Number(raw.digestCount)) ? Number(raw.digestCount) : defaults.digestCount)
    ),
    onboarded: Boolean(raw.onboarded),
  };
}

export async function getSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return mergeSettings(stored[STORAGE_KEY] as Partial<Settings> | undefined);
  } catch {
    return defaultSettings();
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const merged = mergeSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [STORAGE_KEY]: merged });
  return merged;
}

export async function setProvider(id: ProviderId): Promise<Settings> {
  const current = await getSettings();
  return saveSettings({ provider: id });
}

export function getActiveProfile(settings: Settings): ProviderProfile {
  const preset = getProviderPreset(settings.provider);
  return (
    settings.profiles[settings.provider] || {
      baseUrl: preset.baseUrl,
      model: preset.defaultModel,
      apiKey: '',
    }
  );
}

export async function updateActiveProfile(patch: Partial<ProviderProfile>): Promise<Settings> {
  const current = await getSettings();
  const profile = { ...getActiveProfile(current), ...patch };
  return saveSettings({
    profiles: {
      ...current.profiles,
      [current.provider]: profile,
    },
  });
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(mergeSettings(changes[STORAGE_KEY].newValue as Partial<Settings> | undefined));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export function formatTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function parsePushTime(pushTime: string): { hours: number; minutes: number } {
  const [hoursRaw, minutesRaw] = (pushTime || '21:00').split(':');
  const hours = Math.min(23, Math.max(0, Number(hoursRaw) || 0));
  const minutes = Math.min(59, Math.max(0, Number(minutesRaw) || 0));
  return { hours, minutes };
}
