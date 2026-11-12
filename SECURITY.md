# Security & Privacy

Peruse 是一个 local-first 浏览器扩展：阅读数据不经过任何服务器，扩展只在你配置的模型端点上发起请求。

## 数据存放在哪里

| 数据 | 位置 |
|---|---|
| 阅读记录、推荐历史、负反馈、文章来源 | 本机 IndexedDB「peruse-db」 |
| Provider / API Key / 推送时间 / 兴趣 / 黑名单 | 本机 `chrome.storage.local`（键 `peruse:settings`） |
| 推荐生成状态 | 本机 `chrome.storage.local`（键 `peruse:digest-status`） |

卸载扩展会清除以上全部数据。设置页可导出 JSON 备份，也可清空阅读数据（保留模型与来源设置）。

## 不会做的事

- 不申请 `chrome.history`，不读取浏览历史
- 不读取 Cookie、不注入远程脚本、不加载任何第三方统计 SDK
- 不上传阅读记录、标题、URL 或摘要到任何 Peruse 服务（项目不存在后端）
- 不在本地缓存 API Key 以外的地方记录 Key，导出 JSON 也只包含 IndexedDB 内容，不含 Key

## 网络请求范围

- `hn.algolia.com`、`news.ycombinator.com`：HN 候选文章
- `export.arxiv.org`：arXiv 候选文章
- 你添加或自动发现的 RSS/Atom 地址
- 你选择的 LLM 端点（OpenAI / Anthropic / Gemini / DeepSeek / 智谱 / Kimi / 通义 / OpenRouter / 本地 Ollama、LM Studio、vLLM / 自定义）

推荐请求中包含的内容：近 7 天阅读记录的标题与停留时长、兴趣标签、负反馈标题、候选文章标题/URL/摘要。若你不希望这些内容离开本机，请选择本地模型（Ollama / LM Studio / vLLM）。

## 权限说明

`storage`、`alarms`、`notifications`、`activeTab`、`scripting`；`host_permissions: <all_urls>` 仅用于注入阅读采集脚本与抓取文章源。

## 已知限制

- API Key 保存在 `chrome.storage.local`，受浏览器配置文件访问控制保护，但不是操作系统级加密
- 采集脚本注入所有页面，但你可以在设置页把这些站点加入黑名单，或直接停用扩展
- 自动发现的 RSS 只会添加为「可关闭」的来源，不会自动上传

## 报告问题

如果你发现安全问题（例如数据外发、权限滥用、XSS），请通过仓库 Issue 私密反馈或在 Issue 中描述复现步骤，不要在公开渠道贴出你的 API Key。
