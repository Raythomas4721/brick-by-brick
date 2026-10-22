# 積木城市 Brick by Brick

記事本 × 消消樂。記下小事（看牙、每晚練英文、每小時喝水），完成就拿 ❤️ 體力和道具，去玩無限關卡的積木消消樂。

## 啟動

```bash
npm install
npm run dev      # 開發伺服器 http://localhost:5173
npm run test     # 規則單元測試
npm run build    # 產出 dist/，可直接放 GitHub Pages / Netlify
```

## 結構

- `src/tasks/types.ts`：事項、重複規則（單次／每天／每週／每月／間隔）、連續次數、提醒時間
- `src/economy/rewards.ts`：體力、道具、今日三大建設、習慣里程碑、回歸禮
- `src/game/match3.ts`：消消樂引擎（連線、特殊積木、連鎖、木箱、道具）
- `src/game/levels.ts`：用關卡編號產生無限關卡
- `src/push/`：推播通知（訂閱、把未來 30 天的提醒同步到後端）
- `worker/`：推播後端（Cloudflare Workers＋D1，每分鐘送出到期的提醒）
- `public/sw.js`、`manifest.webmanifest`：可安裝成 App（加入主畫面）與接收推播
- `src/useApp.ts`：全部狀態、localStorage、頁內提醒
- `src/components/`：記事本、消消樂（關卡地圖、棋盤）、設定畫面

## 素材

分享預覽圖與 App 圖示使用 [Kenney](https://kenney.nl) 的 Roguelike Modern City 圖塊，CC0 授權（`public/assets/LICENSE-kenney.txt`）；遊戲積木用 CSS 繪製。

## 在 iPhone 上當 App 用

用 Safari 打開網站 → 分享 →「加入主畫面」→ 從主畫面圖示打開 → 設定頁「開啟推播通知」。

## 部署

推到 `main` 後，GitHub Actions（`.github/workflows/deploy.yml`）會自動測試、打包並發布到 GitHub Pages。
repo 的 Settings → Pages → Source 要選「GitHub Actions」。

### 推播後端（第一次）

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create brick-by-brick-push   # 把 database_id 填進 wrangler.toml
npm run db:init
npx wrangler secret put VAPID_PRIVATE_JWK     # 貼上 .dev.vars 裡的值（不要提交到 git）
npm run deploy                                # 把網址填進 src/push/config.ts 的 PUSH_API
```
