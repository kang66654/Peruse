<template>
  <div class="popup">
    <header class="header">
      <div class="logo">
        <div class="logo-icon">P</div>
        <span class="logo-text">Peruse</span>
      </div>
      <button class="icon-btn" title="打开设置" @click="openDashboard('settings')">⚙</button>
    </header>

    <div class="date">{{ todayLabel }}</div>

    <div class="today">
      <div class="today-main">
        <div class="today-label">
          <span>今日阅读</span>
          <span class="today-count" v-if="articleCount > 0">{{ articleCount }} 篇</span>
        </div>
        <div class="today-num">
          {{ minutes }}<span class="today-unit">分钟</span>
        </div>
        <div class="progress" v-if="totalArticles < 5">
          <div class="progress-fill" :style="{ width: progress + '%' }" />
        </div>
        <div class="today-sub" v-if="totalArticles < 5">
          已采集 {{ totalArticles }} / 5 篇，满 5 篇后推荐会更懂你
        </div>
        <div class="today-sub" v-else>数据只保存在本机</div>
      </div>
      <div class="today-icon">📊</div>
    </div>

    <div class="status-card" v-if="status.state === 'running'">
      <div class="spinner" />
      <span>{{ status.message || '正在生成推荐…' }}</span>
    </div>
    <div class="status-card error" v-else-if="status.state === 'error'">
      <span>{{ status.message }}</span>
    </div>

    <div class="digest" v-if="latestDigest" @click="openDashboard('digest')">
      <div class="digest-icon">💡</div>
      <div class="digest-text">
        <div class="digest-title">今晚推荐已就绪</div>
        <div class="digest-sub">
          基于你的兴趣生成了 {{ latestDigest.picks.length }} 篇精选文章
        </div>
      </div>
      <div class="digest-arrow">›</div>
    </div>
    <div class="digest muted" v-else-if="status.state !== 'running'" @click="generate">
      <div class="digest-icon">📖</div>
      <div class="digest-text">
        <div class="digest-title">今晚的推荐还未生成</div>
        <div class="digest-sub">点击这里立即生成一份推荐</div>
      </div>
      <div class="digest-arrow">›</div>
    </div>

    <div class="section-title">
      <span v-if="totalArticles < 5">已采集阅读记录 · {{ totalArticles }} / 5 篇</span>
      <span v-else>最近阅读</span>
    </div>

    <div class="article" v-for="article in recent" :key="article.url">
      <div class="article-favicon">{{ faviconText(article) }}</div>
      <div class="article-info">
        <div class="article-title" @click="openUrl(article.url)">{{ article.title }}</div>
        <div class="article-host">{{ article.host }} · {{ articleMinutes(article) }} 分钟</div>
      </div>
      <button class="btn-article" @click="markFalsePositive(article)">这篇我没读</button>
    </div>
    <div class="empty-line" v-if="recent.length === 0">
      打开一篇长文并认真读一会儿，这里就会出现记录。
    </div>

    <div class="btns">
      <button class="btn secondary" :disabled="generating" @click="generate">
        {{ generating ? '生成中…' : '🔄 立即生成推荐' }}
      </button>
      <button class="btn primary" @click="openDashboard()">📈 打开仪表盘</button>
    </div>

    <div class="capacity" v-if="totalArticles > 5000">
      已积累 {{ totalArticles }} 篇阅读记录，建议在设置页导出备份。
    </div>

    <footer class="footer">
      <span>{{ totalArticles }} 篇阅读记录</span>
      <span>本地存储 · 无遥测</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { Article, Digest } from '../../utils/db';
import { dbPut, getAllArticles, getLatestDigest } from '../../utils/db';
import { getDigestStatus, watchDigestStatus, type DigestStatus } from '../../utils/status';

const todayLabel = new Date().toLocaleDateString('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});

const minutes = ref(0);
const articleCount = ref(0);
const totalArticles = ref(0);
const recent = ref<Article[]>([]);
const latestDigest = ref<Digest | undefined>(undefined);
const status = ref<DigestStatus>({ state: 'idle', message: '', at: 0 });
const generating = ref(false);

const progress = computed(() => Math.min(100, Math.round((totalArticles.value / 5) * 100)));

let stopWatch: (() => void) | undefined;
let pollTimer: number | undefined;

async function load() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startMs = startOfToday.getTime();

  const [articles, digest, storedStatus] = await Promise.all([
    getAllArticles(),
    getLatestDigest(),
    getDigestStatus(),
  ]);

  const todayArticles = articles.filter((article) => article.readAt >= startMs);
  articleCount.value = todayArticles.length;
  totalArticles.value = articles.length;
  minutes.value = Math.round(
    todayArticles.reduce((sum, article) => sum + (article.lastSessionSec || article.visibleTime), 0) /
      60
  );
  recent.value = [...articles]
    .filter((article) => !article.falsePositive)
    .sort((a, b) => b.readAt - a.readAt)
    .slice(0, 3);
  latestDigest.value = digest;
  status.value = storedStatus;
  generating.value = storedStatus.state === 'running';
  if (generating.value) startPolling();
}

function articleMinutes(article: Article) {
  return Math.max(1, Math.round((article.lastSessionSec || article.visibleTime) / 60));
}

function faviconText(article: Article) {
  return (article.host || '?').charAt(0).toUpperCase();
}

async function markFalsePositive(article: Article) {
  await dbPut('articles', { ...article, falsePositive: true, starred: article.starred });
  await load();
}

async function generate() {
  if (generating.value) return;
  generating.value = true;
  status.value = { state: 'running', message: '正在准备候选文章…', at: Date.now() };
  try {
    await chrome.runtime.sendMessage({ type: 'generate-digest' });
    startPolling();
  } catch (error) {
    generating.value = false;
    status.value = {
      state: 'error',
      message: error instanceof Error ? error.message : '无法启动推荐生成',
      at: Date.now(),
    };
  }
}

function startPolling() {
  if (pollTimer) window.clearInterval(pollTimer);
  const startedAt = Date.now();
  pollTimer = window.setInterval(async () => {
    const next = await getDigestStatus();
    status.value = next;
    if (next.state === 'done' || next.state === 'error') {
      generating.value = false;
      if (pollTimer) window.clearInterval(pollTimer);
      pollTimer = undefined;
      await load();
    }
    if (Date.now() - startedAt > 180000) {
      generating.value = false;
      if (pollTimer) window.clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }, 2000);
}

function openDashboard(tab?: 'digest' | 'stats' | 'history' | 'settings') {
  const hash = tab ? `#${tab}` : '';
  void chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html${hash}`) });
}

function openUrl(url: string) {
  void chrome.tabs.create({ url });
}

onMounted(async () => {
  await load();
  stopWatch = watchDigestStatus((next) => {
    status.value = next;
    generating.value = next.state === 'running';
    if (next.state === 'done') void load();
  });
});

onUnmounted(() => {
  stopWatch?.();
  if (pollTimer) window.clearInterval(pollTimer);
});
</script>

<style scoped>
.popup {
  width: 360px;
  padding: 16px;
  background: var(--peruse-bg);
  color: var(--peruse-text);
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.logo {
  display: flex;
  align-items: center;
  gap: 8px;
}
.logo-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  background: var(--peruse-primary);
  border-radius: 8px;
}
.logo-text {
  font-size: 16px;
  font-weight: 700;
}
.icon-btn {
  border: 0;
  background: transparent;
  color: var(--peruse-muted);
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
}
.icon-btn:hover {
  background: #fff;
}
.date {
  font-size: 12px;
  color: var(--peruse-muted);
  margin-bottom: 14px;
}
.today {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--peruse-primary-weak);
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 12px;
}
.today-main {
  flex: 1;
  min-width: 0;
}
.today-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--peruse-muted);
  margin-bottom: 4px;
}
.today-count {
  font-size: 11px;
  color: var(--peruse-primary);
}
.today-num {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--peruse-primary);
}
.today-unit {
  font-size: 14px;
  font-weight: 500;
  color: var(--peruse-muted);
  margin-left: 4px;
}
.today-icon {
  font-size: 24px;
}
.today-sub {
  font-size: 11px;
  color: var(--peruse-muted);
  margin-top: 6px;
}
.progress {
  height: 4px;
  background: #ded8ff;
  border-radius: 3px;
  overflow: hidden;
  margin-top: 8px;
}
.progress-fill {
  height: 100%;
  background: var(--peruse-primary);
  border-radius: 3px;
  transition: width 0.4s ease;
}
.status-card {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  background: #fff;
  border: 1px solid var(--peruse-border);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 12px;
  color: var(--peruse-muted);
}
.status-card.error {
  color: var(--peruse-danger);
  border-color: #f3d3cf;
  background: #fdf5f4;
}
.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--peruse-border);
  border-top-color: var(--peruse-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.digest {
  display: flex;
  align-items: center;
  gap: 2px;
  background: #fff8e0;
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 14px;
  cursor: pointer;
}
.digest.muted {
  background: #fff;
  border: 1px solid var(--peruse-border);
}
.digest-icon {
  font-size: 20px;
}
.digest-text {
  flex: 1;
  margin: 0 10px;
  min-width: 0;
}
.digest-title {
  font-size: 14px;
  font-weight: 600;
}
.digest-sub {
  font-size: 11px;
  color: var(--peruse-muted);
}
.digest-arrow {
  color: var(--peruse-muted);
  font-size: 18px;
}
.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--peruse-muted);
  margin-bottom: 4px;
}
.article {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid #f0edf5;
}
.article:last-of-type {
  border-bottom: 0;
}
.article-favicon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 12px;
  background: #fff;
  border: 1px solid var(--peruse-border);
  color: var(--peruse-primary);
}
.article-info {
  flex: 1;
  min-width: 0;
}
.article-title {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.article-title:hover {
  color: var(--peruse-primary);
}
.article-host {
  font-size: 11px;
  color: var(--peruse-muted);
}
.btn-article {
  font-size: 11px;
  color: var(--peruse-muted);
  background: var(--peruse-bg);
  border: 0;
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  white-space: nowrap;
}
.btn-article:hover {
  color: var(--peruse-text);
  background: #efedf7;
}
.empty-line {
  font-size: 12px;
  color: var(--peruse-faint);
  padding: 10px 0;
}
.btns {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.btn {
  flex: 1;
  padding: 10px;
  border-radius: 8px;
  font-size: 13px;
  border: 0;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.btn.secondary {
  background: #fff;
  border: 1px solid var(--peruse-border);
  color: var(--peruse-text);
}
.btn.primary {
  background: var(--peruse-primary);
  color: #fff;
}
.capacity {
  font-size: 11px;
  color: var(--peruse-warn);
  background: #fff7e6;
  border: 1px solid #f3e3bc;
  border-radius: 8px;
  padding: 7px 10px;
  margin-top: 10px;
}
.footer {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--peruse-faint);
  margin-top: 12px;
}
</style>
