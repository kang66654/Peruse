<template>
  <div class="digest-page">
    <!-- 生成中 -->
    <section v-if="status.state === 'running'" class="generating">
      <div class="spinner-lg" />
      <h2 class="generating-title">正在生成今晚推荐</h2>
      <p class="generating-sub">正在分析你的阅读偏好，为你精选值得阅读的文章</p>
      <div class="steps">
        <div class="step done"><div class="step-icon">✓</div><span>已读取最近的阅读记录</span></div>
        <div class="step done"><div class="step-icon">✓</div><span>已准备兴趣主题与候选来源</span></div>
        <div class="step current">
          <div class="step-icon">●</div>
          <span>{{ status.message || '正在匹配优质文章…' }}</span>
        </div>
        <div class="step pending"><div class="step-icon">○</div><span>生成推荐理由</span></div>
        <div class="step pending"><div class="step-icon">○</div><span>完成推荐</span></div>
      </div>
    </section>

    <!-- 首次载入 -->
    <div v-else-if="loading" class="loading-state">
      <div class="spinner" />
      <span>正在载入推荐…</span>
    </div>

    <div v-else>
      <!-- 顶部信息与分类计数 -->
      <div v-if="digest" class="digest-head">
        <div class="head-left">
          <div class="digest-date">{{ dateLabel }}</div>
          <div class="digest-meta">
            <span class="badge" :class="{ warn: digest.fallback }">
              {{ digest.fallback ? '规则推荐' : digest.provider }}
            </span>
            <span class="faint small">{{ digest.model }}</span>
            <span class="faint small">候选池 {{ digest.sourceCount }} 篇</span>
          </div>
        </div>
        <div class="head-right">
          <span class="count"><b>{{ unreadCount }}</b>待读</span>
          <span class="count"><b>{{ readCount }}</b>已读</span>
          <button class="btn-regen" :disabled="generating" @click="generate">
            {{ generating ? '生成中…' : '↻ 重新生成' }}
          </button>
        </div>
      </div>

      <!-- 规则降级提示 -->
      <div v-if="digest && digest.fallback" class="fallback">
        <div class="fallback-icon">⚠️</div>
        <div class="fallback-text">
          <b>LLM 连接失败，已降级为基于规则的推荐</b>
          以下推荐基于你的阅读历史和兴趣主题自动筛选，未经过 LLM 个性化优化。你可以检查模型连接后重新生成。
        </div>
      </div>

      <!-- 生成失败 -->
      <div v-if="status.state === 'error'" class="error-banner">
        <div class="error-title">生成失败</div>
        <div class="error-msg">{{ status.message }}</div>
        <button class="btn-regen" @click="generate">重试</button>
      </div>

      <!-- 推荐列表 -->
      <div v-if="digest && digest.picks.length" class="picks">
        <article
          v-for="(pick, index) in digest.picks"
          :key="pick.url"
          class="pick"
          :class="{
            'is-read': pick.status === 'read',
            'is-dismissed': pick.status === 'dismissed',
          }"
        >
          <div class="pick-num">{{ String(index + 1).padStart(2, '0') }}</div>
          <div class="pick-content">
            <div class="pick-source">{{ sourceLabel(pick) }}</div>
            <h3 class="pick-title" @click="openPick(pick)">{{ pick.title }}</h3>
            <p class="pick-reason">{{ pick.reason }}</p>
            <div class="pick-actions">
              <button class="btn-read" @click="openPick(pick)">开始阅读</button>
              <button
                class="btn-done"
                :disabled="pick.status === 'read'"
                @click="markRead(pick)"
              >
                ✓ 已读
              </button>
              <button
                class="btn-no"
                :disabled="pick.status === 'dismissed'"
                @click="toggleMenu(pick.url)"
              >
                {{ pick.status === 'dismissed' ? '✕ 已忽略' : '✕ 不感兴趣' }}
              </button>
            </div>
          </div>
          <div class="pick-meta">
            <div class="pick-mins">{{ pick.estimatedMinutes }}</div>
            <div class="pick-mins-label">分钟</div>
            <span v-if="pick.status === 'read'" class="state-chip">已读</span>
            <span v-else-if="pick.status === 'dismissed'" class="state-chip">已忽略</span>
          </div>

          <div v-if="menuUrl === pick.url" class="menu">
            <div class="menu-title">为什么不感兴趣？</div>
            <button
              v-for="reason in reasons"
              :key="reason.value"
              class="menu-item"
              :class="{ danger: reason.danger }"
              @click="dismiss(pick, reason.value)"
            >
              <span class="menu-icon">{{ reason.icon }}</span>
              <span>{{ reason.label }}</span>
            </button>
          </div>
        </article>
      </div>

      <!-- 空状态 -->
      <section v-else-if="status.state !== 'error'" class="empty-state">
        <div class="empty-icon">📖</div>
        <h2>今晚的推荐还未生成</h2>
        <p>
          结合你最近的阅读记录，生成一份个性化的阅读推荐，<br />
          帮助你发现值得阅读的内容。
        </p>
        <div class="empty-btns">
          <button class="btn-empty" :disabled="generating" @click="generate">
            {{ generating ? '正在生成…' : '立即生成推荐' }}
          </button>
          <button class="btn-empty secondary" @click="openOnboarding">配置兴趣</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  getLatestDigest,
  updateDigest,
  type Digest,
  type DigestPick,
  type NegativeReason,
} from '../utils/db';
import { dismissPick } from '../utils/digest';
import { getDigestStatus, watchDigestStatus, type DigestStatus } from '../utils/status';

const digest = ref<Digest | undefined>(undefined);
const status = ref<DigestStatus>({ state: 'idle', message: '', at: 0 });
const loading = ref(true);
const generating = ref(false);
const menuUrl = ref<string | null>(null);

const reasons: Array<{
  value: NegativeReason;
  label: string;
  icon: string;
  danger?: boolean;
}> = [
  { value: 'not_interested', label: '主题不感兴趣', icon: '📌' },
  { value: 'already_read', label: '内容已看过', icon: '📄' },
  { value: 'too_technical', label: '太技术了', icon: '💻' },
  { value: 'blocked_site', label: '永久屏蔽该站点', icon: '🗑', danger: true },
];

const unreadCount = computed(
  () => digest.value?.picks.filter((pick) => pick.status === 'unread').length || 0
);
const readCount = computed(
  () => digest.value?.picks.filter((pick) => pick.status === 'read').length || 0
);

const dateLabel = computed(() => {
  const raw = digest.value?.date;
  if (!raw) return '';
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 星期${
    weekdays[date.getDay()]
  }`;
});

function sourceLabel(pick: DigestPick): string {
  try {
    const host = new URL(pick.url).hostname.replace(/^www\./, '');
    return host && host !== pick.source ? `${pick.source} · ${host}` : pick.source;
  } catch {
    return pick.source;
  }
}

let stopWatch: (() => void) | undefined;

async function reload() {
  loading.value = true;
  const [storedDigest, storedStatus] = await Promise.all([getLatestDigest(), getDigestStatus()]);
  digest.value = storedDigest;
  status.value = storedStatus;
  generating.value = storedStatus.state === 'running';
  loading.value = false;
}

async function generate() {
  if (generating.value) return;
  generating.value = true;
  await chrome.runtime.sendMessage({ type: 'generate-digest' });
}

function openOnboarding() {
  void chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
}

function openPick(pick: DigestPick) {
  void chrome.tabs.create({ url: pick.url });
  void markRead(pick);
}

async function markRead(pick: DigestPick) {
  if (!digest.value || pick.status === 'read') return;
  pick.status = 'read';
  await updateDigest(digest.value);
}

async function dismiss(pick: DigestPick, reason: NegativeReason) {
  if (!digest.value) return;
  digest.value = await dismissPick(digest.value, pick, reason);
  menuUrl.value = null;
}

function toggleMenu(url: string) {
  menuUrl.value = menuUrl.value === url ? null : url;
}

onMounted(async () => {
  await reload();
  stopWatch = watchDigestStatus(async (next) => {
    status.value = next;
    generating.value = next.state === 'running';
    if (next.state === 'done') await reload();
  });
});

onUnmounted(() => stopWatch?.());

defineExpose({ reload });
</script>

<style scoped>
.digest-page {
  display: flex;
  flex-direction: column;
}

/* —— 顶部信息 —— */
.digest-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.digest-date {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.35;
}
.digest-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.head-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.count {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 5px 12px;
  background: #fff;
  border: 1px solid var(--peruse-border);
  border-radius: 999px;
  font-size: 11px;
  color: var(--peruse-muted);
}
.count b {
  font-size: 15px;
  color: var(--peruse-primary);
}
.btn-regen {
  background: var(--peruse-primary);
  color: #fff;
  border: 0;
  padding: 9px 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}
.btn-regen:hover:not(:disabled) {
  background: #5844c4;
}
.btn-regen:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* —— 规则降级提示 —— */
.fallback {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: #fff8e0;
  border: 1px solid var(--peruse-yellow);
  border-radius: var(--peruse-radius);
  padding: 16px 20px;
  margin-bottom: 16px;
}
.fallback-icon {
  font-size: 20px;
  line-height: 1.2;
  flex: 0 0 auto;
}
.fallback-text {
  flex: 1;
  font-size: 13px;
  color: #8a6d2b;
  line-height: 1.6;
}
.fallback-text b {
  display: block;
  margin-bottom: 4px;
  color: #6b4f1a;
  font-weight: 600;
}

/* —— 错误提示 —— */
.error-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  background: #fdeceb;
  border: 1px solid #f7cfcc;
  border-radius: var(--peruse-radius);
  padding: 16px 20px;
  margin-bottom: 16px;
}
.error-title {
  font-weight: 600;
  color: var(--peruse-danger);
}
.error-msg {
  flex: 1;
  min-width: 180px;
  font-size: 13px;
  color: #a03a30;
}

/* —— 推荐卡片 —— */
.picks {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pick {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  background: var(--peruse-card);
  border: 1px solid var(--peruse-border);
  border-radius: var(--peruse-radius);
  padding: 16px;
  transition: opacity 0.2s ease, border-color 0.2s ease;
}
.pick.is-read,
.pick.is-dismissed {
  opacity: 0.62;
}
.pick-num {
  font-size: 24px;
  font-weight: 700;
  color: var(--peruse-secondary);
  min-width: 30px;
  line-height: 1.3;
}
.pick-content {
  flex: 1;
  min-width: 0;
}
.pick-source {
  font-size: 11px;
  color: var(--peruse-muted);
  margin-bottom: 4px;
}
.pick-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  margin: 0 0 6px;
  cursor: pointer;
  word-break: break-word;
}
.pick-title:hover {
  color: var(--peruse-primary);
}
.pick-reason {
  font-size: 12px;
  color: var(--peruse-muted);
  background: var(--peruse-bg);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 0 0 10px;
  line-height: 1.6;
}
.pick-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.btn-read,
.btn-done,
.btn-no {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  line-height: 1.5;
  transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}
.btn-read {
  background: var(--peruse-primary);
  color: #fff;
  border: 0;
}
.btn-read:hover {
  background: #5844c4;
}
.btn-done {
  background: #fff;
  border: 1px solid var(--peruse-border);
  color: var(--peruse-text);
}
.btn-done:hover:not(:disabled) {
  border-color: var(--peruse-secondary);
}
.btn-no {
  background: #fff;
  border: 1px solid var(--peruse-border);
  color: #b5483a;
}
.btn-no:hover:not(:disabled) {
  border-color: #e6b6b0;
  background: #fdf4f3;
}
.btn-done:disabled,
.btn-no:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.pick-meta {
  min-width: 80px;
  text-align: right;
  flex: 0 0 auto;
}
.pick-mins {
  font-size: 18px;
  font-weight: 700;
  color: var(--peruse-primary);
  line-height: 1.2;
}
.pick-mins-label {
  font-size: 11px;
  color: var(--peruse-muted);
}
.state-chip {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f1f0f6;
  color: var(--peruse-muted);
  font-size: 11px;
  font-weight: 600;
}

/* —— 不感兴趣菜单 —— */
.menu {
  position: absolute;
  right: 20px;
  top: 60px;
  z-index: 10;
  width: 220px;
  background: #fff;
  border: 1px solid var(--peruse-border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}
.menu-title {
  padding: 12px 16px;
  font-size: 12px;
  color: var(--peruse-muted);
  border-bottom: 1px solid #f0edf5;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 16px;
  border: 0;
  background: #fff;
  color: var(--peruse-text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.menu-item:hover {
  background: var(--peruse-bg);
}
.menu-item.danger {
  color: #b5483a;
}
.menu-icon {
  font-size: 13px;
  line-height: 1;
}

/* —— 生成中 —— */
.generating {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 64px 20px;
  min-height: 60vh;
}
.spinner-lg {
  width: 64px;
  height: 64px;
  border: 4px solid var(--peruse-border);
  border-top-color: var(--peruse-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 24px;
}
.generating-title {
  font-size: 24px;
  margin: 0 0 8px;
}
.generating-sub {
  font-size: 13px;
  color: var(--peruse-muted);
  margin: 0 0 40px;
  text-align: center;
}
.steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(400px, 100%);
  text-align: left;
}
.step {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--peruse-muted);
}
.step.done {
  color: #2d7a4a;
}
.step.current {
  color: var(--peruse-primary);
  font-weight: 500;
}
.step-icon {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  border-radius: 50%;
  font-size: 12px;
}
.step.done .step-icon {
  background: #e8f8ee;
  color: #2d7a4a;
}
.step.current .step-icon {
  background: var(--peruse-primary-weak);
  color: var(--peruse-primary);
  animation: pulse 1.5s infinite;
}
.step.pending .step-icon {
  background: #f0edf5;
  color: var(--peruse-faint);
}

/* —— 首次载入 —— */
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
  font-size: 13px;
  color: var(--peruse-muted);
}
.spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--peruse-border);
  border-top-color: var(--peruse-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* —— 空状态 —— */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 72px 20px;
}
.empty-icon {
  font-size: 64px;
  line-height: 1;
  margin-bottom: 24px;
  opacity: 0.6;
}
.empty-state h2 {
  font-size: 24px;
  margin: 0 0 8px;
}
.empty-state p {
  font-size: 13px;
  color: var(--peruse-muted);
  line-height: 1.8;
  margin: 0 0 40px;
}
.btn-empty {
  padding: 12px 28px;
  border: 0;
  border-radius: 8px;
  background: var(--peruse-primary);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}
.empty-btns {
  display: flex;
  gap: 12px;
  justify-content: center;
}
.btn-empty.secondary {
  background: #fff;
  border: 1px solid var(--peruse-border);
  color: var(--peruse-text);
  font-weight: 400;
}
.btn-empty:hover:not(:disabled) {
  background: #5844c4;
}
.btn-empty:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn-empty.secondary:hover:not(:disabled) {
  background: var(--peruse-primary-weak);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

@media (max-width: 640px) {
  .digest-head {
    flex-direction: column;
    align-items: stretch;
  }
  .head-right {
    justify-content: flex-start;
  }
  .pick {
    flex-direction: column;
    gap: 10px;
  }
  .pick-num {
    min-width: 0;
  }
  .pick-meta {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    text-align: left;
  }
  .state-chip {
    margin-top: 0;
  }
  .menu {
    position: static;
    width: 100%;
    margin-top: 10px;
    box-shadow: none;
  }
  .generating {
    padding: 40px 16px;
  }
  .empty-state {
    padding: 48px 16px;
  }
}
</style>
