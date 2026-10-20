# 積木城市 Brick by Brick

記事本 × 像素風城市養成。記下小事（看牙、每晚練英文、每週一三健身），完成就能拿金幣和建設點；劃出住宅區、商業區，房子、商店、餐廳會自己長出來，市民搬進來。

## 啟動

```bash
npm install
npm run dev      # 開發伺服器 http://localhost:5173
npm run test     # 規則單元測試
npm run build    # 產出 dist/，可直接放 GitHub Pages / Netlify
```

## 結構

- `src/tasks/types.ts`：事項、重複規則（單次／每天／每週／每月）、連續次數、提醒時間
- `src/economy/rewards.ts`：金幣、今日三大建設、回歸獎勵
- `src/city/engine.ts`：城市規則（劃區、成長、人口、幸福度、地標）
- `src/city/sprites.ts`、`render.ts`：像素素材拼圖與 canvas 繪製、走動的市民
- `src/reminders/ntfy.ts`：ntfy 排程推播（每次開網頁補滿 3 天）
- `src/useApp.ts`：全部狀態、localStorage、頁內提醒
- `src/components/`：記事本、城市、設定畫面

## 素材

像素圖塊來自 [Kenney](https://kenney.nl) 的 Roguelike Modern City，CC0 授權（`public/assets/LICENSE-kenney.txt`）。

## 部署

推到 `main` 後，GitHub Actions（`.github/workflows/deploy.yml`）會自動測試、打包並發布到 GitHub Pages。
repo 的 Settings → Pages → Source 要選「GitHub Actions」。
