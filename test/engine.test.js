/**
 * 計算引擎單元測試
 *   執行:node test/engine.test.js
 * 不需要任何套件,直接載入 js/engine.js。
 */
const { Engine } = require("../js/engine.js");

let pass = 0, fail = 0;
const ck = (name, got, want, eps = 1e-9) => {
  if (Math.abs(got - want) < eps) pass++;
  else { fail++; console.log(`  ✗ ${name}\n      got ${got}\n      want ${want}`); }
};
const section = (s) => console.log(`\n── ${s} ──`);

/* ---------- 職業判定 ---------- */
section("職業判定");
for (const [cls, want] of [
  ["龍魔導士", "int"], ["夜光", "int"], ["影武者", "luk2"], ["夜使者", "luk"],
  ["傑諾", "xenon"], ["惡魔復仇者", "hp"], ["英雄(雙手武器)", "str"], ["新職業XYZ", "str"],
]) ck(`detectBuild(${cls})`, Engine.detectBuild(cls) === want ? 1 : 0, 1);

/* ---------- final_stat 解析 ---------- */
section("final_stat 解析");
const m = Engine.parseFinalStat([
  { stat_name: "傷害", stat_value: "118.00" },
  { stat_name: "HP", stat_value: "51,434" },
  { stat_name: "壞值", stat_value: "abc" },
]);
ck("百分比", m["傷害"], 118);
ck("千分位", m["HP"], 51434);
ck("無效值忽略", m["壞值"] === undefined ? 1 : 0, 1);

/* ---------- 屬性戰力 ---------- */
section("屬性戰力");
ck("一般 4×主+副", Engine.attributePower(1000, 500, "str"), 4500);
ck("傑諾同一般式", Engine.attributePower(1000, 0, "xenon"), 4000);
ck("惡復 HP 折算", Engine.attributePower(35000, 4000, "hp"), 0.8 * 35000 / 3.5 + 4000);

/* ---------- 裸值反推 ---------- */
section("裸值反推");
ck("deriveClear", Engine.deriveClear(70000, 0.9, 13000), 30000);
ck("反推↔建構互逆", Engine.deriveClear(30000 * 1.9 + 13000, 0.9, 13000), 30000);
ck("不為負", Engine.deriveClear(100, 0.5, 500), 0);

/* ---------- 無視防禦 ---------- */
section("無視防禦");
ck("乘算疊加", Engine.combineIgnore(0.9, 0.5), 1 - 0.1 * 0.5);
ck("反向移除", Engine.combineIgnore(0.9, -0.2), 1 - 0.1 / 0.8);
ck("上限 1", Engine.combineIgnore(0.999, 0.999) <= 1 ? 1 : 0, 1);
ck("防禦係數", Engine.defenseFactor(0.9, 3), 1 - 3 * 0.1);

/* ---------- 主測試基準(以實際角色面板為準) ---------- */
const base = {
  build: "int",
  mainFinal: 105946, mainPct: 7.13, mainUnique: 40390,
  minorFinal: 12569, minorPct: 1.35, minorUnique: 560,
  attack: 20965, attackPct: 1.87,
  dmg: 0.84, boss: 6.25, crit: 1.5035, fd: 1.4636,
  ignore: 0.982, bossPdr: 3,
};

section("各乘區");
ck("無變化 = 1", Engine.simulate(base, {}).total, 1, 1e-12);
ck("傷害", Engine.simulate(base, { dmg: 0.1 }).factors.dmgBoss, (1 + 0.84 + 0.1 + 6.25) / (1 + 0.84 + 6.25));
ck("BOSS 同乘區", Engine.simulate(base, { boss: 0.1 }).factors.dmgBoss, (1 + 0.84 + 6.25 + 0.1) / (1 + 0.84 + 6.25));
ck("爆傷(基底1.35)", Engine.simulate(base, { crit: 0.08 }).factors.crit, (1.35 + 1.5035 + 0.08) / (1.35 + 1.5035));
ck("終傷互乘逆推", Engine.simulate(base, { fdFrom: 0.4, fdTo: 0.6 }).factors.finalDmg, 1.6 / 1.4);
ck("無視對300%防禦", Engine.simulate(base, { ignore: 0.1 }).factors.ignore,
   Engine.defenseFactor(Engine.combineIgnore(0.982, 0.1), 3) / Engine.defenseFactor(0.982, 3));

section("攻擊力(面板含攻擊%,flat 須吃%)");
{
  const clear = 20965 / (1 + 1.87);
  const r = Engine.simulate(base, { attackFlat: 10 });
  ck("裸攻比值", r.factors.attackFlat, (clear + 10) / clear);
  ck("面板增加 = 10×(1+187%)", (r.factors.attackFlat - 1) * 20965, 10 * 2.87, 1e-6);
  ck("攻擊%", Engine.simulate(base, { attackPct: 0.12 }).factors.attackPct, (1 + 1.87 + 0.12) / (1 + 1.87));
}

section("屬性:吃% vs 不吃%");
{
  const clear = Engine.deriveClear(105946, 7.13, 40390);
  const ap = 4 * 105946 + 12569;
  const a = Engine.simulate(base, { mainFlat: 1000 }).factors.attribute;
  const b = Engine.simulate(base, { mainUnique: 1000 }).factors.attribute;
  ck("吃% 增量 = 1000×(1+713%)", (a - 1) * ap / 4, 1000 * (1 + 7.13), 1e-6);
  ck("不吃% 增量 = 1000", (b - 1) * ap / 4, 1000, 1e-6);
  ck("吃%效益較高", a > b ? 1 : 0, 1);
  ck("裸值合理", clear > 7000 && clear < 9000 ? 1 : 0, 1);
}

section("乘區獨立性");
{
  const d = { dmg: 0.1, crit: 0.08, attackFlat: 100, mainFlat: 500, ignore: 0.1, fdFrom: 0.4, fdTo: 0.6 };
  const r = Engine.simulate(base, d);
  ck("各乘區乘積 = total", r.total, Object.values(r.factors).reduce((x, y) => x * y, 1));
}

/* ---------- 兩段加權 ---------- */
section("爆發期兩段加權");
{
  const P = 0.5;
  const c = base.attack / (1 + base.attackPct), nA = base.attackPct + 0.85;
  const burst = { ...base, attackPct: nA, attack: c * (1 + nA), dmg: base.dmg + 0.65 };
  const R = Engine.power(burst) / Engine.power(base);

  ck("R = 各乘區乘積", R, ((1 + nA) / (1 + 1.87)) * ((1 + 0.84 + 0.65 + 6.25) / (1 + 0.84 + 6.25)));
  ck("無變化 = 1", Engine.simulateWeighted(base, burst, {}, P).total, 1, 1e-12);
  ck("p=0 退化為平時", Engine.simulateWeighted(base, burst, { boss: 0.3 }, 0).total,
     Engine.simulate(base, { boss: 0.3 }).total);
  ck("p=1 退化為爆發", Engine.simulateWeighted(base, burst, { boss: 0.3 }, 1).total,
     Engine.simulate(burst, { boss: 0.3 }).total);

  const rn = Engine.simulate(base, { boss: 0.3 }).total, rb = Engine.simulate(burst, { boss: 0.3 }).total;
  ck("加權公式", Engine.simulateWeighted(base, burst, { boss: 0.3 }, P).total,
     (P * R * rb + (1 - P) * rn) / (P * R + (1 - P)));

  // 交叉項:兩段加權 vs 舊「等效常駐」線性折算
  const A = (1 + nA) / (1 + 1.87), B = (1 + 0.84 + 0.65 + 6.25) / (1 + 0.84 + 6.25);
  const equivA = base.attackPct + 0.85 * P;
  const oldEquiv = { ...base, attackPct: equivA, attack: c * (1 + equivA), dmg: base.dmg + 0.65 * P };
  const rOld = Engine.power(oldEquiv) / Engine.power(base), rNew = P * R + (1 - P);
  ck("交叉項 = (p−p²)(A−1)(B−1)", rNew - rOld, (P - P * P) * (A - 1) * (B - 1));
  ck("兩段法基準較高", rNew > rOld ? 1 : 0, 1);

  // 僅作用於爆發期的額外變化量
  ck("burstExtra 空值", Engine.simulateWeighted(base, burst, {}, P, {}).total, 1, 1e-12);
  const be = Engine.simulateWeighted(base, burst, {}, P, { dmg: 0.1 }).total;
  const bc = Engine.simulateWeighted(base, burst, { dmg: 0.1 }, P).total;
  ck("僅爆發期效益 < 常駐", be < bc ? 1 : 0, 1);
}

section("mergeDelta");
ck("數值相加", Engine.mergeDelta({ boss: 0.1 }, { boss: 0.2 }).boss, 0.3);
ck("無視乘算", Engine.mergeDelta({ ignore: 0.1 }, { ignore: 0.2 }).ignore, 1 - 0.9 * 0.8);
ck("終傷覆寫", Engine.mergeDelta({ fdTo: 0.5 }, { fdTo: 0.6 }).fdTo, 0.6);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
