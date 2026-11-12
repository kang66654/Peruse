import { beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

type StorageChange = { oldValue?: unknown; newValue?: unknown };
type StorageListener = (changes: Record<string, StorageChange>, area: string) => void;

function createChromeMock() {
  const data = new Map<string, unknown>();
  const listeners = new Set<StorageListener>();

  const local = {
    async get(keys?: string | string[] | Record<string, unknown> | null) {
      if (keys == null) return Object.fromEntries(data.entries());
      if (typeof keys === 'string') return { [keys]: data.get(keys) };
      if (Array.isArray(keys)) {
        const out: Record<string, unknown> = {};
        for (const key of keys) out[key] = data.get(key);
        return out;
      }
      const out: Record<string, unknown> = {};
      for (const [key, fallback] of Object.entries(keys)) {
        out[key] = data.has(key) ? data.get(key) : fallback;
      }
      return out;
    },
    async set(items: Record<string, unknown>) {
      const changes: Record<string, StorageChange> = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: data.get(key), newValue: value };
        data.set(key, value);
      }
      for (const listener of listeners) listener(changes, 'local');
    },
    async remove(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      const changes: Record<string, StorageChange> = {};
      for (const key of list) {
        changes[key] = { oldValue: data.get(key) };
        data.delete(key);
      }
      for (const listener of listeners) listener(changes, 'local');
    },
    async clear() {
      data.clear();
    },
  };

  return {
    storage: {
      local,
      onChanged: {
        addListener: (listener: StorageListener) => listeners.add(listener),
        removeListener: (listener: StorageListener) => listeners.delete(listener),
      },
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
    notifications: { create: vi.fn(async () => 'notification-id') },
    alarms: { create: vi.fn(), clear: vi.fn(async () => true) },
    tabs: {
      create: vi.fn(async () => ({ id: 1 })),
      getCurrent: vi.fn(async () => ({ id: 1 })),
      remove: vi.fn(async () => undefined),
    },
  };
}

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  (globalThis as unknown as { chrome: unknown }).chrome = createChromeMock();
  vi.restoreAllMocks();
});
