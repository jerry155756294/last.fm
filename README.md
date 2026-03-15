# Scrobble Dashboard — Last.fm 個人音樂儀表板

改為讀取本地 `data/` 分段 JSON，不再把歷史資料存進瀏覽器 IndexedDB。

## 新架構

- 前端只讀本地 JSON：`data/meta.json`、`data/recent.json`、`data/stats.json`、`data/top/*.json`、`data/chunks/*.json`
- 歷史 scrobble 依 15 天切成一個 JSON
- 每個 chunk 檔名都帶時間區間，例如 `scrobbles-2026-03-01_2026-03-15.json`
- `scripts/build-data.mjs` 會從 Last.fm API 抓資料並產生所有 JSON

## 兩個版本

你現在可以用兩種模式：

### 1. 本地版

- 讀 `data/*.json`
- Node 會用本機 `api-key.js` 抓 Last.fm 並寫回 `data/recent.json`
- 前端只讀 `data/recent.json`
- 不用 Cloudflare
- 適合你自己在本機即時使用

本地版現在會由 Node 同步最近播放到 `data/recent.json`，再由瀏覽器讀取，所以資料流一致。

手動更新最近播放：

```bash
update-recent.cmd
```

持續同步最近播放：

```bash
npm run sync:live
```

`open-dashboard.cmd` 在 `local` 模式下會自動啟動這個同步迴圈。

切換到本地版：

```bash
switch-local.cmd
```

### 2. Git + Cloud 版

- 靜態頁面部署到 GitHub Pages
- 歷史圖表仍讀 `data/*.json`
- 最近播放 / 正在播放改走 Cloudflare Worker
- Last.fm API key 只放在 Cloudflare Secrets，不暴露到前端

切換到 Git + Cloud 版：

```bash
switch-cloud.cmd
```

切完後請把 `runtime-config.cloud.js` 裡的 Worker 網址改成你自己的，再重新執行一次 `switch-cloud.cmd` 覆蓋到 `runtime-config.js`。

總結：

- `local` = Node 用你的 `api-key.js` 同步 `recent.json` / `meta.json`，前端只讀 JSON
- `cloud` = 前端只打 Cloudflare Worker，前後端分離，API key 不暴露

## 主要檔案

```text
lastfm-dashboard/
├── index.html
├── style.css
├── fetch-lastfm.js        # 前端本地 JSON 讀取器
├── cache-control.js       # 前端資料匯出與統計入口
├── render-ui.js           # UI 渲染與輪詢更新
├── api-key.js             # build script 讀取的 Last.fm 設定
├── scripts/
│   └── build-data.mjs     # 抓 Last.fm 並產生 data/
├── data/
│   ├── meta.json
│   ├── recent.json
│   ├── stats.json
│   ├── tags.json
│   ├── top/
│   │   ├── 7day.json
│   │   ├── 1month.json
│   │   ├── 3month.json
│   │   ├── 6month.json
│   │   ├── 12month.json
│   │   └── overall.json
│   └── chunks/
│       ├── scrobbles-YYYY-MM-DD_YYYY-MM-DD.json
│       └── ...
└── fonts/
```

## 快速開始

1. 編輯 `api-key.js`，填入 Last.fm API Key 與 Username
2. 產生本地 JSON：

```bash
npm run build:data
```

3. 啟動本地靜態伺服器：

```bash
npm run serve
```

4. 瀏覽 `http://localhost:8000`

## GitHub Pages

這個專案已加上 GitHub Pages workflow：`.github/workflows/deploy-pages.yml`

建議上傳到 GitHub 的檔案：

- `index.html`
- `style.css`
- `runtime-config.js`
- `runtime-config.cloud.js`
- `runtime-config.local.js`
- `fetch-lastfm.js`
- `cache-control.js`
- `render-ui.js`
- `fonts/`
- `data/`
- `.github/workflows/deploy-pages.yml`

不要上傳：

- `api-key.js`
- `data/.build-state.json`
- `.dev.vars`

`.gitignore` 已經幫你排除這些敏感或暫存檔。

## Cloudflare Worker（不暴露 API Key）

如果你想讓「最近播放 / 正在播放」更快更新，又不把 Last.fm API key 放到前端，可以用 Cloudflare Worker 當安全代理。

相關檔案：

- `cloudflare/worker.js`
- `cloudflare/wrangler.toml.example`

### 設定步驟

1. 安裝並登入 Wrangler

```bash
npm install
npx wrangler login
```

2. 把 `cloudflare/wrangler.toml.example` 複製成 `cloudflare/wrangler.toml`
3. 修改 `name` 為你自己的 worker 名稱
4. 設定 secrets（不會進 repo）

```bash
npm run cf:secret:key
npm run cf:secret:user
```

5. 部署 Worker

```bash
npm run cf:deploy
```

部署後你會拿到一個網址，例如：

```text
https://lastfm-dashboard-recent.<your-subdomain>.workers.dev
```

6. 把 `runtime-config.js` 的 `recentApiBase` 改成你的 Worker 網址

如果你用雙版本流程，建議直接改 `runtime-config.cloud.js`，再執行：

```bash
switch-cloud.cmd
```

```js
window.DASHBOARD_CONFIG = window.DASHBOARD_CONFIG || {
  recentApiBase: 'https://lastfm-dashboard-recent.<your-subdomain>.workers.dev',
};
```

這樣前端的 `getRecentTracks()` 會優先打 Worker 的 `/recent`，API key 只存在 Cloudflare Secrets，不會出現在 GitHub Pages 或瀏覽器程式碼裡。

如果 Worker 臨時失敗，前端會自動 fallback 到本地 `data/recent.json`，不會讓整個 dashboard 初始化失敗。

## 資料更新流程

### 建置資料

```text
npm run build:data
  → 讀取 api-key.js
  → 抓 user.getinfo
  → 抓 recent 50 筆
  → 分頁抓全部 recenttracks
  → 算出 stats.json
  → 產生 6 個排行榜 JSON
  → 產生 tags.json
  → 每 15 天切一個 chunks JSON
  → 寫出 meta.json
```

如果建置中途被中斷，下次再跑 `npm run build:data` 會自動讀取 `data/.build-state.json`，從上次抓到的頁數接著跑，不用整批重抓。

### 前端載入

```text
打開頁面
  → 讀 data/meta.json
  → 讀 recent / stats / top / tags
  → 渲染所有 UI
  → 可手動按「立即重新抓取」強制更新最近播放
  → 每 20 秒重新檢查 meta.generatedAt
      → 若資料已重建，整頁資料重新載入
      → 否則只刷新 recent.json
```

## 注意事項

- 現在不能直接雙擊 `index.html`，請用靜態伺服器開啟，因為前端需要 `fetch` JSON
- `api-key.js` 不再給前端載入，只供 build script 使用
- `匯出合併 JSON` 會把所有 chunk 合併成單一下載檔
- 瀏覽器端不支援匯入；更新資料請重新執行 `npm run build:data`
