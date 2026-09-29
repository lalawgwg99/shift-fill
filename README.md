# 休假意願調查（即時填寫頁）

萬家福家電部門用的休假需求收集頁。大家用自己的手機開連結、選名字、點日期填休假，
每天的休假人數即時顯示，滿 4 人（可調）的日期自動鎖住不能再選。

- 前端：`public/index.html`（手機優先，LINE 式月曆點選）
- API：`functions/api/`（Cloudflare Pages Functions + D1）
  - `GET /api/stats?month=YYYY-MM`：每天休假人數與名單
  - `GET /api/mine?name=XX&month=YYYY-MM`：某人已送出的休假
  - `POST /api/submit`：送出／更新休假（伺服器端檢查每天上限，超過的日期會被退回）
  - `GET /api/export?month=YYYY-MM`：匯出全月資料（給排班 App 同步用）
- 資料庫：`migrations/0001_schema.sql`

## 上線步驟（Cloudflare，跟 musegogo 一樣）

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git，
   選擇 `lalawgwg99/shift-fill`。
2. Build 設定：Framework preset 選 None，**Build output directory 填 `public`**，
   其他留空 → Save and Deploy。
3. 左側 D1 → Create database，取名 `shift-leave`。
4. 回到 Pages 專案 → Settings → Bindings → D1 database → Add binding，
   Variable name 填 `DB`，選擇 `shift-leave` → Save（需要 Redeploy 才會生效）。
5. D1 → `shift-leave` → Console，把 `migrations/0001_schema.sql` 的內容貼上執行。
6. （選填）Pages → Settings → Environment variables：
   - `MAX_LEAVE`：每天最多休假人數，預設 4
   - `SYNC_TOKEN`：設定後，`/api/export` 需要 `?token=` 相符才能讀取

完成後把 `https://shift-fill.pages.dev`（或自訂網域）傳到群組給大家填。
月份預設是下個月，可左右切換。
