<template>
  <div class="settings">
    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: subTab === tab.key }"
        @click="subTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 模型与连接 -->
    <section v-if="subTab === 'model'" class="section">
      <h2 class="section-title">模型与连接</h2>
      <p class="section-desc">推荐由你自己的模型生成，凭证只保存在这台设备。</p>

      <div class="form-row">
        <div class="form-group">
          <label>Provider</label>
          <select class="select" :value="settings.provider" @change="onProviderChange">
            <option v-for="provider in PROVIDERS" :key="provider.id" :value="provider.id">
              {{ provider.label }}
            </option>
          </select>
          <div class="form-hint">{{ providerHint(settings) }}</div>
        </div>
        <div class="form-group">
          <label>{{ preset.local ? '服务地址' : 'Base URL' }}</label>
          <input v-model="modelForm.baseUrl" class="input" placeholder="https://api.example.com/v1" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>{{ preset.local ? '模型名称' : 'Model' }}</label>
          <input v-model="modelForm.model" class="input" list="model-options" />
          <datalist id="model-options">
            <option v-for="model in preset.models" :key="model" :value="model" />
          </datalist>
          <div v-if="preset.local" class="form-hint">例如：qwen2.5:7b、llama3.1:8b</div>
        </div>
        <div v-if="!preset.local" class="form-group">
          <label>API Key</label>
          <input
            v-model="modelForm.apiKey"
            class="input"
            type="password"
            :placeholder="preset.id === 'custom' ? '如无需认证可留空' : 'sk-…'"
          />
        </div>
      </div>

      <div v-if="preset.local" class="local-note">
        <b>✓ 本地推理 · 数据不出本机</b>
        <span>模型在你的设备上运行，所有数据仅保留在本机，不会发送到云端。</span>
      </div>

      <div v-if="testResult" class="status-banner" :class="testResult.ok ? 'success' : 'error'">
        <span class="status-icon">{{ testResult.ok ? '✓' : '⚠' }}</span>
        <span class="status-text">{{ testResult.message }}</span>
        <span v-if="testResult.ok" class="status-latency">{{ testResult.latency }}ms</span>
      </div>

      <div class="info-note">
        <span class="info-icon">ℹ️</span>
        <span>
          你的 API Key 等凭证仅保存在本机，不会上传到任何服务器。云端请求仅发送必要的阅读上下文，
          用于生成合适的推荐内容。
        </span>
      </div>

      <div class="actions">
        <button class="btn secondary" :disabled="testing" @click="testConnection">
          {{ testing ? '测试中…' : testResult ? '重新测试' : '测试连接' }}
        </button>
        <button class="btn primary" :disabled="saving" @click="saveModel">保存设置</button>
      </div>
    </section>

    <!-- 推荐与通知 -->
    <section v-if="subTab === 'notify'" class="section">
      <h2 class="section-title">每日推荐</h2>
      <p class="section-desc">在设定时间，根据你的兴趣推送精选文章。</p>
      <div class="form-row">
        <div class="form-group">
          <label>每日推送时间</label>
          <input v-model="notifyForm.pushTime" class="input" type="time" />
        </div>
        <div class="form-group">
          <label>每日推荐数量</label>
          <input v-model.number="notifyForm.digestCount" class="input" type="number" min="1" max="8" />
          <div class="form-hint">每晚生成 1–8 篇文章</div>
        </div>
      </div>
    </section>

    <section v-if="subTab === 'notify'" class="section">
      <h2 class="section-title">通知方式</h2>
      <div class="setting-row">
        <div class="setting-main">
          <div class="row-icon tint-purple">🌐</div>
          <div>
            <div class="row-title">Chrome 通知</div>
            <div class="row-desc">生成完成后在桌面右下角显示文章推荐，点击直接打开仪表盘</div>
          </div>
        </div>
        <label class="switch">
          <input v-model="notifyForm.notify" type="checkbox" />
          <span class="slider" />
        </label>
      </div>
    </section>

    <section v-if="subTab === 'notify'" class="section">
      <h2 class="section-title">兴趣主题</h2>
      <p class="section-desc">
        选择你感兴趣的主题，帮助我们推荐更合适的内容。冷启动阶段会用这些标签去 HN / arXiv 搜索候选文章。
      </p>
      <div class="tags">
        <span v-for="interest in settings.interests" :key="interest" class="tag">
          {{ interest }}
          <span class="tag-x" @click="removeInterest(interest)">×</span>
        </span>
        <input
          v-model="newInterest"
          class="tag-input"
          placeholder="+ 添加主题"
          @keydown.enter.prevent="addInterest"
        />
      </div>
    </section>

    <div v-if="subTab === 'notify'" class="actions">
      <button class="btn primary" :disabled="saving" @click="saveNotify">保存设置</button>
    </div>

    <!-- 文章来源 -->
    <section v-if="subTab === 'sources'" class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">来源管理</h2>
          <p class="section-desc">
            管理内置来源、RSS 订阅和追踪主题，每晚从这些来源收集候选文章。共
            {{ sources.length }} 个来源。
          </p>
        </div>
        <div class="head-actions">
          <button class="btn primary" @click="rssModalOpen = true">+ 添加 RSS</button>
          <button class="btn outline" @click="topicModalOpen = true">+ 添加主题</button>
        </div>
      </div>

      <div class="source-group">
        <div class="group-title">内置来源</div>
        <div v-for="source in builtinSources" :key="source.id ?? source.name" class="source-row">
          <div class="source-icon" :class="'tint-' + source.type">{{ sourceIcon(source.type) }}</div>
          <div class="source-info">
            <div class="source-name">{{ source.name }}</div>
            <div class="source-desc">{{ sourceMeta(source) }}</div>
          </div>
          <label class="switch">
            <input :checked="source.enabled" type="checkbox" @change="toggleSource(source)" />
            <span class="slider" />
          </label>
          <button class="delete-btn" title="删除" @click="removeSource(source)">🗑</button>
        </div>
        <div v-if="!builtinSources.length" class="group-empty">暂无内置来源</div>
      </div>

      <div class="source-group">
        <div class="group-title">已发现的 RSS</div>
        <div v-for="source in discoveredSources" :key="source.id ?? source.name" class="source-row">
          <div class="source-icon" :class="'tint-' + source.type">{{ sourceIcon(source.type) }}</div>
          <div class="source-info">
            <div class="source-name">{{ source.name }}</div>
            <div class="source-desc">{{ sourceMeta(source) }}</div>
          </div>
          <label class="switch">
            <input :checked="source.enabled" type="checkbox" @change="toggleSource(source)" />
            <span class="slider" />
          </label>
          <button class="delete-btn" title="删除" @click="removeSource(source)">🗑</button>
        </div>
        <div v-if="!discoveredSources.length" class="group-empty">还没有自动发现 RSS 源</div>
      </div>

      <div class="source-group">
        <div class="group-title">我的 RSS 订阅</div>
        <div v-for="source in rssSources" :key="source.id ?? source.name" class="source-row">
          <div class="source-icon" :class="'tint-' + source.type">{{ sourceIcon(source.type) }}</div>
          <div class="source-info">
            <div class="source-name">{{ source.name }}</div>
            <div class="source-desc">{{ sourceMeta(source) }}</div>
          </div>
          <label class="switch">
            <input :checked="source.enabled" type="checkbox" @change="toggleSource(source)" />
            <span class="slider" />
          </label>
          <button class="delete-btn" title="删除" @click="removeSource(source)">🗑</button>
        </div>
        <div v-if="!rssSources.length" class="group-empty">还没有添加 RSS 源</div>
      </div>

      <div class="source-group">
        <div class="group-title">追踪主题</div>
        <div v-for="source in topicSources" :key="source.id ?? source.name" class="source-row">
          <div class="source-icon" :class="'tint-' + source.type">{{ sourceIcon(source.type) }}</div>
          <div class="source-info">
            <div class="source-name">{{ source.name }}</div>
            <div class="source-desc">{{ sourceMeta(source) }}</div>
          </div>
          <label class="switch">
            <input :checked="source.enabled" type="checkbox" @change="toggleSource(source)" />
            <span class="slider" />
          </label>
          <button class="delete-btn" title="删除" @click="removeSource(source)">🗑</button>
        </div>
        <div v-if="!topicSources.length" class="group-empty">还没有追踪主题</div>
      </div>

    </section>

    <!-- 采集与隐私 -->
    <section v-if="subTab === 'privacy'" class="section">
      <h2 class="section-title">数据采集</h2>
      <p class="section-desc">我们仅在你主动添加的来源中采集内容，用于生成个性化推荐。</p>

      <div class="privacy-row">
        <div class="privacy-icon tint-purple">💾</div>
        <div>
          <div class="privacy-title">本地优先</div>
          <div class="privacy-desc">所有阅读记录只写入本机 IndexedDB，不经过 Peruse 服务器。</div>
        </div>
      </div>
      <div class="privacy-row">
        <div class="privacy-icon tint-yellow">☁️</div>
        <div>
          <div class="privacy-title">直连模型</div>
          <div class="privacy-desc">推荐请求由扩展直接发往你配置的 LLM 端点，API Key 不上传。</div>
        </div>
      </div>
      <div class="privacy-row">
        <div class="privacy-icon tint-green">◷</div>
        <div>
          <div class="privacy-title">只记录认真阅读</div>
          <div class="privacy-desc">阅读评分超过 0.3 才写入；输入框打字、切后台时暂停计时。</div>
        </div>
      </div>
      <div class="privacy-row">
        <div class="privacy-icon tint-red">🚫</div>
        <div>
          <div class="privacy-title">不读取 Chrome 历史记录</div>
          <div class="privacy-desc">不访问浏览器历史、不读取 Cookie，也没有任何遥测。</div>
        </div>
      </div>
    </section>

    <section v-if="subTab === 'privacy'" class="section">
      <h2 class="section-title">排除的网站</h2>
      <p class="section-desc">来自以下网站的内容不会被采集和推荐，保存后对新打开的页面生效。</p>

      <div v-for="site in blacklistEntries" :key="site" class="site-row">
        <span class="site-icon">🌐</span>
        <span class="site-url">{{ site }}</span>
        <button class="delete-btn" title="移除" @click="removeBlacklistSite(site)">🗑</button>
      </div>
      <div v-if="!blacklistEntries.length" class="group-empty">还没有排除任何网站</div>

      <div v-if="addingBlacklist" class="add-site-row">
        <input
          v-model="newBlacklistSite"
          class="input"
          placeholder="例如 youtube.com"
          @keydown.enter.prevent="addBlacklistSite"
        />
        <button class="btn secondary" @click="addBlacklistSite">添加</button>
        <button class="btn ghost" @click="addingBlacklist = false">取消</button>
      </div>
      <button v-else class="add-dashed" @click="addingBlacklist = true">+ 添加网站</button>

      <div class="actions">
        <button class="btn secondary" @click="pruneNow">立即执行存储降级</button>
        <button class="btn primary" :disabled="saving" @click="savePrivacy">保存设置</button>
      </div>
    </section>

    <!-- 数据管理 -->
    <section v-if="subTab === 'data'" class="section">
      <h2 class="section-title">数据概览</h2>
      <p class="section-desc">以下是你在本地设备上存储的数据情况。</p>
      <div class="stats">
        <div class="stat">
          <div class="stat-icon">📄</div>
          <div class="stat-num">{{ counts.articles }}</div>
          <div class="stat-label">阅读记录</div>
        </div>
        <div class="stat">
          <div class="stat-icon">⭐</div>
          <div class="stat-num">{{ counts.starred }}</div>
          <div class="stat-label">收藏</div>
        </div>
        <div class="stat">
          <div class="stat-icon">✦</div>
          <div class="stat-num">{{ counts.digests }}</div>
          <div class="stat-label">推荐历史</div>
        </div>
        <div class="stat">
          <div class="stat-icon">💾</div>
          <div class="stat-num">{{ usageLabel }}</div>
          <div class="stat-label">本地占用</div>
        </div>
      </div>
    </section>

    <section v-if="subTab === 'data'" class="section">
      <h2 class="section-title">存储策略</h2>
      <p class="section-desc">我们会根据时间自动管理本地数据，旧的内容会被归档以节省空间。</p>
      <div class="layers">
        <div class="layer layer-hot">
          <div class="layer-name">Hot &lt; 30 天</div>
          <div class="layer-detail">完整保留</div>
        </div>
        <div class="layer layer-warm">
          <div class="layer-name">Warm 30–90 天</div>
          <div class="layer-detail">裁剪正文</div>
        </div>
        <div class="layer layer-cold">
          <div class="layer-name">Cold 90–180 天</div>
          <div class="layer-detail">只留元数据</div>
        </div>
        <div class="layer layer-archive">
          <div class="layer-name">Archive &gt; 180 天</div>
          <div class="layer-detail">标记归档</div>
        </div>
      </div>
      <div class="layer-note">⭐ 收藏的内容将长期保留，不受时间限制。</div>
    </section>

    <section v-if="subTab === 'data'" class="section">
      <h2 class="section-title">数据操作</h2>
      <p class="section-desc">导出所有数据为 JSON 格式，或清空本地的全部数据。</p>
      <div class="data-actions">
        <button class="btn primary" @click="exportData">📥 导出数据 (JSON)</button>
        <button class="btn danger-outline" @click="clearData">🗑 清空全部数据</button>
      </div>
      <div class="layer-note">清空会删除阅读记录、推荐历史与负反馈，保留模型与来源设置。</div>
    </section>

    <!-- 添加 RSS 弹窗 -->
    <div v-if="rssModalOpen" class="modal-overlay" @click.self="rssModalOpen = false">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">添加 RSS 订阅</div>
          <button class="modal-close" @click="rssModalOpen = false">×</button>
        </div>
        <div class="form-group">
          <label>名称</label>
          <input v-model="newSourceName" class="input" placeholder="例如：工程实践周刊" />
          <div class="form-hint">用于在列表中识别该来源。</div>
        </div>
        <div class="form-group">
          <label>RSS 地址</label>
          <input
            v-model="newSourceUrl"
            class="input"
            placeholder="https://example.com/feed.xml"
            @keydown.enter.prevent="submitRss"
          />
          <div class="form-hint">必须以 http:// 或 https:// 开头的 RSS 地址。</div>
        </div>
        <div class="modal-actions">
          <button class="btn secondary" @click="rssModalOpen = false">取消</button>
          <button class="btn primary" @click="submitRss">添加订阅</button>
        </div>
      </div>
    </div>

    <!-- 添加追踪主题弹窗 -->
    <div v-if="topicModalOpen" class="modal-overlay" @click.self="topicModalOpen = false">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">添加追踪主题</div>
          <button class="modal-close" @click="topicModalOpen = false">×</button>
        </div>
        <div class="form-group">
          <label>主题名称</label>
          <input v-model="newTopicName" class="input" placeholder="例如：WebGPU、Rust、数字生产力" />
          <div class="form-hint">用于在列表中识别该主题。</div>
        </div>
        <div class="form-group">
          <label>搜索词</label>
          <input
            v-model="newTopicQuery"
            class="input"
            placeholder="例如：WebGPU"
            @keydown.enter.prevent="submitTopic"
          />
          <div class="form-hint">每晚用该搜索词查询 HN 与 arXiv。</div>
        </div>
        <label class="check-row">
          <input v-model="topicNightly" type="checkbox" />
          <span>每晚按主题搜索相关文章</span>
        </label>
        <div class="modal-actions">
          <button class="btn secondary" @click="topicModalOpen = false">取消</button>
          <button class="btn primary" @click="submitTopic">添加主题</button>
        </div>
      </div>
    </div>

    <!-- 清空数据二次确认弹窗 -->
    <div v-if="clearConfirmOpen" class="modal-overlay" @click.self="clearConfirmOpen = false">
      <div class="modal modal-narrow">
        <div class="warning-icon">⚠️</div>
        <div class="modal-title center">确认清空所有数据？</div>
        <div class="modal-desc">
          此操作将删除你在本地存储的全部阅读记录、推荐历史、负反馈和收藏。<br />
          该操作<b>不可撤销</b>，建议先导出数据备份。
        </div>
        <div class="modal-actions stretch">
          <button class="btn secondary" @click="clearConfirmOpen = false">取消</button>
          <button class="btn danger-solid" @click="confirmClearData">确认清空</button>
        </div>
      </div>
    </div>

    <div v-if="toast" class="toast" :class="{ error: toastError }">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  clearReadingData,
  dbCount,
  deleteSource,
  exportAllData,
  getAllArticles,
  getSources,
  getStorageUsage,
  saveSource,
  type Source,
} from '../utils/db';
import { providerHint, type TestConnectionResult } from '../utils/llm';
import { useSettingsStore } from '../stores/settings';
import { PROVIDERS, getProviderPreset } from '../utils/settings';

type SubTab = 'model' | 'notify' | 'sources' | 'privacy' | 'data';

const tabs: Array<{ key: SubTab; label: string }> = [
  { key: 'model', label: '模型与连接' },
  { key: 'notify', label: '推荐与通知' },
  { key: 'sources', label: '文章来源' },
  { key: 'privacy', label: '采集与隐私' },
  { key: 'data', label: '数据管理' },
];

const settingsStore = useSettingsStore();
const settings = computed(() => settingsStore.settings);
const preset = computed(() => getProviderPreset(settings.value.provider));

const subTab = ref<SubTab>('model');
const saving = ref(false);
const testing = ref(false);
const testResult = ref<TestConnectionResult | null>(null);

const modelForm = reactive({ baseUrl: '', model: '', apiKey: '' });
const notifyForm = reactive({ pushTime: '21:00', notify: true, digestCount: 5 });
const newInterest = ref('');
const blacklistText = ref('');
const newBlacklistSite = ref('');
const addingBlacklist = ref(false);

const rssModalOpen = ref(false);
const topicModalOpen = ref(false);
const clearConfirmOpen = ref(false);

const sources = ref<Source[]>([]);
const newSourceName = ref('');
const newSourceUrl = ref('');
const newTopicName = ref('');
const newTopicQuery = ref('');
const topicNightly = ref(true);

const counts = reactive({ articles: 0, starred: 0, digests: 0 });
const usage = reactive({ usage: 0, quota: 0 });

const toast = ref('');
const toastError = ref(false);
let toastTimer: number | undefined;

const builtinSources = computed(() =>
  sources.value.filter((source) => source.type === 'hn' || source.type === 'arxiv' || source.type === 'llm_search'),
);
const discoveredSources = computed(() =>
  sources.value.filter((source) => source.type === 'auto_discovered'),
);
const rssSources = computed(() => sources.value.filter((source) => source.type === 'rss'));
const topicSources = computed(() => sources.value.filter((source) => source.type === 'topic'));

const blacklistEntries = computed(() =>
  blacklistText.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean),
);

const usageLabel = computed(() => {
  if (!usage.usage) return '—';
  const mb = usage.usage / (1024 * 1024);
  return mb < 1 ? `${Math.round(usage.usage / 1024)} KB` : `${mb.toFixed(1)} MB`;
});

function showToast(message: string, error = false) {
  toast.value = message;
  toastError.value = error;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = '';
  }, 2400);
}

function syncForms() {
  const profile = settingsStore.profile;
  modelForm.baseUrl = profile.baseUrl;
  modelForm.model = profile.model;
  modelForm.apiKey = profile.apiKey;
  notifyForm.pushTime = settings.value.pushTime;
  notifyForm.notify = settings.value.notify;
  notifyForm.digestCount = settings.value.digestCount;
  blacklistText.value = settings.value.blacklist.join('\n');
}

async function onProviderChange(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  await settingsStore.chooseProvider(id as typeof settings.value.provider);
  syncForms();
  testResult.value = null;
}

async function saveModel() {
  saving.value = true;
  try {
    await settingsStore.updateProfile({
      baseUrl: modelForm.baseUrl.trim(),
      model: modelForm.model.trim(),
      apiKey: modelForm.apiKey.trim(),
    });
    showToast('模型配置已保存');
  } finally {
    saving.value = false;
  }
}

async function testConnection() {
  testing.value = true;
  testResult.value = null;
  try {
    await saveModel();
    const response = (await chrome.runtime.sendMessage({ type: 'test-connection' })) as {
      ok?: boolean;
      result?: TestConnectionResult;
      error?: string;
    };
    if (response?.result) {
      testResult.value = response.result;
      showToast(response.result.message, !response.result.ok);
    } else {
      showToast(response?.error || '测试失败', true);
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : '测试失败', true);
  } finally {
    testing.value = false;
  }
}

async function saveNotify() {
  saving.value = true;
  try {
    const digestCount = Math.min(8, Math.max(1, Number(notifyForm.digestCount) || 5));
    await settingsStore.update({
      pushTime: notifyForm.pushTime,
      notify: notifyForm.notify,
      digestCount,
    });
    await chrome.runtime.sendMessage({ type: 'reschedule-alarm' });
    showToast('推荐设置已保存，定时任务已更新');
  } finally {
    saving.value = false;
  }
}

async function addInterest() {
  const value = newInterest.value.trim();
  if (!value || settings.value.interests.includes(value)) return;
  await settingsStore.update({ interests: [...settings.value.interests, value] });
  newInterest.value = '';
}

async function removeInterest(value: string) {
  await settingsStore.update({
    interests: settings.value.interests.filter((interest) => interest !== value),
  });
}

async function loadSources() {
  sources.value = await getSources();
}

function sourceTypeLabel(type: Source['type']): string {
  const labels: Record<Source['type'], string> = {
    hn: 'Hacker News',
    arxiv: 'arXiv',
    rss: 'RSS',
    topic: '追踪主题',
    auto_discovered: '自动 RSS',
    llm_search: 'LLM 搜索',
  };
  return labels[type] || type;
}

function sourceIcon(type: Source['type']): string {
  switch (type) {
    case 'hn':
      return '🟠';
    case 'arxiv':
      return '📄';
    case 'auto_discovered':
    case 'rss':
      return '📡';
    case 'topic':
      return '🔎';
    default:
      return '✦';
  }
}

function sourceMeta(source: Source): string {
  const detail = source.url || source.query;
  const kind = sourceTypeLabel(source.type);
  return detail ? `${kind} · ${detail}` : kind;
}

async function toggleSource(source: Source) {
  source.enabled = !source.enabled;
  await saveSource(source);
  await loadSources();
}

async function removeSource(source: Source) {
  if (!source.id) return;
  if (!window.confirm(`删除文章来源「${source.name}」？`)) return;
  await deleteSource(source.id);
  await loadSources();
}

async function addRss(): Promise<boolean> {
  const name = newSourceName.value.trim();
  const url = newSourceUrl.value.trim();
  if (!name || !url) {
    showToast('请填写名称和 RSS 地址', true);
    return false;
  }
  if (!/^https?:\/\//.test(url)) {
    showToast('RSS 地址需要以 http(s):// 开头', true);
    return false;
  }
  await saveSource({
    type: 'rss',
    name,
    url,
    enabled: true,
    autoDetected: false,
    host: safeHost(url),
    addedAt: Date.now(),
  });
  newSourceName.value = '';
  newSourceUrl.value = '';
  await loadSources();
  showToast('RSS 源已添加');
  return true;
}

async function submitRss() {
  const added = await addRss();
  if (added) rssModalOpen.value = false;
}

async function addTopic(): Promise<boolean> {
  const name = newTopicName.value.trim();
  const query = newTopicQuery.value.trim();
  if (!name || !query) {
    showToast('请填写主题名称和搜索词', true);
    return false;
  }
  await saveSource({
    type: 'topic',
    name,
    query,
    enabled: true,
    autoDetected: false,
    addedAt: Date.now(),
  });
  newTopicName.value = '';
  newTopicQuery.value = '';
  await loadSources();
  showToast('追踪主题已添加');
  return true;
}

async function submitTopic() {
  const added = await addTopic();
  if (added) topicModalOpen.value = false;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function removeBlacklistSite(site: string) {
  blacklistText.value = blacklistEntries.value.filter((item) => item !== site).join('\n');
}

function addBlacklistSite() {
  const value = newBlacklistSite.value.trim();
  if (!value) return;
  if (!blacklistEntries.value.includes(value)) {
    blacklistText.value = [...blacklistEntries.value, value].join('\n');
  }
  newBlacklistSite.value = '';
  addingBlacklist.value = false;
}

async function savePrivacy() {
  saving.value = true;
  try {
    const blacklist = blacklistText.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    await settingsStore.update({ blacklist });
    showToast('隐私设置已保存');
  } finally {
    saving.value = false;
  }
}

async function pruneNow() {
  const response = (await chrome.runtime.sendMessage({ type: 'prune-articles' })) as {
    ok?: boolean;
    migrated?: number;
  };
  showToast(response?.migrated ? `已降级 ${response.migrated} 条记录` : '存储层已是最新');
}

async function loadStats() {
  const [digests, usageResult, list] = await Promise.all([
    dbCount('digests'),
    getStorageUsage(),
    getAllArticles(),
  ]);
  counts.articles = list.length;
  counts.digests = digests;
  counts.starred = list.filter((article) => article.starred).length;
  usage.usage = usageResult.usage;
  usage.quota = usageResult.quota;
  sources.value = await getSources();
}

async function exportData() {
  const bundle = await exportAllData();
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `peruse-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast('备份已导出');
}

function clearData() {
  clearConfirmOpen.value = true;
}

async function confirmClearData() {
  await clearReadingData();
  clearConfirmOpen.value = false;
  await loadStats();
  showToast('阅读数据已清空');
}

onMounted(async () => {
  await settingsStore.load();
  syncForms();
  await loadStats();
});
</script>

<style scoped>
.settings {
  color: var(--peruse-text);
}

/* 子页导航 */
.tabs {
  display: flex;
  gap: 4px;
  background: #fff;
  border: 1px solid var(--peruse-border);
  border-radius: 10px;
  padding: 4px;
  margin-bottom: 24px;
  overflow-x: auto;
}
.tab {
  padding: 10px 16px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--peruse-muted);
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.tab:hover {
  color: var(--peruse-text);
}
.tab.active {
  background: var(--peruse-primary-weak);
  color: var(--peruse-primary);
  font-weight: 600;
}

/* 卡片与标题 */
.section {
  background: #fff;
  border: 1px solid var(--peruse-border);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 16px;
}
.section-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 8px;
}
.section-desc {
  font-size: 12px;
  color: var(--peruse-muted);
  margin: 0 0 16px;
  line-height: 1.6;
}
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.section-head .section-title {
  margin-bottom: 4px;
}
.section-head .section-desc {
  margin-bottom: 16px;
}
.head-actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
  padding-top: 2px;
}

/* 表单 */
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
.form-group label {
  display: block;
  font-size: 13px;
  color: var(--peruse-muted);
  margin-bottom: 6px;
}
.form-group .input,
.form-group .select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--peruse-border);
  border-radius: 8px;
  font-size: 14px;
}
.form-hint {
  font-size: 11px;
  color: var(--peruse-faint);
  margin-top: 6px;
  line-height: 1.5;
}
.local-note {
  background: #e8f8ee;
  border: 1px solid #a8e0b8;
  border-radius: 8px;
  padding: 14px 16px;
  font-size: 13px;
  color: #2d7a4a;
  line-height: 1.6;
  margin-top: 8px;
}
.local-note b {
  display: block;
  margin-bottom: 4px;
  font-size: 14px;
}
.status-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
  margin-top: 12px;
  line-height: 1.6;
}
.status-banner.success {
  background: #e8f8ee;
  border: 1px solid #a8e0b8;
  color: #2d7a4a;
}
.status-banner.error {
  background: #ffe8e8;
  border: 1px solid #f0b0b0;
  color: #b5483a;
}
.status-icon {
  flex: 0 0 auto;
  font-weight: 700;
}
.status-text {
  flex: 1;
  min-width: 0;
}
.status-latency {
  flex: 0 0 auto;
  font-size: 12px;
  opacity: 0.8;
}
.info-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: var(--peruse-primary-weak);
  border: 1px solid #d4ccf5;
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 12px;
  color: var(--peruse-primary);
  margin-top: 16px;
  line-height: 1.7;
}
.info-icon {
  flex: 0 0 auto;
}
.actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 20px;
  flex-wrap: wrap;
}
.btn {
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 13px;
}
.btn.outline {
  background: #fff;
  border: 1px solid var(--peruse-border);
  color: var(--peruse-primary);
}
.btn.outline:hover:not(:disabled) {
  border-color: var(--peruse-secondary);
}

/* 开关行 */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 0;
}
.setting-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.row-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 16px;
  flex: 0 0 auto;
}
.row-title {
  font-size: 14px;
  font-weight: 500;
}
.row-desc {
  font-size: 12px;
  color: var(--peruse-muted);
  margin-top: 2px;
  line-height: 1.5;
}
.switch {
  width: 48px;
  height: 26px;
}
.switch .slider::before {
  width: 20px;
  height: 20px;
}
.switch input:checked + .slider::before {
  transform: translateX(22px);
}

/* 兴趣标签 */
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tag {
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  gap: 6px;
}
.tag-x {
  cursor: pointer;
  font-weight: 700;
  line-height: 1;
  opacity: 0.75;
}
.tag-x:hover {
  opacity: 1;
}
.tag-input {
  padding: 6px 12px;
  border: 1px dashed var(--peruse-border);
  border-radius: 6px;
  background: var(--peruse-bg);
  color: var(--peruse-muted);
  font-size: 13px;
  width: 112px;
  outline: none;
}
.tag-input:focus {
  border-color: var(--peruse-secondary);
  background: #fff;
}

/* 来源 */
.source-group {
  padding-top: 8px;
}
.source-group + .source-group {
  margin-top: 16px;
  border-top: 1px solid #f0edf5;
  padding-top: 20px;
}
.group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--peruse-text);
  margin-bottom: 4px;
}
.source-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid #f0edf5;
}
.source-row:last-of-type {
  border-bottom: 0;
}
.source-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 16px;
  flex: 0 0 auto;
}
.tint-purple {
  background: var(--peruse-primary-weak);
}
.tint-orange,
.tint-hn {
  background: #fff0e5;
}
.tint-yellow,
.tint-rss,
.tint-auto_discovered {
  background: #fff8e0;
}
.tint-red,
.tint-llm_search {
  background: #ffe8e8;
}
.tint-green {
  background: #e8f8ee;
}
.source-info {
  flex: 1;
  min-width: 0;
}
.source-name {
  font-size: 14px;
  font-weight: 500;
}
.source-desc {
  font-size: 12px;
  color: var(--peruse-muted);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.group-empty {
  padding: 10px 0 12px;
  font-size: 12px;
  color: var(--peruse-faint);
}
.delete-btn {
  border: 0;
  background: transparent;
  cursor: pointer;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: #b5483a;
  font-size: 14px;
  opacity: 0.75;
  flex: 0 0 auto;
}
.delete-btn:hover {
  opacity: 1;
  background: #ffe8e8;
}

/* 隐私 */
.privacy-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid #f0edf5;
}
.privacy-row:last-of-type {
  border-bottom: 0;
  padding-bottom: 0;
}
.privacy-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 14px;
  flex: 0 0 auto;
}
.privacy-title {
  font-size: 14px;
  font-weight: 500;
}
.privacy-desc {
  font-size: 12px;
  color: var(--peruse-muted);
  margin-top: 2px;
  line-height: 1.6;
}
.site-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #f0edf5;
}
.site-icon {
  font-size: 16px;
  flex: 0 0 auto;
}
.site-url {
  font-size: 13px;
  color: var(--peruse-muted);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.add-dashed {
  display: inline-flex;
  align-items: center;
  padding: 10px 16px;
  margin-top: 12px;
  border: 1px dashed var(--peruse-border);
  border-radius: 8px;
  background: transparent;
  color: var(--peruse-primary);
  font-size: 13px;
  cursor: pointer;
}
.add-dashed:hover {
  border-color: var(--peruse-secondary);
  background: var(--peruse-primary-weak);
}
.add-site-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.add-site-row .input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--peruse-border);
  border-radius: 8px;
  font-size: 14px;
}

/* 数据 */
.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
.stat {
  background: var(--peruse-bg);
  border-radius: 10px;
  padding: 16px;
  text-align: center;
}
.stat-icon {
  font-size: 20px;
  margin-bottom: 8px;
}
.stat-num {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.2;
}
.stat-label {
  font-size: 11px;
  color: var(--peruse-muted);
  margin-top: 2px;
}
.layers {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.layer {
  border-radius: 8px;
  padding: 14px;
  font-size: 12px;
}
.layer-hot {
  background: #fff0e5;
  color: #f2aa7e;
}
.layer-warm {
  background: #fff8e0;
  color: #c9a84c;
}
.layer-cold {
  background: var(--peruse-primary-weak);
  color: var(--peruse-primary);
}
.layer-archive {
  background: #e8e5f5;
  color: var(--peruse-muted);
}
.layer-name {
  font-weight: 600;
  margin-bottom: 4px;
}
.layer-detail {
  font-size: 11px;
}
.layer-note {
  font-size: 11px;
  color: var(--peruse-muted);
  margin-top: 12px;
  line-height: 1.6;
}
.data-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.btn.danger-outline {
  background: #fff;
  border: 1px solid #b5483a;
  color: #b5483a;
}

/* 弹窗 */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(40, 36, 61, 0.4);
}
.modal {
  width: 420px;
  max-width: 100%;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  background: #fff;
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
}
.modal-narrow {
  width: 400px;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.modal-title {
  font-size: 18px;
  font-weight: 600;
}
.modal-title.center {
  text-align: center;
  margin-bottom: 8px;
}
.modal-close {
  border: 0;
  background: transparent;
  color: var(--peruse-muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;
}
.modal-close:hover {
  color: var(--peruse-text);
}
.modal .form-group {
  margin-bottom: 16px;
}
.modal .form-group label {
  font-size: 13px;
  color: var(--peruse-muted);
  margin-bottom: 6px;
}
.modal .form-group .input {
  padding: 10px 12px;
  border: 1px solid var(--peruse-border);
  border-radius: 8px;
  font-size: 14px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}
.modal-actions.stretch .btn {
  flex: 1;
  justify-content: center;
  padding: 12px;
  font-size: 14px;
}
.btn.danger-solid {
  background: #b5483a;
  color: #fff;
}
.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 13px;
  color: var(--peruse-text);
  cursor: pointer;
}
.check-row input {
  accent-color: var(--peruse-primary);
}
.warning-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  border-radius: 50%;
  background: #ffe8e8;
  display: grid;
  place-items: center;
  font-size: 24px;
}
.modal-desc {
  font-size: 13px;
  color: var(--peruse-muted);
  text-align: center;
  line-height: 1.6;
  margin-bottom: 20px;
}
.modal-desc b {
  color: #b5483a;
}

@media (max-width: 760px) {
  .form-row,
  .stats,
  .layers {
    grid-template-columns: 1fr;
  }
  .section-head {
    flex-direction: column;
  }
  .head-actions {
    flex-wrap: wrap;
  }
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
