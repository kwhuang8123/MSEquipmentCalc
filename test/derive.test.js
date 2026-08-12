/**
 * 手填欄位自動推導的單元測試
 *   執行:node test/derive.test.js
 * 不需要任何套件。
 *
 * 分三部分:
 *   1. 純函式         —— 字串解析、生效判定、對照表查表
 *   2. 合成測資       —— 手寫的最小 API 回傳,涵蓋完整推導流程與端點失敗降級
 *   3. 真實角色對照   —— 需要 test/fixtures/,該目錄含個人角色資料故不進版控,
 *                        缺少時自動略過(期望值取自遊戲內能力值 tooltip)
 */
const fs = require("fs");
const { Engine } = require("../js/engine.js");
const { Derive } = require("../js/derive.js");

let pass = 0, fail = 0, skipped = 0;
const ck = (name, got, want, eps = 1e-9) => {
  if (Math.abs(got - want) < eps) pass++;
  else { fail++; console.log(`  ✗ ${name}\n      got ${got}\n      want ${want}`); }
};
const section = (s) => console.log(`\n── ${s} ──`);

const INT = Engine.BUILDS.int;   // 主 INT / 副 LUK

/* ==========================================================
 * 1. 純函式
 * ========================================================== */

section("潛能字串解析");
{
  const p = (s) => Derive.parsePotential(s);
  ck("百分比", p("INT +12%").value, 12);
  ck("百分比旗標", p("INT +12%").pct ? 1 : 0, 1);
  ck("非百分比", p("魔法攻擊力 +11").value, 11);
  ck("非百分比旗標", p("魔法攻擊力 +11").pct ? 1 : 0, 0);
  ck("屬性名", p("全屬性 +9%").name === "全屬性" ? 1 : 0, 1);
  ck("小數", p("爆擊傷害 +1.5%").value, 1.5);
  ck("自由文字不解析", p("被擊中時有10% 機率無視 20% 傷害") === null ? 1 : 0, 1);
  ck("空值", p(null) === null ? 1 : 0, 1);
}

section("萌獸生效判定");
{
  const a = Derive.familiarActive;
  ck("連結中", a({ familiar_state: "linked", summoned_flag: "false" }) ? 1 : 0, 1);
  ck("召喚中", a({ familiar_state: "registered", summoned_flag: "true" }) ? 1 : 0, 1);
  ck("兩者皆非", a({ familiar_state: "registered", summoned_flag: "false" }) ? 1 : 0, 0);
}

section("支援的體系");
for (const [k, want] of [["str", 1], ["dex", 1], ["int", 1], ["luk", 1],
                         ["luk2", 0], ["xenon", 0], ["hp", 0]])
  ck(`isSupported(${k})`, Derive.isSupported(k) ? 1 : 0, want);
ck("法系取魔攻", Derive.attackName("int") === "魔法攻擊力" ? 1 : 0, 1);
ck("非法系取物攻", Derive.attackName("str") === "物理攻擊力" ? 1 : 0, 1);

section("HEXA 對照表");
{
  const core = (o) => ({ character_hexa_stat_core: [o] });
  const N = "主要屬性增加";
  ck("main Lv8 = 1300", Derive.hexaMainStat(core({ main_stat_name: N, main_stat_level: 8 }), "int"), 1300);
  ck("sub Lv8 = 800", Derive.hexaMainStat(core({ sub_stat_name_1: N, sub_stat_level_1: 8 }), "int"), 800);
  ck("main/sub Lv1~4 相同",
     Derive.hexaMainStat(core({ main_stat_name: N, main_stat_level: 4 }), "int"),
     Derive.hexaMainStat(core({ sub_stat_name_1: N, sub_stat_level_1: 4 }), "int"));
  ck("非主屬項目不計", Derive.hexaMainStat(core({ main_stat_name: "爆擊傷害增加", main_stat_level: 10 }), "int"), 0);
  ck("傑諾 ×0.48", Derive.hexaMainStat(core({ main_stat_name: N, main_stat_level: 10 }), "xenon"), 2000 * 0.48);
  ck("惡復 ×21", Derive.hexaMainStat(core({ main_stat_name: N, main_stat_level: 10 }), "hp"), 2000 * 21);
}

/* ==========================================================
 * 2. 合成測資 —— 手寫的最小 API 回傳
 * ========================================================== */

// 刻意涵蓋每一條規則:全屬%、item_total_option.all_stat、寶石、未生效的萌獸、
// 聯盟非屬性項目、HEXA 主/附屬性
const SYNTH = {
  equip: { item_equipment: [
    { item_equipment_slot: "帽子",
      item_total_option: { str: "0", dex: "0", int: "500", luk: "0", all_stat: "3" },
      potential_option_1: "INT +12%", potential_option_2: "魔法攻擊力 +10%",
      potential_option_3: "被擊中時有10% 機率無視 20% 傷害",
      additional_potential_option_1: "全屬性 +5%",
      additional_potential_option_2: "INT +80", additional_potential_option_3: null },
    { item_equipment_slot: "寶石",
      item_total_option: { str: "0", dex: "0", int: "1000", luk: "0", all_stat: "0" } },
  ] },
  symbol: { symbol: [
    { symbol_name: "祕法符文：測試", symbol_int: "2200", symbol_luk: "0" },
    { symbol_name: "真實符文：測試", symbol_int: "0", symbol_luk: "0" },
  ] },
  hexa: { character_hexa_stat_core: [{ main_stat_name: "主要屬性增加", main_stat_level: 8 }] },
  hyper: { use_preset_no: "1",
    hyper_stat_preset_1: [
      { stat_type: "INT", stat_level: 6, stat_increase: "增加智力 180" },
      { stat_type: "LUK", stat_level: 4, stat_increase: "增加幸運 120" },
      { stat_type: "爆擊傷害", stat_level: 11, stat_increase: "爆擊傷害11%增加" }],
    hyper_stat_preset_2: [{ stat_type: "INT", stat_level: 10, stat_increase: "增加智力 300" }] },
  familiar: { familiar_info: [
    { familiar_state: "linked", summoned_flag: "false",
      option: [{ option_name: "INT (%)", option_value: "14" },
               { option_name: "依照被動技能來增加", option_value: "2" }] },
    { familiar_state: "registered", summoned_flag: "true",
      option: [{ option_name: "魔法攻擊力 (%)", option_value: "4" }] },
    { familiar_state: "registered", summoned_flag: "false",
      option: [{ option_name: "INT (%)", option_value: "99" }] },
  ] },
  union: { union_raider_stat: ["增加INT 100", "增加INT 80", "增加LUK 100", "增加無視防禦率 5%"] },
};

section("合成測資 — 各來源");
{
  const r = Derive.deriveManual(SYNTH, "int", INT);
  const d = r.detail;
  ck("裝備主屬% = all_stat 3 + INT 12 + 全屬 5", d.equipMainPct, 20);
  ck("裝備副屬% = all_stat 3 + 全屬 5(無 LUK%)", d.equipMinorPct, 8);
  ck("裝備攻擊%(不吃全屬、不含 all_stat)", d.equipAtkPct, 10);
  ck("萌獸主屬%(未生效者不計)", d.famMainPct, 14);
  ck("萌獸攻擊%(召喚中也算)", d.famAtkPct, 4);
  ck("符文", d.symbolMain, 2200);
  ck("HEXA main Lv8", d.hexaMain, 1300);
  ck("極限屬性取 use_preset_no 指定的那組", d.hyperMain, 180);
  ck("聯盟(略過非屬性項目)", d.unionMain, 180);
  ck("寶石", d.gemMain, 1000);
  ck("副屬:符文為 0", d.symbolMinor, 0);
  ck("副屬:極限屬性", d.hyperMinor, 120);
  ck("副屬:聯盟", d.unionMinor, 100);
  ck("副屬:寶石為 0", d.gemMinor, 0);
}

section("合成測資 — 合計");
{
  const v = Derive.deriveManual(SYNTH, "int", INT).values;
  ck("主屬%", v.mainPct, 34);
  ck("副屬%", v.minorPct, 8);
  ck("攻擊%", v.attackPct, 14);
  ck("不吃%主屬", v.mainUnique, 2200 + 1300 + 180 + 180 + 1000);
  ck("不吃%副屬", v.minorUnique, 120 + 100);
}

section("合成測資 — HEXA 只作用於主屬");
{
  // luk 體系:主屬變成 LUK,HEXA 應改記在 LUK 上
  const r = Derive.deriveManual(SYNTH, "luk", Engine.BUILDS.luk);
  ck("主屬(LUK)含 HEXA", r.detail.hexaMain, 1300);
  ck("主屬(LUK)不吃%合計", r.values.mainUnique, 0 + 1300 + 120 + 100 + 0);
}

section("端點失敗降級");
{
  const noHexa = Derive.deriveManual({ ...SYNTH, hexa: null }, "int", INT);
  ck("缺 hexa 時 mainUnique 為 null", noHexa.values.mainUnique === null ? 1 : 0, 1);
  ck("缺 hexa 不影響 mainPct", noHexa.values.mainPct, 34);
  ck("missing 列出缺漏", noHexa.missing.includes("hexa") ? 1 : 0, 1);
  const noFam = Derive.deriveManual({ ...SYNTH, familiar: null }, "int", INT);
  ck("缺 familiar 時 attackPct 為 null", noFam.values.attackPct === null ? 1 : 0, 1);
  ck("缺 familiar 不影響 mainUnique", noFam.values.mainUnique, 4860);
  const none = Derive.deriveManual({}, "int", INT);
  ck("全缺時五項皆 null", Object.values(none.values).filter(v => v === null).length, 5);
  ck("全缺時 missing 有六項", none.missing.length, 6);
  ck("不支援的體系", Derive.deriveManual(SYNTH, "xenon", Engine.BUILDS.xenon).supported ? 1 : 0, 0);
}

/* ==========================================================
 * 3. 真實角色對照(需要本地 fixture)
 * ========================================================== */

const FX_DIR = `${__dirname}/fixtures`;
const hasFixtures = ["charA", "charB"].every(n => fs.existsSync(`${FX_DIR}/${n}.json`));
const fx = (n) => JSON.parse(fs.readFileSync(`${FX_DIR}/${n}.json`, "utf8"));

if (!hasFixtures) {
  skipped = 1;
} else {
  /* charA = 琳恩:HEXA 的「主要屬性增加」兩顆都在 sub_stat */
  section("charA 琳恩 — 對照 tooltip");
  {
    const r = Derive.deriveManual(fx("charA"), "int", INT);
    const d = r.detail, v = r.values;
    ck("supported", r.supported ? 1 : 0, 1);
    ck("無缺漏來源", r.missing.length, 0);
    ck("主屬% 裝備道具", d.equipMainPct, 625);
    ck("主屬% 萌獸", d.famMainPct, 14);
    ck("主屬% 合計", v.mainPct, 639);
    ck("不吃% 符文", d.symbolMain, 21300);
    ck("不吃% HEXA", d.hexaMain, 1300);
    ck("不吃% 極限屬性", d.hyperMain, 240);
    ck("不吃% 聯盟", d.unionMain, 680);
    ck("不吃% 寶石", d.gemMain, 975);
    ck("不吃%主屬 合計", v.mainUnique, 24495);
    ck("攻擊% 裝備道具", d.equipAtkPct, 108);
    ck("攻擊% 萌獸", d.famAtkPct, 4);
    ck("攻擊% 合計", v.attackPct, 112);
  }

  /* charB = 大魔導士:「主要屬性增加」同時出現在 main_stat 與 sub_stat */
  section("charB 大魔導士 — 對照 tooltip(主屬)");
  {
    const r = Derive.deriveManual(fx("charB"), "int", INT);
    const d = r.detail, v = r.values;
    ck("主屬% 裝備道具", d.equipMainPct, 647);
    ck("主屬% 萌獸", d.famMainPct, 18);
    ck("主屬% 合計", v.mainPct, 665);
    ck("不吃% 符文", d.symbolMain, 27000);
    ck("不吃% HEXA(main Lv8 + sub Lv5 + sub Lv9)", d.hexaMain, 2700);
    ck("不吃% 極限屬性", d.hyperMain, 180);
    ck("不吃% 聯盟", d.unionMain, 680);
    ck("不吃% 寶石", d.gemMain, 1725);
    ck("不吃%主屬 合計", v.mainUnique, 32285);
    ck("攻擊% 裝備道具", d.equipAtkPct, 98);
    ck("攻擊% 萌獸", d.famAtkPct, 4);
    ck("攻擊% 合計", v.attackPct, 102);
  }

  section("charB 大魔導士 — 對照 tooltip(副屬)");
  {
    const r = Derive.deriveManual(fx("charB"), "int", INT);
    const d = r.detail, v = r.values;
    ck("副屬% 裝備道具", d.equipMinorPct, 144);
    ck("副屬% 萌獸", d.famMinorPct, 4);
    ck("副屬% 合計", v.minorPct, 148);
    ck("副屬 符文為 0", d.symbolMinor, 0);
    ck("副屬 寶石為 0", d.gemMinor, 0);
    ck("副屬 極限屬性", d.hyperMinor, 120);
    ck("副屬 聯盟", d.unionMinor, 420);
    ck("不吃%副屬 合計", v.minorUnique, 540);
  }

  section("反推裸值(對照 tooltip 基本數值)");
  {
    const r = Derive.deriveManual(fx("charB"), "int", INT);
    // 面板值取自 /character/stat:INT 81222、LUK 10531
    ck("主屬裸值 ≈ 6397",
       Engine.deriveClear(81222, r.values.mainPct / 100, r.values.mainUnique), 6397, 1);
    ck("副屬裸值 ≈ 4029",
       Engine.deriveClear(10531, r.values.minorPct / 100, r.values.minorUnique), 4029, 1);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (skipped)
  console.log("※ 已略過「真實角色對照」:test/fixtures/ 內含個人角色資料,不進版控,僅供本地測試。");
process.exit(fail ? 1 : 0);
