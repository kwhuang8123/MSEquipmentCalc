# TMS 楓之谷裝備模擬計算機

輸入 TMS 角色名稱,自動讀取機體與裝備,模擬屬性增減後計算總體變強幅度。
純前端靜態網站,無後端、無框架、無建置流程(原生 ES modules)。

## 使用方式

1. 至 [NEXON OpenAPI](https://openapi.nexon.com/my-application/) 註冊應用程式(選 MapleStory TW)取得 API Key
2. 用瀏覽器打開 `index.html`,貼上 Key 並儲存(只存在瀏覽器 localStorage)
3. 輸入角色名稱查詢 → 基準值自動帶入 → 填模擬變化量 → 計算增幅

直接用瀏覽器開啟 `index.html` 即可(採傳統 script 載入,不需要伺服器);
若要模擬正式環境也可跑 `python -m http.server 8000`。

## 專案結構

```
index.html              版面骨架(約 200 行)
css/style.css           樣式(含 5 種主題的 CSS 變數)
js/engine.js            計算引擎 —— 純函式,無 DOM 相依
js/data/buffs.js        Buff 資料表、分組、互斥規則、數量上限
js/main.js              UI:API 客戶端、查詢、Buff 面板、模擬、方案
test/engine.test.js     引擎單元測試
cloudflare-worker.js    API Proxy(部署用,見下方)
```

載入順序為 `engine.js` → `data/buffs.js` → `main.js`(前兩者提供全域 `Engine`、`BUFF_DATA` 等)。
同一份檔案也支援 `require()`,故單元測試可直接引用而不必另行維護。

執行測試(不需安裝任何套件):

```
node test/engine.test.js
```

## 若遇到 CORS 錯誤

Nexon API 若不允許瀏覽器直連,查詢會顯示連線失敗。解法:在「進階:CORS Proxy 設定」
填入自架 proxy 位址(見下方 Worker 部署)。

## 部署到 GitHub Pages(站長提供 Key,訪客免填)

**重點:key 絕不能放進 GitHub Pages。** 靜態網站所有程式碼都是公開的,
key 寫進前端等於公開送人,額度會被盜刷、key 可能被停用。正確架構:

```
訪客瀏覽器 → GitHub Pages(純前端) → Cloudflare Worker(保管 key) → Nexon API
```

步驟:

1. **Nexon**:於 [openapi.nexon.com](https://openapi.nexon.com/my-application/) 註冊應用程式取得 live key。
   額度不夠可在 My Page 申請 service 提額。注意條款:資料至少每 30 天要更新。
2. **Cloudflare Worker**(免費 100k 請求/日):
   - dash.cloudflare.com → Workers → Create Worker,貼上 `cloudflare-worker.js` 內容
   - Settings → Variables → 新增 **Secret** `NEXON_API_KEY` = 你的 key(選加密,不要用明文變數)
   - 把程式碼裡 `ALLOW_ORIGIN` 改成 `https://你的帳號.github.io`
   - 記下 Worker 網址(`https://xxx.你的帳號.workers.dev`)
3. **前端**:`index.html` 內 `Api` 模組開頭的 `SITE_PROXY` 填入 Worker 網址,訪客即免填 key。
4. **GitHub Pages**:repo → Settings → Pages → Deploy from branch,把 `index.html` 推上去即可。

建議的額外防護(key 現在等於公開服務):

- Worker 已內建:端點白名單(只放行 4 個用到的 API)、CORS 限定來源網域(不做快取,API 約每 20 分鐘刷新,直接透傳最新資料)
- Cloudflare 免費版可再加 Rate Limiting 規則(WAF → Rate limiting rules),限制單一 IP 請求頻率
- 定期在 Nexon OpenAPI 的 Analytics Dashboard 看用量,異常再收緊

## 計算模型

```
總增幅 = 屬性 × 攻擊力 × 攻擊% × (1+傷害+BOSS) × 爆傷(1.35+x) × 終傷 × 無視防禦
```

| 乘區 | 公式 |
|---|---|
| 屬性 | 一般:`4×主屬+副屬`;惡魔復仇者:`0.8×HP/3.5+STR`(近似);傑諾:三屬和填入主屬 |
| 屬性模型 | `最終值 = 吃%裸值×(1+屬%) + 不吃%值`,裸值由手動填入區自動反推 |
| 手動填入 | API 無法取得的五項:攻擊%、主屬%、不吃%主屬、副屬%、不吃%副屬(依角色名記憶於 localStorage) |
| Buff 加成 | 62 項(技能26/藥水20/傳授技能16),疊到基準值上使增幅以「實戰狀態」為分母。無視防禦乘算、全屬加至主副屬、全屬%與攻擊%疊加至對應百分比。非常駐技能採等效值(如一擊必殺傷害100%/4秒/CD30秒 → 等效15%)。數值為遊戲公開資訊,表格格式參考 [MapleCombat](https://github.com/centre173/MapleCombat) |
| 無視防禦 | 乘算疊加 `1-(1-a)(1-b)`,效益依「目標BOSS防禦%」(預設 300)計算 |
| 終傷 | 以面板值加算(近似;實際新終傷來源為乘算) |

計算引擎為 `js/engine.js`(純函式、無 DOM 相依),已通過 47 項單元測試,
數值與 MapleStoryCalculatorV3 的公式對照一致(程式碼為重新實作,非移植)。

## 使用的 API 端點

| 端點 | 用途 |
|---|---|
| `/maplestorytw/v1/id` | 角色名 → ocid |
| `/maplestorytw/v1/character/basic` | 等級、職業、頭像 |
| `/maplestorytw/v1/character/stat` | final_stat 基準值 |
| `/maplestorytw/v1/character/item-equipment` | 裝備列表(星力、卷軸、潛能、靈魂、Preset 1–3) |

已依實際 TMS response 校正:final_stat 屬性名為英文(`STR/DEX/INT/LUK/HP`)、
爆擊機率/星力/神秘力量/真實之力/冷卻/掉寶等完整數值面板(次要數值收於「更多數值」)、
裝備支援 Preset 頁籤(圖騰與寶玉僅存在於「目前裝備」)。

注意:API 資料約每 20 分鐘刷新,非完全即時;每組 Key 有請求額度上限。

## 已知限制 / 後續規劃

- [ ] 五項手動值後續可由 item-equipment 各件 `item_total_option`/潛能字串解析自動加總
- [ ] 實際換裝模擬(拔掉/替換某件裝備,自動算出屬性差值)
- [ ] ocid / stat 結果快取(localStorage,降低 API 用量)
- [ ] 伺服器端 proxy + 免填 Key
- [ ] 新職業自動判定表維護(目前未知職業預設力量型,可手動切換)
