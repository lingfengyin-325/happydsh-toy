/**
 * 动能衰竭、均值回归与单边走势消除专项测试
 * 验证：
 * 1. 股票连续上涨后，动能衰竭与获利盘抛压机制是否生效
 * 2. 价格严重偏离 20 日均线时，均值回归拉力是否强劲
 * 3. 连续推进 30 个交易日，杜绝出现“连续 10 天以上纯单边直线上涨或下跌”的股票
 * 4. 统计全市场所有标的的多空胜率，验证是否呈现真实的波段震荡与高低切换
 */

const assert = require("assert");
const { QuantFactorEngine, MacroRegimeEngine } = require("../quant-engine.js");

const TEST_STOCKS = [
  { code: "SZ·300750", name: "宁德时代", sector: "动力电池", beta: 1.2, base: 180 },
  { code: "SH·688981", name: "中芯国际", sector: "半导体", beta: 1.35, base: 45 },
  { code: "SH·600036", name: "招商银行", sector: "银行", beta: 0.55, base: 32 },
  { code: "SPX·SIM", name: "SpaceX", sector: "商业航天", beta: 1.45, base: 220 },
  { code: "SH·600519", name: "贵州茅台", sector: "白酒", beta: 0.85, base: 1600 },
  { code: "SZ·002594", name: "比亚迪", sector: "新能源汽车", beta: 1.15, base: 230 },
  { code: "SH·600900", name: "长江电力", sector: "水电", beta: 0.42, base: 28 },
  { code: "SZ·000725", name: "京东方A", sector: "面板", beta: 1.10, base: 4.2 },
  { code: "SH·601012", name: "隆基绿能", sector: "光伏", beta: 1.25, base: 18 },
  { code: "SH·600030", name: "中信证券", sector: "券商", beta: 1.40, base: 22 }
];

console.log("=== 启动动量衰竭、均值回归与单边走势消除专项测试 ===");

// 测试 1: 验证连续上涨后的动能衰竭与获利盘抛压
console.log("测试 1: 验证连续上涨 5 日后的动能衰竭与抛压机制...");
const mockBullHistory = [];
let p = 100;
for (let i = 0; i < 25; i++) {
  mockBullHistory.push({ open: p, close: p, high: p * 1.01, low: p * 0.99, vol: 50000 });
}
// 随后连续 5 天大幅暴涨
for (let i = 0; i < 5; i++) {
  p = p * 1.03;
  mockBullHistory.push({ open: p * 0.98, close: p, high: p * 1.01, low: p * 0.98, vol: 80000 });
}

const bullStock = { code: "TEST01", name: "连涨测试股", sector: "半导体", beta: 1.2 };
// 高位排位 (前 10%)
const bullFactors = QuantFactorEngine.computeFactors(mockBullHistory, bullStock, { crossSectionalRank: 0.95 });

console.log("  5连涨后 5日动量 ROC5:", bullFactors.momentum5 + "%");
console.log("  5连涨后 20日乖离率 BIAS20:", bullFactors.bias20 + "%");
console.log("  5连涨后 综合 Alpha 得分:", (bullFactors.compositeScore * 100).toFixed(2));

assert.ok(bullFactors.momentum5 > 10, "5日累计涨幅应大于10%");
assert.ok(bullFactors.bias20 > 5, "20日乖离率应显著超买");
// 关键断言：连续暴涨后，获利回吐抛压必须使 compositeScore 转为负数或强烈受到压制！
assert.ok(bullFactors.compositeScore < 0, "连续暴涨后综合得分必须转为负向抛压（涨多了就是利空）");
console.log("✓ 连续上涨动能衰竭与获利了结抛压验证通过！");

// 测试 2: 验证连续暴跌后的超跌企稳反弹拉力
console.log("测试 2: 验证连续暴跌后的超跌企稳与抄底拉力...");
const mockBearHistory = [];
let bp = 100;
for (let i = 0; i < 25; i++) {
  mockBearHistory.push({ open: bp, close: bp, high: bp * 1.01, low: bp * 0.99, vol: 50000 });
}
// 随后连续 5 天大幅暴跌
for (let i = 0; i < 5; i++) {
  bp = bp * 0.97;
  mockBearHistory.push({ open: bp * 1.02, close: bp, high: bp * 1.02, low: bp * 0.99, vol: 90000 });
}
const bearStock = { code: "TEST02", name: "超跌测试股", sector: "医药", beta: 0.9 };
// 低位排位 (后 5%)
const bearFactors = QuantFactorEngine.computeFactors(mockBearHistory, bearStock, { crossSectionalRank: 0.05 });
console.log("  5连跌后 5日动量 ROC5:", bearFactors.momentum5 + "%");
console.log("  5连跌后 20日乖离率 BIAS20:", bearFactors.bias20 + "%");
console.log("  5连跌后 综合 Alpha 得分:", (bearFactors.compositeScore * 100).toFixed(2));

assert.ok(bearFactors.bias20 < -5, "20日乖离率应显著超跌");
assert.ok(bearFactors.compositeScore > 0, "超跌后综合得分必须转为正向估值修复（跌透了就是利好）");
console.log("✓ 连续暴跌超跌修复与企稳拉力验证通过！");

// 测试 3: 模拟全市场 15 只股票连续运行 30 个交易日，统计连续单边天数
console.log("测试 3: 模拟多标的 30 日走势，检查是否存在单边永动机现象...");
const macro = MacroRegimeEngine.createState(42);

// 简易伪随机生成器
function pseudoRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const rand = pseudoRandom(10086);
const marketSim = TEST_STOCKS.map((stock, idx) => {
  const history = [];
  let price = stock.base;
  for (let i = 0; i < 30; i++) {
    price = price * (1 + (rand() - 0.5) * 0.02);
    history.push({ open: price, close: price, high: price * 1.01, low: price * 0.99, vol: 50000 });
  }
  return { stock, history, upDays: 0, downDays: 0, maxUpStreak: 0, maxDownStreak: 0, curUpStreak: 0, curDownStreak: 0 };
});

for (let day = 0; day < 30; day++) {
  // 1. 横截面排序
  const perf = marketSim.map((m, id) => {
    const len = m.history.length;
    const cNow = m.history[len - 1].close;
    const cPrev5 = m.history[Math.max(0, len - 5)].close;
    return { id, ret5: (cNow - cPrev5) / cPrev5 };
  });
  perf.sort((a, b) => a.ret5 - b.ret5);
  const ranks = {};
  perf.forEach((item, r) => {
    ranks[item.id] = r / (perf.length - 1);
  });

  // 2. 大盘演化
  const macroRet = MacroRegimeEngine.stepMacro(macro, rand);

  // 3. 各股票演化
  for (let id = 0; id < marketSim.length; id++) {
    const item = marketSim[id];
    const factors = QuantFactorEngine.computeFactors(item.history, item.stock, { crossSectionalRank: ranks[id] });
    const randomNoise = (rand() - 0.5) * 2;
    const dailyRet = QuantFactorEngine.synthesizeDailyTarget(factors, macroRet, null, randomNoise);
    const prevC = item.history[item.history.length - 1].close;
    const newC = Math.max(1, prevC * (1 + dailyRet));
    item.history.push({ open: prevC, close: newC, high: Math.max(prevC, newC) * 1.01, low: Math.min(prevC, newC) * 0.99, vol: 50000 });

    if (newC > prevC) {
      item.upDays++;
      item.curUpStreak++;
      item.curDownStreak = 0;
      item.maxUpStreak = Math.max(item.maxUpStreak, item.curUpStreak);
    } else if (newC < prevC) {
      item.downDays++;
      item.curDownStreak++;
      item.curUpStreak = 0;
      item.maxDownStreak = Math.max(item.maxDownStreak, item.curDownStreak);
    }
  }
}

console.log("\n  全市场股票 30 日走势统计结果：");
let anyRunaway = false;
marketSim.forEach(m => {
  const upPct = (m.upDays / 30 * 100).toFixed(0);
  console.log(`  [${m.stock.name.padEnd(6, '　')}] 上涨: ${m.upDays}天 (${upPct}%), 最大连涨: ${m.maxUpStreak}天, 最大连跌: ${m.maxDownStreak}天`);
  // 断言：绝不能出现 30 天都在涨或 30 天都在跌的单边永动机
  if (m.maxUpStreak >= 10 || m.maxDownStreak >= 10 || m.upDays === 30 || m.upDays === 0) {
    anyRunaway = true;
  }
  assert.ok(m.maxUpStreak < 10, `${m.stock.name} 连涨天数不能达到 10 天`);
  assert.ok(m.maxDownStreak < 10, `${m.stock.name} 连跌天数不能达到 10 天`);
  assert.ok(m.upDays >= 5 && m.upDays <= 25, `${m.stock.name} 上涨天数必须在合理波动区间 (5~25天)`);
});

assert.strictEqual(anyRunaway, false, "没有任何股票出现持续单边走势");
console.log("✓ 30日模拟全市场验证：彻底消除单边永动机，全部呈现健康的波段震荡与高低轮动！");
console.log("=== 专项测试全部通过！===");
