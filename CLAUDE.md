# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案性質

TMS(台版楓之谷)裝備模擬計算機。純靜態前端,部署於 GitHub Pages。
**沒有建置系統、沒有 package.json、沒有第三方依賴。** 不要引入 bundler、框架或 npm 套件。

## 常用指令

```bash
node test/engine.test.js
```

```bash
node test/derive.test.js
```

兩個測試檔,零依賴的自製斷言腳本(`ck()` 比對浮點數,`section()` 分段),
全部通過印出 `N passed, 0 failed` 並 `exit 0`,有失敗則 `exit 1`。
沒有「跑單一測試」的機制 —— 要縮小範圍就直接註解掉不需要的 section。

**注意:開發機上可能沒有安裝 node**(`node --version` 找不到指令)。此時可改用瀏覽器執行:
把 `js/engine.js`、`js/data/hexa.js`、`js/derive.js`、測試檔與 fixture 串成一個 HTML,
並 shim 掉 `require` / `fs.readFileSync` / `process.exit` / `console.log`,即可跑同一份測試檔。

本地預覽需要 HTTP,不能用 `file://`(測試 fixture 用 `fetch` 讀取,且 API 請求會因 CORS 失敗):

```bash
python -m http.server 8932 --bind 127.0.0.1
```

## 架構

### 載入模型:全域變數,非 ES module

`index.html` 結尾以 `<script src>` 依序載入,**順序有意義**:

1. `js/engine.js` — 定義全域 `Engine`
2. `js/data/buffs.js` — 定義全域 `BUFF_DATA` / `BUFF_GROUPS` / `BUFF_EXCLUSIVE` / `BUFF_LIMIT`
3. `js/data/hexa.js` — 定義全域 `HEXA_MAIN_STAT` / `HEXA_STAT_NAME` / `HEXA_BUILD_RATIO`
4. `js/derive.js` — 定義全域 `Derive`,**依賴 hexa.js 已載入**
5. `js/main.js` — 使用上述全域變數,結尾設 `window.__msecReady = true`

前四者結尾都有 `if (typeof module !== "undefined" && module.exports)` 的雙棲導出,
讓 node 測試能 `require`。新增資料檔時請沿用此模式。

`derive.js` 另有一段瀏覽器/node 雙路徑的對照表解析(`typeof HEXA_MAIN_STAT !== "undefined"`
時取全域,否則 `require`)—— 瀏覽器永遠走前者,不會碰到 `require`。

`index.html:188-200` 有啟動診斷:3 秒內沒看到 `__msecReady` 就顯示錯誤訊息。

### 分層界線

| 檔案 | 職責 | 可測試性 |
|---|---|---|
| `js/engine.js` | 純函式計算引擎,**零 DOM 相依** | 有單元測試 |
| `js/derive.js` | 由 API 回傳推導③手填值,**零 DOM 相依** | 有單元測試 |
| `js/data/buffs.js` | Buff 數值表(純資料) | 間接 |
| `js/data/hexa.js` | HEXA 能力值對照表(純資料) | 間接 |
| `js/main.js` | API 客戶端 + 所有 DOM 渲染與狀態 | 無測試 |
| `cloudflare-worker.js` | API proxy,**不屬於靜態站**,需另行部署 | 無測試 |

**任何新的計算邏輯都應該放進 `js/engine.js` 並補測試**,而不是寫在 `main.js` 裡。
`main.js` 應該只負責「讀 DOM → 組參數 → 呼叫 Engine → 寫 DOM」。

### 傷害模型(理解這段才改得動 engine.js)

`Engine.simulate(baseline, delta)` 回傳 `{ factors, total }`,
`total` 是各**乘區**倍率的連乘積(測試 `test/engine.test.js:92-97` 驗證這個不變式):

`attribute × attackFlat × attackPct × dmgBoss × crit × finalDmg × ignore`

各乘區的關鍵細節:

- **屬性**:模型為 `最終值 = 吃%裸值 × (1 + 屬性%) + 不吃%值`。
  `deriveClear()` 是這條式子的逆運算,用來從面板值反推裸值。
  戰力 = `4×主屬 + 副屬`;惡魔復仇者以 HP 折算(`DA_HP_DIVISOR`/`DA_HP_WEIGHT`,engine.js:38)。
- **攻擊力**:API 面板值**已含攻擊%**。因此 flat 加成必須先 `÷(1+攻擊%)` 還原裸攻,
  加完再一併乘回去(engine.js:113-117)。這是最容易寫錯的地方。
- **爆傷**:`CRIT_BASE = 1.35` = 基礎傷害 1.0 + 基礎爆傷 0.35。
  已確認 API 的「爆擊傷害」欄位**不含**基礎 35%,所以相加不會重複計算(engine.js:35-37)。
- **傷害 % 與 BOSS 傷 % 同一個乘區**,不可拆開算。
- **終傷**:各來源之間**互乘**,不能加減面板值。故 delta 用 `fdFrom` / `fdTo`
  表示「單一來源的原先→調整後」,增幅 = `(1+fdTo)/(1+fdFrom)`。
- **無視防禦**:乘算疊加(`combineIgnore`),負值代表移除一條。
  實際效益還要經 `defenseFactor(ignore, bossPdr)` 對目標防禦率換算。

`百分比一律以小數傳入 Engine`(85% → 0.85)。DOM 層存的是 0~100,`main.js` 的
`pct()` 負責轉換 —— 跨層修改時特別注意這個單位邊界。

### 爆發期兩段加權

`Engine.simulateWeighted(normal, burst, delta, p, burstExtra)`(engine.js:160-176)。

平時與爆發期**各自算一次傷害再加權**,而不是把爆發 buff 折算成「等效常駐值」。
原因:等效常駐法會把爆發 buff 之間的交叉項稀釋成 p²(測試 engine.test.js:118-124
明確驗證差額 = `(p−p²)(A−1)(B−1)`)。改動這裡務必保持兩段結構。

`main.js` 的 `BuffUI.totals(onlyBurst)`(main.js:428-449)決定 buff 落在哪一段:

- 爆發窗內覆蓋率 = `min(持續秒數, W) / W`
- 溢出到平砍 = `p × max(持續秒數 − W, 0) / (W × (1 − p))`

W = 爆發窗秒數,由④「爆發窗秒數」欄位讀取,預設 20。

### DOM 即狀態

**`evaluate()`(main.js:1154)每次都從 DOM 重新讀取 baseline**,沒有中央 store。
連帶影響:

- 已儲存的方案不存快照增幅,而是用 `livePct()` 以當前 DOM 狀態**即時重算**
  (main.js:1259),存檔值 `totalPct` 僅用於顯示漂移標記。
- Buff 的「滿等 +X%」試算(`levelUpGain`, main.js:480)同樣依賴 DOM,
  所以 `BuffUI` 必須在基準值欄位就緒後才能算 —— 這就是 `setupSimulation()`
  結尾那段初始化順序的原因(main.js:967-972):
  手動欄位 → `BuffUI.init` → `fillBaseline` → `buffReady = true` → `redrawActive`。
  **改動這段順序前先讀那幾行的註解。**
- `window.onBuffChange = fillBaseline`(main.js:931)是 buff 變動回寫基準值的掛鉤。

### API 與 proxy

`main.js:4-54` 的 `Api` 模組。`SITE_PROXY`(main.js:7)硬編碼站方的 Cloudflare Worker
網址;有值時前端**不帶 key**,①API 設定卡自動收合。留空則退回「使用者自備 key 直連」。

`cloudflare-worker.js` 需獨立部署,key 設在 Worker 環境變數 `NEXON_API_KEY`,
且 `ALLOW_ORIGIN`(worker:15)與 `ALLOW_PATHS`(worker:18)是白名單,
新增 API 端點時兩邊都要改。**改了白名單就必須重新部署 Worker,否則前端會拿到 404。**

共用到 9 個端點:`id` / `character/basic` / `character/stat` / `character/item-equipment`
是主流程;`character/symbol-equipment` / `hexamatrix-stat` / `hyper-stat` / `familiar`
與 `user/union-raider` 是③建議值的來源,以 `Promise.allSettled` 取得,**任一失敗只會讓
相關欄位沒有建議值,不中斷查詢**。這五個在主畫面渲染完才 await,不擋畫面;回來時以
`searchSeq` 比對,丟棄使用者已改查別的角色後才到的結果。

### ③手填值的自動推導

`js/derive.js` 由 API 推算出③的五個手填值,顯示為**建議值**(欄位下方附「套用」鈕),
不直接覆蓋使用者填寫的內容 —— 因為常駐被動技能提供的%無法從 API 取得。

推導規則已對照兩隻實際角色的遊戲內 tooltip 逐項驗證。

`test/derive.test.js` 分三段:純函式、合成測資、真實角色對照。
**前兩段永遠會跑;第三段需要 `test/fixtures/`,該目錄含個人角色的裝備與萌獸資料,
已列入 `.gitignore` 不進版控**,缺少時測試會自動略過並印出說明(不算失敗)。
所以在乾淨的 clone 上是 55 項斷言,本地有 fixture 時是 91 項。
新增規則時請**同時**補進合成測資,不要只靠 fixture —— 否則公開 repo 上等於沒測到。

改動 `derive.js` 前先讀那份測試,幾個反直覺的點:

- **`item_total_option` 不含潛能** —— 屬性%要「潛能字串 + `all_stat`」兩邊相加;
  但攻擊%只算潛能,不含 `all_stat`,也不吃全屬%
- **萌獸生效條件是 `familiar_state === "linked"` 或 `summoned_flag === "true"`** —— 兩者皆算
- **HEXA 的「主要屬性增加」main 與 sub 用不同對照表**,且只作用於主屬
- **寶石(`item_equipment_slot === "寶石"`)的屬性進「不吃%」**,圖騰與拼圖則是吃%的
- **聯盟:`union_raider_stat` 進「不吃%」,`union_occupied_stat` 則是吃%的**(後者目前未取用)
- **極限屬性直接讀 `stat_increase` 裡的數字**,並且要取 `use_preset_no` 指定的那組

`Derive.SUPPORTED` 只列 `str`/`dex`/`int`/`luk`。`xenon`(三主屬合計)、`hp`(HP 換算)、
`luk2`(雙副屬無法以單一 `minorPct` 表示)不提供建議值,UI 會顯示說明。

### localStorage

全部以 `msec_` 前綴。**依角色名分開儲存**的有三類 —— 改動 key 格式會讓既有使用者資料失效:

| Key | 內容 |
|---|---|
| `msec_key` / `msec_base` | 使用者自備 API key / 自訂 base URL |
| `msec_theme` / `msec_recent` | 主題、最近查詢角色(上限 8) |
| `msec_buff_<角色名>` | `{ sel, mode }`,`mode` 為 hot/cold(有相容舊版純勾選表的分支,main.js:738) |
| `msec_manual_<角色名>` | ③手動填入欄位 |
| `msec_target_<角色名>` | ⑤「目標BOSS防禦%」。**刻意獨立於基準值之外**,不隨 buff 變動被 `fillBaseline` 覆寫 |
| `msec_plans_<角色名>` | ⑥儲存方案陣列 |

⑤的基準值欄位每次 `fillBaseline()` 都會整批重寫,所以使用者手動改過的值會被 buff 變動沖掉。
「目標BOSS防禦%」因此被移出 `BASE_FIELDS`、獨立成 `TARGET_FIELDS` 並自行記憶 —— 之後若有
其他「使用者設定而非 API 帶入」的欄位,沿用這個模式,不要塞回 `BASE_FIELDS`。

### Buff 資料表 schema

`js/data/buffs.js` 開頭的註解就是完整規格。新增項目時的欄位語意:

- `e` 固定效果 / `lv` 各等級效果 / `step`+`max` 等差自動展開成等級表
- `burst: 1` 僅爆發窗內生效;`dur`(固定秒)、`durLv`(依等級)、`durDyn: "soul"`(依 API「Buff持續時間」動態算)
- `np: 1` 非常駐,數值本身已是等效值;`job` 提供該連結技能的職業(用於「自身」判定)
- `r` 備註字串,顯示在 tooltip

效果 key(`atk`/`atkP`/`dmg`/`boss`/`crit`/`ign`/`all`/`allP`/`main`/`sub`/`sub2`/`hp`)
到引擎 delta 的映射在 `effToDelta()`(main.js:456-477)—— **新增效果 key 必須同步改那裡**,
否則會被靜默忽略。

`BUFF_GROUPS` 的 `null` 代表「該分類其餘未分組項目」;`BUFF_LIMIT.pass = 12`
是他人連結技能上限,自身那條(`isOwnLink`)不佔額度。

### 職業判定

`Engine.detectBuild()` 以**包含比對** `CLASS_KEYWORDS`(engine.js:21-33),
容忍 API 職業名變體,查無對應時 fallback 為 `str`。
使用者可在⑤手動覆寫「職業體系」下拉選單。新職業上線時在此表補關鍵字並加測試。

## 慣例

- 註解、UI 文案、README 皆為繁體中文;識別字為英文。維持此風格。
- 全形括號 `()` 用於中文文案,半形用於程式碼。
- HTML 以 `insertAdjacentHTML` 組字串渲染,使用者可控內容一律經 `esc()`
  (main.js:60)跳脫 —— 新增渲染程式碼時沿用。
- Commit message 格式:subject 為純版號(`v1.3.1`),body 為繁體中文簡短說明(可留空)。
  此規範優先於全域的 Conventional Commits。
