// entrypoints/background.ts — Service Worker
import {
  mergeArticleRecord,
  getSources,
  saveSource,
  saveReadingSession,
  pruneOldArticles,
  seedDefaultSources,
  type ArticleInput,
} from '../utils/db';
import type { ReadingSignals } from '../utils/reading';
import { generateDigest, isDigestRunning } from '../utils/digest';
import { testConnection } from '../utils/llm';
import { getSettings, parsePushTime } from '../utils/settings';
import { makeAutoSource } from '../utils/sources';
import { getDigestStatus } from '../utils/status';

const DIGEST_ALARM = 'generate-digest';
const PRUNE_ALARM = 'prune-articles';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener((details) => {
    void handleInstalled(details.reason);
  });

  chrome.runtime.onStartup.addListener(() => {
    void scheduleAlarms();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === DIGEST_ALARM) {
      void generateDigest();
    }
    if (alarm.name === PRUNE_ALARM) {
      void pruneOldArticles();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void handleMessage(message as Record<string, unknown>)
      .then(sendResponse)
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  });

  chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith('peruse-')) {
      void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
      void chrome.notifications.clear(notificationId);
    }
  });

  // 兜底：确保 alarm 存在（SW 被回收后重启）
  void scheduleAlarms();
});

async function handleInstalled(reason: string) {
  await seedDefaultSources();
  await scheduleAlarms();

  if (reason === 'install') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
}

async function scheduleAlarms() {
  const settings = await getSettings();
  const { hours, minutes } = parsePushTime(settings.pushTime);

  let next = new Date();
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= Date.now()) next = new Date(next.getTime() + 24 * 60 * 60 * 1000);

  await chrome.alarms.clear(DIGEST_ALARM);
  chrome.alarms.create(DIGEST_ALARM, {
    when: next.getTime(),
    periodInMinutes: 24 * 60,
  });

  const now = new Date();
  const monthly = new Date(now.getFullYear(), now.getMonth() + 1, 1, 3, 0, 0, 0);
  await chrome.alarms.clear(PRUNE_ALARM);
  chrome.alarms.create(PRUNE_ALARM, {
    when: monthly.getTime(),
    periodInMinutes: 30 * 24 * 60,
  });
}

async function handleMessage(message: Record<string, unknown>): Promise<unknown> {
  switch (message.type) {
    case 'save-article': {
      const article = message.article as ArticleInput | undefined;
      if (!article || !article.url) return { ok: false, error: '缺少文章数据' };
      const saved = await mergeArticleRecord(article);
      return { ok: true, article: saved };
    }

    case 'save-session': {
      const session = message.session as ReadingSignals | undefined;
      if (!session || !session.sessionId || !session.url) {
        return { ok: false, error: '缺少会话数据' };
      }
      await saveReadingSession(session);
      return { ok: true, sessionId: session.sessionId };
    }

    case 'generate-digest': {
      if (isDigestRunning()) {
        return { ok: true, started: false, message: '推荐正在生成中' };
      }
      void generateDigest();
      return { ok: true, started: true };
    }

    case 'test-connection': {
      const settings = await getSettings();
      const result = await testConnection(settings);
      return { ok: result.ok, result };
    }

    case 'reschedule-alarm': {
      await scheduleAlarms();
      return { ok: true };
    }

    case 'get-digest-status': {
      return { ok: true, status: await getDigestStatus() };
    }

    case 'discover-rss': {
      const feedUrl = typeof message.feedUrl === 'string' ? message.feedUrl : '';
      const host = typeof message.host === 'string' ? message.host : '';
      if (!feedUrl || !host) return { ok: false };
      const sources = await getSources();
      if (sources.some((source) => source.url === feedUrl)) return { ok: true, added: false };
      const source = makeAutoSource(feedUrl, host);
      await saveSource({ ...source, id: undefined });
      const settings = await getSettings();
      if (settings.notify) {
        try {
          await chrome.notifications.create('peruse-rss', {
            type: 'basic',
            iconUrl: '/icon/128.png',
            title: 'Peruse · 发现新的 RSS',
            message: `已自动订阅 ${host} 的文章源，可在设置里关闭`,
          });
        } catch {
          // ignore
        }
      }
      return { ok: true, added: true };
    }

    case 'prune-articles': {
      const result = await pruneOldArticles();
      return { ok: true, ...result };
    }

    default:
      return { ok: false, error: `未知消息类型：${String(message.type)}` };
  }
}
