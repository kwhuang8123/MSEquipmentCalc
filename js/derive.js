/**
 * ③手動填入欄位的自動推導 —— 純函式,無 DOM/瀏覽器相依。
 *   瀏覽器:以 <script src> 載入後可用全域 Derive
 *   node  :const { Derive } = require('./js/derive.js')
 *
 * 由 NEXON API 的六個端點推算出五個手填值。已對照兩隻實際角色的遊戲內 tooltip
 * 逐項驗證(見 test/derive.test.js),推導出的值與 tooltip 完全一致。
 *
 * 面板模型(與 Engine.deriveClear 一致):
 *   面板值 = 裸值 × (1 + %數值) + %未套用數值
 *
 * 各數值的來源(未吃 buff 狀態):
 *   主屬% / 副屬%  = 裝備潛能 + 附加潛能 + item_total_option.all_stat + 萌獸
 *   攻擊%          = 裝備潛能 + 附加潛能 + 萌獸(不含全屬%,也不含 all_stat)
 *   不吃%主屬      = 符文 + HEXA + 極限屬性 + 聯盟攻擊隊員 + 寶石
 *   不吃%副屬      = 極限屬性 + 聯盟攻擊隊員(符文/HEXA/寶石只作用於主屬)
 */

const Derive = (() => {

  // 對照表:瀏覽器取 hexa.js 載入的全域,node 則 require(瀏覽器不會走到 require 分支)
  const HEXA = (typeof HEXA_MAIN_STAT !== "undefined")
    ? { HEXA_MAIN_STAT, HEXA_STAT_NAME, HEXA_BUILD_RATIO }
    : require("./data/hexa.js");

  /* 支援自動推導的職業體系。
   * 排除 xenon(三主屬合計)、hp(HP 換算)—— 換算方式不同且未經實測;
   * 排除 luk2(雙副屬)—— 兩項副屬可能有不同的%,無法以單一 minorPct 表示。 */
  const SUPPORTED = ["str", "dex", "int", "luk"];

  // 潛能字串:「INT +12%」「魔法攻擊力 +11」「全屬性 +9%」
  const POT_RE   = /^(.+?)\s*\+(\d+(?:\.\d+)?)(%?)$/;
  // 萌獸選項名:「INT (%)」「魔法攻擊力 (%)」;數值另存於 option_value,不含 % 符號
  const FAM_RE   = /^(.+?)\s*\(%\)$/;
  // 聯盟攻擊隊員效果:「增加INT 100」
  const UNION_RE = /^增加([A-Z]+)\s*(\d+)$/;

  const ALL_STAT = "全屬性";
  const GEM_SLOT = "寶石";

  // 屬性名 → 各端點的欄位名
  const TOTAL_OPT_FIELD = { STR: "str", DEX: "dex", INT: "int", LUK: "luk", HP: "max_hp" };
  const SYMBOL_FIELD    = { STR: "symbol_str", DEX: "symbol_dex", INT: "symbol_int",
                            LUK: "symbol_luk", HP: "symbol_hp" };

  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const r2  = (v) => Math.round(v * 100) / 100;

  const isSupported = (buildKey) => SUPPORTED.includes(buildKey);

  // 法系取魔攻,其餘取物攻(與 main.js 帶入面板攻擊力的判定一致)
  const attackName = (buildKey) => (buildKey === "int" ? "魔法攻擊力" : "物理攻擊力");

  function parsePotential(line) {
    if (!line) return null;
    const m = POT_RE.exec(String(line).trim());
    if (!m) return null;
    return { name: m[1], value: parseFloat(m[2]), pct: m[3] === "%" };
  }

  const potLines = (it) => [
    it.potential_option_1, it.potential_option_2, it.potential_option_3,
    it.additional_potential_option_1, it.additional_potential_option_2, it.additional_potential_option_3,
  ];

  // 萌獸生效條件:連結中,或目前召喚中(兩者皆會提供選項效果)
  const familiarActive = (info) =>
    info.familiar_state === "linked" || info.summoned_flag === "true";

  /* ---------- 各來源 ---------- */

  // 裝備提供的屬性%:潛能與附加潛能的「該屬性%」與「全屬性%」,
  // 再加上 item_total_option.all_stat(基礎/卷軸的全屬%,不含潛能)
  function equipStatPct(equip, names) {
    let sum = 0;
    for (const it of (equip && equip.item_equipment) || []) {
      sum += num(it.item_total_option && it.item_total_option.all_stat);
      for (const line of potLines(it)) {
        const p = parsePotential(line);
        if (!p || !p.pct) continue;
        if (p.name === ALL_STAT || names.includes(p.name)) sum += p.value;
      }
    }
    return r2(sum);
  }

  // 裝備提供的攻擊%:只有潛能與附加潛能,不吃全屬%,也不含 item_total_option
  function equipAttackPct(equip, atkName) {
    let sum = 0;
    for (const it of (equip && equip.item_equipment) || []) {
      for (const line of potLines(it)) {
        const p = parsePotential(line);
        if (p && p.pct && p.name === atkName) sum += p.value;
      }
    }
    return r2(sum);
  }

  // 萌獸提供的%(names 為屬性名陣列,或攻擊力名稱;全屬性%一併計入屬性)
  function familiarPct(familiar, names, withAllStat) {
    let sum = 0;
    for (const info of (familiar && familiar.familiar_info) || []) {
      if (!familiarActive(info)) continue;
      for (const o of info.option || []) {
        const m = FAM_RE.exec(String(o.option_name || "").trim());
        if (!m) continue;
        const name = m[1];
        if (name === ALL_STAT ? withAllStat : names.includes(name)) sum += num(o.option_value);
      }
    }
    return r2(sum);
  }

  // 符文(祕法/真實)提供的不吃%屬性
  function symbolStat(symbol, names) {
    let sum = 0;
    for (const s of (symbol && symbol.symbol) || [])
      for (const n of names) sum += num(s[SYMBOL_FIELD[n]]);
    return sum;
  }

  // HEXA 能力值的「主要屬性增加」—— 只作用於主屬
  function hexaMainStat(hexa, buildKey) {
    if (!hexa) return 0;
    let sum = 0;
    for (const key of ["character_hexa_stat_core", "character_hexa_stat_core_2", "character_hexa_stat_core_3"]) {
      for (const c of hexa[key] || []) {
        if (c.main_stat_name === HEXA.HEXA_STAT_NAME)  sum += HEXA.HEXA_MAIN_STAT.main[c.main_stat_level]  || 0;
        if (c.sub_stat_name_1 === HEXA.HEXA_STAT_NAME) sum += HEXA.HEXA_MAIN_STAT.sub[c.sub_stat_level_1] || 0;
        if (c.sub_stat_name_2 === HEXA.HEXA_STAT_NAME) sum += HEXA.HEXA_MAIN_STAT.sub[c.sub_stat_level_2] || 0;
      }
    }
    return sum * (HEXA.HEXA_BUILD_RATIO[buildKey] || 1);
  }

  // 極限屬性(Hyper Stat):取目前套用的 preset,數值直接寫在 stat_increase 裡
  function hyperStat(hyper, names) {
    if (!hyper) return 0;
    const preset = hyper["hyper_stat_preset_" + hyper.use_preset_no];
    let sum = 0;
    for (const s of preset || []) {
      if (!names.includes(s.stat_type) || !s.stat_increase) continue;
      const m = /(\d+(?:\.\d+)?)/.exec(s.stat_increase);
      if (m) sum += parseFloat(m[1]);
    }
    return sum;
  }

  // 聯盟「戰地攻擊隊員效果」提供的不吃%屬性(佔領效果則是吃%的,不在此計)
  function unionRaiderStat(union, names) {
    let sum = 0;
    for (const line of (union && union.union_raider_stat) || []) {
      const m = UNION_RE.exec(String(line).trim());
      if (m && names.includes(m[1])) sum += parseFloat(m[2]);
    }
    return sum;
  }

  // 寶石(伊妮絲的寶玉)提供的不吃%屬性
  function gemStat(equip, names) {
    let sum = 0;
    for (const it of (equip && equip.item_equipment) || []) {
      if (it.item_equipment_slot !== GEM_SLOT) continue;
      for (const n of names) sum += num(it.item_total_option && it.item_total_option[TOTAL_OPT_FIELD[n]]);
    }
    return sum;
  }

  /* ---------- 對外入口 ---------- */

  /**
   * sources : { equip, symbol, hexa, hyper, familiar, union },任一項可為 null(該端點失敗)
   * buildKey: Engine 的體系代碼
   * buildDef: Engine.BUILDS[buildKey]
   * 回傳 { supported, values, detail, missing }
   *   values 的每一項為數值,或 null(來源不足無法推導)
   */
  function deriveManual(sources, buildKey, buildDef) {
    if (!isSupported(buildKey) || !buildDef)
      return { supported: false, values: {}, detail: {}, missing: [] };

    const s = sources || {};
    const main = buildDef.main, minor = buildDef.minor || [];
    const atk = attackName(buildKey);

    const missing = ["equip", "symbol", "hexa", "hyper", "familiar", "union"].filter(k => !s[k]);
    const has = (...keys) => keys.every(k => s[k]);

    const detail = {
      equipMainPct:  has("equip")    ? equipStatPct(s.equip, main)          : null,
      equipMinorPct: has("equip")    ? equipStatPct(s.equip, minor)         : null,
      equipAtkPct:   has("equip")    ? equipAttackPct(s.equip, atk)         : null,
      famMainPct:    has("familiar") ? familiarPct(s.familiar, main, true)  : null,
      famMinorPct:   has("familiar") ? familiarPct(s.familiar, minor, true) : null,
      famAtkPct:     has("familiar") ? familiarPct(s.familiar, [atk], false): null,
      symbolMain:    has("symbol")   ? symbolStat(s.symbol, main)           : null,
      symbolMinor:   has("symbol")   ? symbolStat(s.symbol, minor)          : null,
      hexaMain:      has("hexa")     ? hexaMainStat(s.hexa, buildKey)       : null,
      hyperMain:     has("hyper")    ? hyperStat(s.hyper, main)             : null,
      hyperMinor:    has("hyper")    ? hyperStat(s.hyper, minor)            : null,
      unionMain:     has("union")    ? unionRaiderStat(s.union, main)       : null,
      unionMinor:    has("union")    ? unionRaiderStat(s.union, minor)      : null,
      gemMain:       has("equip")    ? gemStat(s.equip, main)               : null,
      gemMinor:      has("equip")    ? gemStat(s.equip, minor)              : null,
    };

    const sum = (...vals) => vals.some(v => v == null) ? null : r2(vals.reduce((a, b) => a + b, 0));

    const values = {
      attackPct:   sum(detail.equipAtkPct,   detail.famAtkPct),
      mainPct:     sum(detail.equipMainPct,  detail.famMainPct),
      minorPct:    minor.length ? sum(detail.equipMinorPct, detail.famMinorPct) : 0,
      mainUnique:  sum(detail.symbolMain, detail.hexaMain, detail.hyperMain, detail.unionMain, detail.gemMain),
      minorUnique: minor.length
        ? sum(detail.symbolMinor, detail.hyperMinor, detail.unionMinor, detail.gemMinor)
        : 0,
    };

    return { supported: true, values, detail, missing };
  }

  return { SUPPORTED, isSupported, attackName, parsePotential, familiarActive,
           equipStatPct, equipAttackPct, familiarPct, symbolStat, hexaMainStat,
           hyperStat, unionRaiderStat, gemStat, deriveManual };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Derive };
