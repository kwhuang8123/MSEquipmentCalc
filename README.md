# 楓之谷TMS 裝備模擬計算機(測試版)

輸入 TMS 角色名稱,自動讀取機體與裝備,模擬屬性 ±n% 後計算總體變強幅度。
純前端單檔(`index.html`),無後端、無框架、無建置流程。

## 使用方式

1. 至 [NEXON OpenAPI](https://openapi.nexon.com/my-application/) 註冊應用程式(選 MapleStory TW)取得 API Key
2. 用瀏覽器打開 `index.html`,貼上 Key 並儲存(只存在瀏覽器 localStorage)
3. 輸入角色名稱查詢 → 基準值自動帶入 → 填模擬變化量 → 計算增幅

本機測試建議跑個簡單伺服器(部分瀏覽器對 `file://` 的 fetch 有限制):

```
python -m http.server 8000
# 開 http://localhost:8000
```

## 若遇到 CORS 錯誤

Nexon API 若不允許瀏覽器直連,查詢會顯示連線失敗。解法:在「進階:CORS Proxy 設定」
填入自架 proxy 位址(例如 Cloudflare Worker,單純轉發請求與 `x-nxopen-api-key` header 即可)。
後續正式版預計改為伺服器端持有 Key 的架構。

## 計算模型

```
總增幅 = 屬性 × 攻擊力 × 攻擊% × (1+傷害+BOSS) × 爆傷(1.35+x) × 終傷 × 無視防禦
```

| 乘區 | 公式 |
|---|---|
| 屬性 | 一般:`4×主屬+副屬`;惡魔復仇者:`0.8×HP/3.5+STR`(近似);傑諾:三屬和填入主屬 |
| 屬性模型 | `最終值 = 吃%裸值×(1+屬%) + 不吃%值`,裸值由手動填入區自動反推 |
| 手動填入 | API 無法取得的五項:攻擊%、主屬%、不吃%主屬、副屬%、不吃%副屬(依角色名記憶於 localStorage) |
| 無視防禦 | 乘算疊加 `1-(1-a)(1-b)`,效益依「目標BOSS防禦%」(預設 300)計算 |
| 終傷 | 以面板值加算(近似;實際新終傷來源為乘算) |

計算引擎為 `index.html` 內 `Engine` 模組(純函式),已通過 29 項單元測試,
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

注意:API 資料為每日快照,非即時;每組 Key 有請求額度上限。

## 已知限制 / 後續規劃

- [ ] 五項手動值後續可由 item-equipment 各件 `item_total_option`/潛能字串解析自動加總
- [ ] 實際換裝模擬(拔掉/替換某件裝備,自動算出屬性差值)
- [ ] ocid / stat 結果快取(localStorage,降低 API 用量)
- [ ] 伺服器端 proxy + 免填 Key
- [ ] 新職業自動判定表維護(目前未知職業預設力量型,可手動切換)
