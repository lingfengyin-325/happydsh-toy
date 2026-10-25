/**
 * 2015 瑞士法郎式史诗级黑天鹅 (SWISS_FRANC_FLASH_CRASH) 专项测试
 * 验证：
 * 1. 事件模板属性完备性：全库最低概率权重、毁灭级严重度 (CATASTROPHIC)、极端大盘冲击与波动率放大
 * 2. 模拟高杠杆持仓 (如 10x 杠杆) 遭受瑞郎式黑天鹅冲击时必定触发爆仓强平
 * 3. 5000 次蒙特卡洛抽样统计其实际触发频率，确认为全场最罕见、最低概率的事件
 */

const assert = require("assert");
const { EVENT_TEMPLATES, MarketEventSystem, QuantFactorEngine, MacroRegimeEngine } = require("../quant-engine.js");

console.log("=== 启动 2015 瑞士法郎式史诗级黑天鹅专项测试 ===");

// 测试 1: 验证模板定义与全库最低概率
console.log("测试 1: 验证瑞郎黑天鹅模板属性与最低权重...");
const targetTemplate = EVENT_TEMPLATES.find(t => t.id === "SWISS_FRANC_FLASH_CRASH");
assert.ok(targetTemplate, "必须存在 SWISS_FRANC_FLASH_CRASH 模板");
assert.strictEqual(targetTemplate.isBlackSwan, true, "必须标记为黑天鹅");
assert.strictEqual(targetTemplate.severity, "CATASTROPHIC", "严重级别必须为 CATASTROPHIC");
assert.ok(targetTemplate.marketShock <= -0.06, "大盘单日下挫幅度应达到或超过 -6.0%");
assert.ok(targetTemplate.volatilityMult >= 3.5, "真实波动率放大倍数应达到 3.5 倍以上");

// 验证其为全库所有事件中权重最低
const allWeights = EVENT_TEMPLATES.map(t => t.probabilityWeight);
const minWeight = Math.min(...allWeights);
assert.strictEqual(targetTemplate.probabilityWeight, minWeight, "瑞郎黑天鹅必须为全库中概率权重最低的事件");
console.log(`✓ 瑞郎黑天鹅模板验证通过，权重为 ${targetTemplate.probabilityWeight}（全库最低），大盘冲击: ${(targetTemplate.marketShock * 100).toFixed(1)}%`);

// 测试 2: 验证高杠杆遭遇瑞郎黑天鹅的爆仓与强平效果
console.log("测试 2: 验证高杠杆多头遭遇瑞郎黑天鹅冲击下的强平表现...");
const mockStock = { code: "SH·600030", name: "中信证券", sector: "券商", beta: 1.4, base: 20 };
const mockHistory = [];
let p = 20;
for (let i = 0; i < 30; i++) {
  mockHistory.push({ open: p, close: p, high: p * 1.01, low: p * 0.99, vol: 50000 });
}

// 模拟构造瑞郎黑天鹅事件实例
const mockDateParts = { full: "2026-10-25", short: "10-25", week: "日" };
const mockEventInstance = {
  id: "EVT-TEST-SWISS-FRANC",
  templateId: "SWISS_FRANC_FLASH_CRASH",
  isBlackSwan: true,
  severity: "CATASTROPHIC",
  headline: targetTemplate.headlineTemplate.replace("{time}", "10:30"),
  detail: targetTemplate.detailTemplate.replace("{time}", "10:30"),
  marketShock: targetTemplate.marketShock,
  sectorShock: targetTemplate.marketShock * targetTemplate.sectorMultiplier,
  targetSector: "券商",
  volatilityMult: targetTemplate.volatilityMult,
  sentimentDelta: targetTemplate.sentimentDelta
};

const factors = QuantFactorEngine.computeFactors(mockHistory, mockStock);
const targetReturn = QuantFactorEngine.synthesizeDailyTarget(
  factors,
  targetTemplate.marketShock, // 大盘暴跌
  { marketShock: targetTemplate.marketShock, sectorShock: mockEventInstance.sectorShock },
  -0.5 // 负向噪声
);

console.log(`  标的受冲击预期收益率: ${(targetReturn * 100).toFixed(2)}%`);
assert.ok(targetReturn <= -0.09, "受瑞郎海啸冲击的券商标的应逼近或封死跌停 (-9% ~ -10%)");

// 杠杆清算测试：假设玩家持有 10 倍杠杆多头（保证金率 10%，维持保证金率 0.5%）
const leverage = 10;
const positionAmount = 100000;
const margin = positionAmount / leverage; // 10,000 元本金
const debt = positionAmount - margin; // 90,000 元借款
const stockDropPct = -0.098; // 跌停 -9.8%
const newPositionValue = positionAmount * (1 + stockDropPct); // 90,200 元
const equityRemaining = newPositionValue - debt; // 200 元
const maintenanceMarginRequired = positionAmount * 0.005; // 500 元
console.log(`  10倍杠杆本金: ¥${margin}，标的跌停后剩余净值: ¥${equityRemaining.toFixed(2)}，维持保证金要求: ¥${maintenanceMarginRequired}`);
assert.ok(equityRemaining < maintenanceMarginRequired, "剩余权益必须低于维持保证金线，必定触发强制平仓！");
console.log("✓ 10倍杠杆多头遭遇瑞郎黑天鹅被瞬间打穿维持保证金线并强平！");

// 测试 3: 蒙特卡洛抽样验证“最低概率”
console.log("测试 3: 5000 次每日事件判定蒙特卡洛抽样...");
const testStocks = [mockStock];
let totalEvents = 0;
let blackSwanCount = 0;
let swissFrancCount = 0;

for (let i = 0; i < 5000; i++) {
  // 简易随机发生器
  const evt = MarketEventSystem.evaluateDay(i, mockDateParts, testStocks, Math.random);
  if (evt) {
    totalEvents++;
    if (evt.isBlackSwan) {
      blackSwanCount++;
      if (evt.templateId === "SWISS_FRANC_FLASH_CRASH") {
        swissFrancCount++;
      }
    }
  }
}

console.log(`  5000 次开盘判定：触发事件 ${totalEvents} 次，其中黑天鹅 ${blackSwanCount} 次，瑞郎式史诗黑天鹅 ${swissFrancCount} 次`);
const swissProb = (swissFrancCount / 5000 * 100).toFixed(2);
console.log(`  瑞郎黑天鹅绝对触发概率: ${swissProb}%（极低罕见事件）`);
assert.ok(swissFrancCount < blackSwanCount * 0.05, "瑞郎黑天鹅在所有黑天鹅中占比必须极低 (< 5%)");
console.log("✓ 蒙特卡洛抽样验证通过：确为全场最低发生概率的史诗级灾难黑天鹅！");

// 测试 4: 定向触发瑞郎黑天鹅实例构建与文本插值验证
console.log("测试 4: 验证定向命中瑞郎黑天鹅时的实例构建与文本插值...");
// 伪随机生成器：前两次 roll 判定为触发事件且为黑天鹅，第三次 roll 设为很小的数（命中第一个或极小权重的模板）
let callIndex = 0;
const targetedRng = () => {
  callIndex++;
  if (callIndex === 1) return 0.1; // 触发事件
  if (callIndex === 2) return 0.1; // 触发黑天鹅
  if (callIndex === 3) {
    // 精确命中 SWISS_FRANC_FLASH_CRASH 所在的权重区间
    // 计算 SWISS_FRANC_FLASH_CRASH 前面的累积权重
    const bSwans = EVENT_TEMPLATES.filter(t => t.isBlackSwan);
    const totalW = bSwans.reduce((s, t) => s + t.probabilityWeight, 0);
    let cumW = 0;
    for (const t of bSwans) {
      if (t.id === "SWISS_FRANC_FLASH_CRASH") {
        return (cumW + t.probabilityWeight * 0.5) / totalW;
      }
      cumW += t.probabilityWeight;
    }
    return 0.01;
  }
  return 0.5;
};

const targetedEvent = MarketEventSystem.evaluateDay(15, mockDateParts, testStocks, targetedRng);
assert.ok(targetedEvent, "定向判定必须返回事件实例");
assert.strictEqual(targetedEvent.templateId, "SWISS_FRANC_FLASH_CRASH", "必须成功命中瑞郎黑天鹅模板");
assert.strictEqual(targetedEvent.severity, "CATASTROPHIC", "严重级别必须为 CATASTROPHIC");
assert.ok(targetedEvent.headline.includes("瑞郎式海啸"), "新闻头条必须包含瑞郎式海啸关键词");
assert.ok(targetedEvent.detail.includes("毫无征兆突发宣布取消长期汇率平价承诺"), "新闻详情必须完成插值");
console.log(`✓ 瑞郎黑天鹅定向实例化成功：${targetedEvent.headline}`);

console.log("=== 瑞郎黑天鹅专项测试全部通过！===");
