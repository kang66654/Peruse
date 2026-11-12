<template>
  <div class="onboarding">
    <div class="page">
      <header class="page-head">
        <div class="brand">
          <div class="logo-icon">P</div>
          <div>
            <div class="logo-text">Peruse</div>
            <div class="logo-sub">被动记录的 AI 阅读助手</div>
          </div>
        </div>
        <div class="meta">
          <span class="step">首次引导 <b>{{ step }}/3</b></span>
          <span class="date">{{ todayLabel }}</span>
        </div>
      </header>

      <div class="progress">
        <span
          v-for="index in 3"
          :key="index"
          class="progress-seg"
          :class="{ on: step >= index }"
        />
      </div>

      <!-- Step 1 · 欢迎 -->
      <section v-if="step === 1" class="step-body">
        <h1>欢迎使用 Peruse</h1>
        <p class="subtitle">让优质内容主动找你，专注阅读与思考。</p>

        <div class="cards">
          <div v-for="(feature, index) in features" :key="feature.title" class="card">
            <div class="card-icon" :class="['purple', 'orange', 'yellow'][index % 3]">
              {{ feature.icon }}
            </div>
            <div class="card-text">
              <h3>{{ feature.title }}</h3>
              <p>{{ feature.desc }}</p>
            </div>
          </div>
        </div>

        <div class="footer">
          <span class="hint">全程本地存储，不读取浏览器历史</span>
          <button class="btn primary" @click="step = 2">开始设置 →</button>
        </div>
      </section>

      <!-- Step 2 · 兴趣 -->
      <section v-else-if="step === 2" class="step-body">
        <h1>
          选择你的兴趣领域
          <span class="h1-note">（已选 {{ selected.length }} 个，建议 3 个以上）</span>
        </h1>
        <p class="subtitle">我们将基于这些主题为你推荐更相关的内容。</p>

        <div class="tags">
          <button
            v-for="interest in interestOptions"
            :key="interest"
            class="tag"
            :class="{ selected: selected.includes(interest) }"
            @click="toggleInterest(interest)"
          >
            {{ interest }}
          </button>
        </div>

        <div class="input-group">
          <div class="input-label">自定义主题（可选）</div>
          <input
            v-model="newInterest"
            class="input"
            placeholder="例如：大模型应用、Rust、技术写作 ..."
            @keydown.enter.prevent="addCustomInterest"
          />
          <div class="input-hint">输入后按回车添加</div>
        </div>

        <div class="footer footer-right">
          <button class="btn secondary" @click="step = 1">← 上一步</button>
          <button class="btn primary" :disabled="selected.length === 0" @click="goModel">
            下一步 →
          </button>
        </div>
      </section>

      <!-- Step 3 · 模型与通知 -->
      <section v-else class="step-body">
        <h1>配置模型与通知</h1>
        <p class="subtitle">完成以下设置后，即可开始接收个性化的阅读推荐。</p>

        <div class="section">
          <div class="section-title">模型与连接</div>

          <div class="form-row">
            <div class="form-group">
              <label>模型提供方</label>
              <select
                class="select"
                :value="settingsStore.settings.provider"
                @change="onProviderChange"
              >
                <option v-for="provider in PROVIDERS" :key="provider.id" :value="provider.id">
                  {{ provider.label }}
                </option>
              </select>
            </div>
            <div class="form-group">
              <label>API 基础 URL</label>
              <input
                v-model="modelForm.baseUrl"
                class="input"
                placeholder="https://api.example.com/v1"
              />
              <div class="form-hint">{{ providerHint(settingsStore.settings) }}</div>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>模型名称</label>
              <input v-model="modelForm.model" class="input" list="onboarding-models" />
              <datalist id="onboarding-models">
                <option v-for="model in preset.models" :key="model" :value="model" />
              </datalist>
            </div>
            <div v-if="!preset.local" class="form-group">
              <label>API Key</label>
              <input
                v-model="modelForm.apiKey"
                class="input"
                type="password"
                placeholder="sk-…"
              />
            </div>
          </div>

          <div v-if="preset.local" class="local-note">
            <b>✓ 本地推理 · 数据不出本机</b>
            <span>模型在你的设备上运行，所有数据仅保留在本机，不会发送到云端。</span>
          </div>

          <div class="test-row">
            <button class="btn secondary" :disabled="testing" @click="testConnection">
              {{ testing ? '测试中…' : '测试连接' }}
            </button>
            <div
              v-if="testResult"
              class="test-result"
              :class="testResult.ok ? 'success' : 'error'"
            >
              <b>{{ testResult.ok ? '✓' : '⚠' }}</b>
              <span>{{ testResult.message }}</span>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">推荐与通知</div>
          <div class="form-row">
            <div class="form-group">
              <label>每日推送时间</label>
              <div class="static-value">{{ settingsStore.settings.pushTime }}</div>
            </div>
            <div class="form-group">
              <label>通知方式</label>
              <div class="static-value">
                ✓ Chrome 通知
                <span class="form-hint">在桌面右下角接收今晚推荐</span>
              </div>
            </div>
          </div>
          <div class="form-hint">完成设置后可在「设置 → 推荐与通知」中调整。</div>
        </div>

        <div class="footer footer-right">
          <button class="btn secondary" @click="step = 2">← 上一步</button>
          <div class="footer-actions">
            <button class="btn ghost" @click="finish(false)">先用规则推荐</button>
            <button class="btn primary" :disabled="finishing" @click="finish(true)">
              {{ finishing ? '保存中…' : '完成设置 ✓' }}
            </button>
          </div>
        </div>
      </section>

      <button class="skip" @click="openDashboard">跳过，直接进入仪表盘</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import { providerHint, type TestConnectionResult } from '../../utils/llm';
import { PROVIDERS, getProviderPreset } from '../../utils/settings';

const features = [
  { icon: '⏱', title: '真实阅读时长', desc: '滚动、拖选、停留节奏综合评分，只记录真正读过的内容' },
  { icon: '🤖', title: '每晚 5 篇推荐', desc: '基于近 7 天阅读历史与兴趣标签，由 AI 精选' },
  { icon: '💾', title: '完全本地', desc: '阅读数据存在本机 IndexedDB，不读取浏览器历史' },
  { icon: '🔑', title: '自带模型', desc: '支持 12 个 Provider，包括 Ollama / LM Studio 本地推理' },
  { icon: '☁️', title: '无服务器', desc: '没有任何 Peruse 后端，请求从扩展直连你的模型' },
];

const interestOptions = [
  '技术', '开源', 'AI', '设计', '产品', '科学', '商业', '编程', '创业', '心理学',
  '分布式系统', 'WebGPU', '机器学习', '效率工具',
];

const settingsStore = useSettingsStore();
const step = ref(1);
const selected = ref<string[]>([]);
const newInterest = ref('');
const modelForm = reactive({ baseUrl: '', model: '', apiKey: '' });
const testing = ref(false);
const finishing = ref(false);
const testResult = ref<TestConnectionResult | null>(null);

const preset = computed(() => getProviderPreset(settingsStore.settings.provider));

const todayLabel = computed(() =>
  new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }),
);

function toggleInterest(interest: string) {
  if (selected.value.includes(interest)) {
    selected.value = selected.value.filter((item) => item !== interest);
  } else {
    selected.value = [...selected.value, interest];
  }
}

function addCustomInterest() {
  const value = newInterest.value.trim();
  if (!value || selected.value.includes(value)) return;
  selected.value = [...selected.value, value];
  newInterest.value = '';
}

function goModel() {
  syncModelForm();
  step.value = 3;
}

function syncModelForm() {
  const profile = settingsStore.profile;
  modelForm.baseUrl = profile.baseUrl;
  modelForm.model = profile.model;
  modelForm.apiKey = profile.apiKey;
}

async function onProviderChange(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  await settingsStore.chooseProvider(id as typeof settingsStore.settings.provider);
  syncModelForm();
  testResult.value = null;
}

async function saveProfile() {
  await settingsStore.updateProfile({
    baseUrl: modelForm.baseUrl.trim(),
    model: modelForm.model.trim(),
    apiKey: modelForm.apiKey.trim(),
  });
}

async function testConnection() {
  testing.value = true;
  testResult.value = null;
  try {
    await saveProfile();
    const response = (await chrome.runtime.sendMessage({ type: 'test-connection' })) as {
      result?: TestConnectionResult;
    };
    if (response?.result) testResult.value = response.result;
  } finally {
    testing.value = false;
  }
}

async function finish(withModel: boolean) {
  finishing.value = true;
  try {
    if (withModel) await saveProfile();
    await settingsStore.update({
      interests: selected.value.length ? selected.value : settingsStore.settings.interests,
      onboarded: true,
    });
    await chrome.runtime.sendMessage({ type: 'reschedule-alarm' });
    openDashboard();
    await closeSelf();
  } finally {
    finishing.value = false;
  }
}

function openDashboard() {
  void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
}

async function closeSelf() {
  try {
    const current = await chrome.tabs.getCurrent();
    if (current?.id) await chrome.tabs.remove(current.id);
  } catch {
    // ignore
  }
}

onMounted(async () => {
  await settingsStore.load();
  selected.value = [...settingsStore.settings.interests];
  syncModelForm();
});
</script>

<style scoped>
.onboarding {
  min-height: 100vh;
  background: var(--peruse-bg);
  color: var(--peruse-text);
  padding: 40px 20px 70px;
}
.page {
  max-width: 860px;
  margin: 0 auto;
}

/* 顶部与进度 */
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo-icon {
  width: 36px;
  height: 36px;
  background: var(--peruse-primary);
  border-radius: 8px;
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
.logo-sub {
  font-size: 11px;
  color: var(--peruse-faint);
}
.meta {
  display: flex;
  align-items: center;
  gap: 16px;
}
.step {
  font-size: 13px;
  color: var(--peruse-muted);
  white-space: nowrap;
}
.step b {
  color: var(--peruse-primary);
}
.date {
  font-size: 13px;
  color: var(--peruse-muted);
  white-space: nowrap;
}
.progress {
  display: flex;
  gap: 6px;
  margin-bottom: 32px;
}
.progress-seg {
  flex: 1;
  height: 4px;
  border-radius: 999px;
  background: #e8e5f5;
  transition: background 0.2s ease;
}
.progress-seg.on {
  background: var(--peruse-primary);
}

/* 标题 */
h1 {
  font-size: 28px;
  margin: 0 0 8px;
  letter-spacing: -0.01em;
}
.h1-note {
  font-size: 14px;
  font-weight: 400;
  color: var(--peruse-muted);
}
.subtitle {
  color: var(--peruse-muted);
  font-size: 15px;
  margin: 0 0 32px;
  line-height: 1.6;
}

/* 欢迎卡片 */
.cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 600px;
}
.card {
  background: #fff;
  border: 1px solid var(--peruse-border);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.card-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 20px;
  flex: 0 0 auto;
}
.card-icon.purple {
  background: var(--peruse-primary-weak);
  color: var(--peruse-primary);
}
.card-icon.orange {
  background: #fff0e5;
  color: var(--peruse-peach);
}
.card-icon.yellow {
  background: #fff8e0;
  color: var(--peruse-yellow);
}
.card-text {
  min-width: 0;
}
.card h3 {
  font-size: 16px;
  margin: 0 0 4px;
}
.card p {
  font-size: 13px;
  color: var(--peruse-muted);
  line-height: 1.5;
  margin: 0;
}

/* 兴趣标签 */
.tags {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  max-width: 800px;
  margin-bottom: 24px;
}
.tag {
  padding: 12px 16px;
  border: 1px solid var(--peruse-border);
  border-radius: 8px;
  background: #fff;
  color: var(--peruse-text);
  font-size: 14px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.tag:hover {
  border-color: var(--peruse-secondary);
  color: var(--peruse-primary);
}
.tag.selected {
  background: var(--peruse-primary-weak);
  border-color: var(--peruse-primary);
  color: var(--peruse-primary);
  font-weight: 600;
}
.input-group {
  max-width: 800px;
  margin-bottom: 24px;
}
.input-label {
  font-size: 13px;
  color: var(--peruse-muted);
  margin-bottom: 8px;
}
.input-group .input {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--peruse-border);
  border-radius: 8px;
  font-size: 14px;
}
.input-hint {
  font-size: 11px;
  color: var(--peruse-faint);
  margin-top: 6px;
}

/* 表单与卡片 */
.section {
  background: #fff;
  border: 1px solid var(--peruse-border);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 20px;
}
.section-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 16px;
}
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
.static-value {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 0;
  font-size: 14px;
}
.test-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 16px;
}
.test-result {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 1.6;
}
.test-result.success {
  background: #e8f8ee;
  border: 1px solid #a8e0b8;
  color: #2d7a4a;
}
.test-result.error {
  background: #ffe8e8;
  border: 1px solid #f0b0b0;
  color: #b5483a;
}
.btn {
  padding: 12px 28px;
  border-radius: 8px;
  font-size: 14px;
}

/* 底部 */
.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid var(--peruse-border);
}
.footer-right {
  justify-content: flex-end;
}
.footer-actions {
  display: flex;
  gap: 12px;
}
.skip {
  display: block;
  margin: 24px auto 0;
  border: 0;
  background: transparent;
  color: var(--peruse-faint);
  font-size: 12px;
  cursor: pointer;
}
.skip:hover {
  color: var(--peruse-primary);
}

@media (max-width: 760px) {
  .onboarding {
    padding: 24px 16px 50px;
  }
  h1 {
    font-size: 20px;
  }
  .page-head {
    align-items: flex-start;
  }
  .meta {
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }
  .tags {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .form-row {
    grid-template-columns: 1fr;
  }
  .footer {
    flex-wrap: wrap;
  }
  .footer-actions {
    flex-wrap: wrap;
  }
}
</style>
