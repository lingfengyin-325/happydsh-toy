/**
 * 量化多因子引擎与大盘事件驱动机制测试套件
 */

const assert = require("assert");
const {
  FACTIONS,
  QuantFactorEngine,
  MacroRegimeEngine,
  MarketEventSystem,
  EVENT_TEMPLATES
} = require("../quant-engine.js");

console.log("=== 启动量化交易多因子与大盘机制自动化测试 ===");

// 1. 验证四大势力
console.log("测试 1: 验证四大势力模型定义...");
assert.strictEqual(Object.keys(FACTIONS).length, 4, "必须存在四大势力");
assert.ok(FACTIONS.NATIONAL_TEAM, "必须包含国家队");
assert.ok(FACTIONS.FOREIGN_CAPITAL, "必须包含北向外资");
assert.ok(FACTIONS.QUANT_CONSORTIUM, "必须包含量化高频阵营");
assert.ok(FACTIONS.HOT_MONEY, "必须包含游资敢死队");
for (const [key, f] of Object.entries(FACTIONS)) {
  assert.ok(f.name && f.shortName && f.style && Array.isArray(f.preferredSectors), `${key} 势力配置完整`);
}
console.log("✓ 四大势力模型定义验证通过");

// 2. 验证事件模板数量与结构（要求至少10个）
console.log("测试 2: 验证大盘事件模板库数量与必填项（要求 >= 10 个）...");
assert.ok(EVENT_TEMPLATES.length >= 10, `事件模板库数量必须 >= 10，实际为 ${EVENT_TEMPLATES.length}`);
const blackSwanCount = EVENT_TEMPLATES.filter(t => t.isBlackSwan).length;
assert.ok(blackSwanCount >= 3, `黑天鹅事件模板数量必须 >= 3，实际为 ${blackSwanCount}`);

EVENT_TEMPLATES.forEach((tpl, idx) => {
  assert.ok(tpl.id, `模板 #${idx} 缺少 id`);
  assert.ok(tpl.name, `模板 #${idx} 缺少 name`);
  assert.ok(tpl.headlineTemplate, `模板 #${idx} 缺少 headlineTemplate`);
  assert.ok(tpl.detailTemplate, `模板 #${idx} 缺少 detailTemplate`);
  assert.ok(tpl.triggerTimeWindow, `模板 #${idx} 缺少 triggerTimeWindow`);
  assert.ok(typeof tpl.triggerTimeWindow.startHour === "number", `模板 #${idx} startHour 格式错误`);
  assert.ok(typeof tpl.triggerTimeWindow.endHour === "number", `模板 #${idx} endHour 格式错误`);
  assert.ok(typeof tpl.marketShock === "number", `模板 #${idx} marketShock 必须为数字`);
  assert.ok(typeof tpl.volatilityMult === "number", `模板 #${idx} volatilityMult 必须为数字`);
});
console.log(`✓ 验证通过：共 ${EVENT_TEMPLATES.length} 个事件模板，包含 ${blackSwanCount} 个黑天鹅模板`);

// 3. 验证量化多因子计算
console.log("测试 3: 验证量化因子提取（动量、反转BIAS、真实波幅ATR、量比VR）...");
const mockHistory = [];
let basePrice = 100;
for (let i = 0; i < 30; i++) {
  const close = basePrice * (1 + 0.005 * i); // 持续上涨趋势
  mockHistory.push({
    open: close * 0.99,
    close: close,
    high: close * 1.01,
    low: close * 0.98,
    vol: 50000 + i * 1000
  });
}
const stockMeta = { code: "SZ·300750", name: "宁德时代", sector: "动力电池", beta: 1.2, vol: 1.1 };
const factors = QuantFactorEngine.computeFactors(mockHistory, stockMeta);

assert.ok(typeof factors.momentum5 === "number", "momentum5 必须为数值");
assert.ok(typeof factors.momentum10 === "number", "momentum10 必须为数值");
assert.ok(factors.momentum5 > 0, "持续上涨下 5 日动量应为正");
assert.ok(factors.maCrossScore > 0, "均线多头排列得分应为正");
assert.ok(typeof factors.bias20 === "number", "bias20 乖离率必须存在");
assert.ok(typeof factors.atr10Normalized === "number", "atr10 归一化波幅必须存在");
assert.strictEqual(factors.beta, 1.2, "Beta 因子应正确映射");
console.log("✓ 量化多因子计算正确性验证通过：", factors);

// 4. 验证期望收益与行情走向合成
console.log("测试 4: 验证量化期望收益率走向合成...");
const targetReturn = QuantFactorEngine.synthesizeDailyTarget(factors, 0.01, null, 0.1);
assert.ok(typeof targetReturn === "number", "目标收益必须为数值");
assert.ok(targetReturn >= -0.10 && targetReturn <= 0.10, "收益必须在涨跌停范围内");
console.log("✓ 期望收益率走向合成验证通过，合成目标收益:", (targetReturn * 100).toFixed(2) + "%");

// 5. 验证独立大盘机制 (MacroRegimeEngine)
console.log("测试 5: 验证大盘宏观状态演化与基准推进...");
const macroState = MacroRegimeEngine.createState(12345);
assert.strictEqual(macroState.day, 0, "初始交易日应为 0");
assert.strictEqual(macroState.benchmarkLevel, 3000.0, "基准指数初始应为 3000");

const macroReturn = MacroRegimeEngine.stepMacro(macroState, () => 0.6);
assert.strictEqual(macroState.day, 1, "步进后交易日应为 1");
assert.ok(typeof macroReturn === "number", "大盘收益必须为数值");
assert.ok(macroState.marketSentiment >= 10 && macroState.marketSentiment <= 90, "市场情绪应在合理范围");
console.log("✓ 独立大盘宏观状态演化验证通过");

// 6. 验证开盘事件判定与模板动态插值
console.log("测试 6: 验证开盘事件判定、黑天鹅触发、时间计算及新闻模板动态补齐...");
const testStocks = [
  { code: "SZ·300750", name: "宁德时代", sector: "动力电池", beta: 1.2 },
  { code: "SH·688981", name: "中芯国际", sector: "半导体", beta: 1.3 },
  { code: "SH·600036", name: "招商银行", sector: "银行", beta: 0.6 },
  { code: "SPX·SIM", name: "SpaceX", sector: "商业航天", beta: 1.5 }
];
const dateParts = { full: "2026-10-26", short: "10-26", week: "周一" };

// 多次抽样，验证是否有黑天鹅事件，且模板无任何未填充占位符
let eventCount = 0;
let blackSwanFound = false;
for (let day = 1; day <= 50; day++) {
  // 传入可预测或随机函数测试
  const evt = MarketEventSystem.evaluateDay(day, dateParts, testStocks, Math.random, macroState);
  if (evt) {
    eventCount++;
    if (evt.isBlackSwan) blackSwanFound = true;

    // 检查字段完整性
    assert.ok(evt.id, "事件必须有 id");
    assert.ok(evt.time, "必须有触发时间点");
    assert.ok(/^\d{2}:\d{2}$/.test(evt.time), `触发时间格式必须为 HH:MM，实际为 ${evt.time}`);
    assert.ok(evt.headline, "必须有新闻标题");
    assert.ok(evt.detail, "必须有新闻详情");
    assert.ok(evt.faction, "必须包含对应势力");
    assert.ok(evt.primaryStockName, "必须包含涉事股票");

    // 验证占位符全部被替换，不留残余
    assert.ok(!evt.headline.includes("{time}"), "headline 不应包含未替换的 {time}");
    assert.ok(!evt.headline.includes("{sector}"), "headline 不应包含未替换的 {sector}");
    assert.ok(!evt.headline.includes("{primaryStock}"), "headline 不应包含未替换的 {primaryStock}");
    assert.ok(!evt.detail.includes("{time}"), "detail 不应包含未替换的 {time}");
    assert.ok(!evt.detail.includes("{faction}"), "detail 不应包含未替换的 {faction}");
    assert.ok(!evt.detail.includes("{sector}"), "detail 不应包含未替换的 {sector}");

    // 验证冲击参数
    assert.ok(typeof evt.marketShock === "number", "marketShock 必须为数值");
    assert.ok(typeof evt.sectorShock === "number", "sectorShock 必须为数值");
    assert.ok(evt.volatilityMult >= 1.0, "波动率乘数必须 >= 1.0");
  }
}

assert.ok(eventCount > 0, "50 个交易日抽样中应有事件触发");
assert.ok(blackSwanFound, "50 个交易日抽样中应至少出现一次黑天鹅事件");
console.log(`✓ 50日抽样统计：共触发 ${eventCount} 次重大事件，并成功截获黑天鹅事件！`);
console.log("=== 全部自动化测试用例运行通过！===");
