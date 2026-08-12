/**
 * HEXA 能力值「主要屬性增加」對照表(數值為遊戲公開資訊)
 *   main = 核心的 main_stat_name / sub = sub_stat_name_1、sub_stat_name_2
 *   兩者數值不同:附屬性為線性 100×Lv,主屬性自 Lv5 起加速。
 *
 * 只收「主要屬性增加」一項。其餘(爆擊傷害增加、boss傷害增加)已含在 API 面板的
 * 「爆擊傷害」「BOSS怪物傷害」裡,再取一次會重複計算。
 */

const HEXA_MAIN_STAT = {
  main: { 1: 100, 2: 200, 3: 300, 4: 400, 5: 600, 6: 800, 7: 1000, 8: 1300, 9: 1600, 10: 2000 },
  sub:  { 1: 100, 2: 200, 3: 300, 4: 400, 5: 500, 6: 600, 7: 700,  8: 800,  9: 900,  10: 1000 },
};

// API 回傳的屬性名稱(注意 boss 為小寫,與其他項目不同)
const HEXA_STAT_NAME = "主要屬性增加";

// 體系換算倍率:傑諾為三主屬「合計」值,惡魔復仇者換算為 HP。未列出者為 1。
const HEXA_BUILD_RATIO = { xenon: 0.48, hp: 21 };

if (typeof module !== "undefined" && module.exports)
  module.exports = { HEXA_MAIN_STAT, HEXA_STAT_NAME, HEXA_BUILD_RATIO };
