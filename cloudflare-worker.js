/**
 * TMS 裝備模擬計算機 — API Proxy(Cloudflare Worker)
 *
 * 用途:代替前端保管 NEXON API Key。GitHub Pages 是純靜態,
 * key 放前端一定會外洩;由這個 Worker 收前端請求、補上 key
 * 轉發給 Nexon,再帶 CORS header 回傳。
 *
 * 部署步驟見 README「部署到 GitHub Pages」章節。
 * Key 請設在 Worker 的環境變數 NEXON_API_KEY(加密 Secret),不要寫在這個檔案裡。
 */

const UPSTREAM = "https://open.api.nexon.com";

// 改成你的 GitHub Pages 網域;開發期可暫時用 "*"
const ALLOW_ORIGIN = "https://你的帳號.github.io";

// 只放行本工具用到的端點,避免 key 被拿去打其他 API
const ALLOW_PATHS = [
  /^\/maplestorytw\/v1\/id$/,
  /^\/maplestorytw\/v1\/character\/(basic|stat|item-equipment)$/,
  // ③手動填入的建議值來源
  /^\/maplestorytw\/v1\/character\/(symbol-equipment|hexamatrix-stat|hyper-stat|familiar)$/,
  /^\/maplestorytw\/v1\/user\/union-raider$/,
];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      "Access-Control-Allow-Origin": ALLOW_ORIGIN,
      "Access-Control-Allow-Headers": "content-type, x-nxopen-api-key",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    };

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "GET")
      return new Response("Method Not Allowed", { status: 405, headers: cors });
    if (!ALLOW_PATHS.some((r) => r.test(url.pathname)))
      return new Response("Not Found", { status: 404, headers: cors });

    const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
      headers: { "x-nxopen-api-key": env.NEXON_API_KEY },
    });
    const res = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};
