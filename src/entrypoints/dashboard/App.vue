<template>
  <div class="dashboard">
    <aside class="sidebar">
      <div class="brand">
        <div class="logo-icon">P</div>
        <div class="logo-text">Peruse</div>
        <span class="beta">TEST</span>
      </div>
      <nav class="nav">
        <button
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: activeTab === item.key }"
          @click="activeTab = item.key"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </button>
      </nav>
      <div class="sidebar-footer">测试版 · 本地行为采集</div>
    </aside>

    <main class="main">
      <div class="topbar">
        <div>
          <h1>{{ current.title }}</h1>
          <p class="subtitle">{{ current.sub }}</p>
        </div>
        <div class="topbar-actions">
          <button v-if="!settingsStore.loaded || !settingsStore.settings.onboarded" class="btn secondary small" @click="openOnboarding">
            完成初始设置
          </button>
          <button class="btn primary small" :disabled="generating" @click="generateNow">
            {{ generating ? '生成中…' : '立即生成推荐' }}
          </button>
        </div>
      </div>

      <div class="view">
        <DigestView v-if="activeTab === 'digest'" ref="digestRef" />
        <StatsView v-else-if="activeTab === 'stats'" />
        <HistoryView v-else-if="activeTab === 'history'" />
        <DataLabView v-else-if="activeTab === 'data'" />
        <SettingsView v-else-if="activeTab === 'settings'" />
      </div>
    </main>

    <div v-if="toast" class="toast" :class="{ error: toastError }">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import DigestView from '../../components/DigestView.vue';
import HistoryView from '../../components/HistoryView.vue';
import DataLabView from '../../components/DataLabView.vue';
import SettingsView from '../../components/SettingsView.vue';
import StatsView from '../../components/StatsView.vue';
import { useSettingsStore } from '../../stores/settings';
import { getDigestStatus, watchDigestStatus } from '../../utils/status';

const settingsStore = useSettingsStore();
const activeTab = ref<'digest' | 'stats' | 'history' | 'data' | 'settings'>('digest');
const digestRef = ref<InstanceType<typeof DigestView> | null>(null);
const generating = ref(false);
const toast = ref('');
const toastError = ref(false);

let toastTimer: number | undefined;
let stopStatus: (() => void) | undefined;
let fallbackTimer: number | undefined;

const navItems = [
  { key: 'digest' as const, label: '今晚推荐', icon: '✦' },
  { key: 'stats' as const, label: '阅读统计', icon: '▤' },
  { key: 'history' as const, label: '阅读历史', icon: '◷' },
  { key: 'data' as const, label: '数据校准', icon: '◈' },
  { key: 'settings' as const, label: '设置', icon: '⚙' },
];

const titles = {
  digest: { title: '今晚推荐', sub: '基于你的阅读历史，为你精选个性化文章' },
  stats: { title: '阅读统计', sub: '了解你的阅读习惯和兴趣分布' },
  history: { title: '阅读历史', sub: '查看你记录下的每一次认真阅读' },
  data: { title: '数据校准', sub: '测试版行为采集：用真实数据校准阅读判定' },
  settings: { title: '设置', sub: '模型、推送、文章来源与隐私' },
};

const current = computed(() => titles[activeTab.value]);

// 切 Tab 时把当前页写入地址栏 hash，刷新后可恢复；replaceState 不产生历史记录
watch(activeTab, (tab) => {
  window.history.replaceState(null, '', `#${tab}`);
});

function syncTabFromHash() {
  const hash = window.location.hash.replace('#', '');
  if (hash === 'digest' || hash === 'stats' || hash === 'history' || hash === 'data' || hash === 'settings') {
    activeTab.value = hash;
  }
}

function showToast(message: string, error = false) {
  toast.value = message;
  toastError.value = error;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = '';
  }, 2600);
}

async function generateNow() {
  if (generating.value) return;
  generating.value = true;
  showToast('已开始生成今晚的推荐');
  try {
    const result = (await chrome.runtime.sendMessage({ type: 'generate-digest' })) as {
      ok?: boolean;
      started?: boolean;
      message?: string;
    };
    if (!result?.ok) {
      generating.value = false;
      showToast(result?.message || '启动失败', true);
      return;
    }
    if (result.started === false) showToast(result.message || '推荐正在生成中');
    startFallbackPolling();
  } catch (error) {
    generating.value = false;
    showToast(error instanceof Error ? error.message : '无法启动生成', true);
  }
}

function startFallbackPolling() {
  if (fallbackTimer) window.clearInterval(fallbackTimer);
  fallbackTimer = window.setInterval(async () => {
    const status = await getDigestStatus();
    if (status.state === 'running') return;
    generating.value = false;
    if (fallbackTimer) window.clearInterval(fallbackTimer);
    fallbackTimer = undefined;
    if (status.state === 'error') showToast(status.message, true);
    else if (status.state === 'done') {
      showToast(status.message);
      activeTab.value = 'digest';
      setTimeout(() => digestRef.value?.reload?.(), 100);
    }
  }, 2000);
}

function openOnboarding() {
  void chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
}

onMounted(async () => {
  syncTabFromHash();
  window.addEventListener('hashchange', syncTabFromHash);

  await settingsStore.load();
  const status = await getDigestStatus();
  generating.value = status.state === 'running';
  if (generating.value) startFallbackPolling();

  stopStatus = watchDigestStatus((next) => {
    generating.value = next.state === 'running';
    if (next.state === 'done') {
      showToast(next.message);
      digestRef.value?.reload?.();
    }
    if (next.state === 'error') showToast(next.message, true);
  });
});

onUnmounted(() => {
  window.removeEventListener('hashchange', syncTabFromHash);
  stopStatus?.();
  if (toastTimer) window.clearTimeout(toastTimer);
  if (fallbackTimer) window.clearInterval(fallbackTimer);
});
</script>

<style scoped>
.dashboard {
  display: flex;
  min-height: 100vh;
  background: var(--peruse-bg);
  color: var(--peruse-text);
}
.sidebar {
  width: 220px;
  flex: 0 0 auto;
  background: #fff;
  border-right: 1px solid var(--peruse-border);
  padding: 20px 0;
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px 20px;
  border-bottom: 1px solid var(--peruse-border);
  margin-bottom: 20px;
}
.logo-icon {
  width: 36px;
  height: 36px;
  background: var(--peruse-primary);
  border-radius: 9px;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
}
.logo-text {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}
.beta {
  margin-left: auto;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--peruse-yellow);
  color: #6b4a00;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
}
.nav {
  display: flex;
  flex-direction: column;
  flex: 1;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 20px;
  border: 0;
  border-right: 3px solid transparent;
  background: transparent;
  color: var(--peruse-muted);
  font-size: 14px;
  cursor: pointer;
  text-align: left;
}
.nav-item:hover {
  background: #faf9ff;
  color: var(--peruse-text);
}
.nav-item.active {
  background: var(--peruse-primary-weak);
  border-right-color: var(--peruse-primary);
  color: var(--peruse-primary);
  font-weight: 600;
}
.nav-icon {
  width: 18px;
  text-align: center;
  font-size: 14px;
}
.sidebar-footer {
  padding: 16px 20px 0;
  border-top: 1px solid var(--peruse-border);
  font-size: 11px;
  color: var(--peruse-faint);
}
.main {
  flex: 1;
  min-width: 0;
  padding: 26px 32px 60px;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  max-width: 1080px;
  margin: 0 auto 22px;
}
h1 {
  font-size: 23px;
  margin: 0 0 4px;
}
.subtitle {
  font-size: 13px;
  color: var(--peruse-muted);
  margin: 0;
}
.topbar-actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}
.view {
  max-width: 1080px;
  margin: 0 auto;
}
@media (max-width: 900px) {
  .sidebar {
    width: 76px;
    padding: 16px 8px;
  }
  .brand {
    justify-content: center;
  }
  .logo-text,
  .logo-sub,
  .nav-item span:last-child,
  .sidebar-footer span {
    display: none;
  }
  .nav-item {
    justify-content: center;
  }
  .main {
    padding: 20px 16px 40px;
  }
  .topbar {
    flex-direction: column;
  }
}
</style>
