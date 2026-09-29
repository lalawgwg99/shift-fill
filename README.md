# 休假意願調查（即時填寫頁）

萬家福家電部門用的休假需求收集頁。大家用自己的手機開連結、選名字、點日期填休假，
每天的休假人數即時顯示，滿 4 人（可調）的日期自動鎖住不能再選。

- 前端：`public/index.html`（手機優先，LINE 式月曆點選）
- API：`functions/api/`（Cloudflare Pages Functions + D1）
  - `GET /api/stats?month=YYYY-MM`：每天休假人數與名單
  - `GET /api/mine?name=XX&month=YYYY-MM`：某人已送出的休假
  - `POST /api/submit`：送出／更新休假（伺服器端檢查每天上限與每週上限，超過的日期會被退回）
  - `GET /api/export?month=YYYY-MM`：匯出全月資料（給排班 App 同步用）
  - `GET /api/config`：目前設定（上限、每週天數、名單、豁免）
  - `POST /api/config`：修改設定（需管理密碼）
- 排班設定頁：`public/admin.html`（手機可開，設管理密碼後可調：每天上限、每週每人天數、員工名單、不佔名額人員）
- 資料庫：`migrations/0001_schema.sql`（API 首次被呼叫會自動建表，也可手動跑）

## 上線步驟（Cloudflare，跟 musegogo 一樣）

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git，
   選擇 `lalawgwg99/shift-fill`。
2. Build 設定：Framework preset 選 None，**Build output directory 填 `public`**，
   其他留空 → Save and Deploy。
3. 左側 D1 → Create database，取名 `shift-leave`。
4. 回到 Pages 專案 → Settings → Bindings → D1 database → Add binding，
   Variable name 填 `DB`，選擇 `shift-leave` → Save（需要 Redeploy 才會生效）。
5. 資料表會由 API 第一次被呼叫時自動建立（`ensureSchema`，內容同 `migrations/0001_schema.sql`），
   不需手動執行；若想手動建，也可到 D1 → `shift-leave` → Console 貼上該檔案內容執行。
6. （選填）Pages → Settings → Environment variables：
   - `MAX_LEAVE`：每天最多休假人數，預設 4
   - `SYNC_TOKEN`：設定後，`/api/export` 需要 `?token=` 相符才能讀取

完成後把 `https://shift-fill.pages.dev`（或自訂網域）傳到群組給大家填。
月份預設是下個月，可左右切換。

## 管理設定（排班的人用）

用手機開 `https://shift-fill.pages.dev/admin.html`（填寫頁右上角也有 ⚙️ 可進）：
第一次會請你設一組管理密碼，之後修改都要輸入密碼。

可調項目：
- 每天最多休假人數（預設 4）
- 每週每人最多先排天數（預設 2；之後想開放更多天直接調大）
- 員工名單（一人一行）
- 不佔每日名額的人員（預設：榮德、俊霖）

設定存在資料庫，改完立刻生效，不用重新部署。
