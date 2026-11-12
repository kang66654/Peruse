// utils/status.ts — 推荐生成状态（跨 popup / dashboard / background）
export type DigestState = 'idle' | 'running' | 'done' | 'error';

export interface DigestStatus {
  state: DigestState;
  message: string;
  at: number;
  digestId?: number;
  pickCount?: number;
  fallback?: boolean;
}

const STATUS_KEY = 'peruse:digest-status';

export async function getDigestStatus(): Promise<DigestStatus> {
  try {
    const stored = await chrome.storage.local.get(STATUS_KEY);
    const status = stored[STATUS_KEY] as DigestStatus | undefined;
    if (status) return status;
  } catch {
    // ignore
  }
  return { state: 'idle', message: '', at: 0 };
}

export async function setDigestStatus(status: Omit<DigestStatus, 'at'> & { at?: number }): Promise<void> {
  const payload: DigestStatus = { ...status, at: status.at || Date.now() };
  await chrome.storage.local.set({ [STATUS_KEY]: payload });
}

export function watchDigestStatus(callback: (status: DigestStatus) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[STATUS_KEY]) return;
    const next = changes[STATUS_KEY].newValue as DigestStatus | undefined;
    if (next) callback(next);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
