/**
 * 浮沉 · 量化多因子引擎与A股特色大盘控盘机制
 * 
 * 架构包含：
 * 1. 经典量化多因子特征计算（Qlib / Barra / WorldQuant Alpha101）
 *    - 动量因子 (Momentum 5/10/20日收益率与均线排列)
 *    - 均值回归反转因子 (Reversal 20日BIAS乖离率与超买超卖)
 *    - 流动性与量价动量因子 (Volume Ratio 量比与量价背离)
 *    - 真实波幅风险因子 (ATR10 归一化波动率)
 *    - 宏观大盘 Beta 传导
 * 2. 独立大盘机制与A股典型人为控盘状态机 (MacroRegimeEngine)
 *    - 四大核心势力（国家队、北向外资、百亿量化、游资敢死队）博弈
 *    - A股典型控盘剧本：国家队尾盘暴力托底、早盘诱多午后砸盘、重大利好高开低走、
 *      量化DMA平仓踩踏、游资题材点火、重要会议窗口窄幅维稳
 *    - 连续下跌/破位时的逆周期国家队救市干预逻辑
 * 3. 开盘事件判定与日内精确时间计算 (MarketEventSystem)
 *    - 12 套结构化事件模板（黑天鹅、重磅政策、主力突袭、外资撤离、监管雷霆等）
 *    - 根据模拟股市时间、涉事势力与个股板块动态插值生成新闻快讯
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.QuantEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

  // 1. 市场核心四大主力势力
  const FACTIONS = {
    NATIONAL_TEAM: {
      id: "NATIONAL_TEAM",
      name: "国家级平准基金 (中央汇金/证金联合体)",
      shortName: "国家队",
      style: "逆周期托底维稳 · 拉抬权重金融 · 压制非理性过热",
      preferredSectors: ["银行", "水电", "保险", "工程机械"],
      marketWeight: 0.35,
      bias: "STABILIZE"
    },
    FOREIGN_CAPITAL: {
      id: "FOREIGN_CAPITAL",
      name: "北向外资代表摩根联盟 (跨国对冲基金)",
      shortName: "北向外资",
      style: "宏观利率敏感 · 核心资产抱团 · 地缘避险流动",
      preferredSectors: ["白酒", "动力电池", "旅游零售", "创新药"],
      marketWeight: 0.25,
      bias: "MACRO"
    },
    QUANT_CONSORTIUM: {
      id: "QUANT_CONSORTIUM",
      name: "头部百亿量化高频阵营 (DMA多空联盟)",
      shortName: "量化多空",
      style: "统计套利 · 算法拆单出货 · 杠杆平仓踩踏 · 助涨助跌",
      preferredSectors: ["券商", "半导体", "面板", "光伏"],
      marketWeight: 0.22,
      bias: "ALGORITHMIC"
    },
    HOT_MONEY: {
      id: "HOT_MONEY",
      name: "江浙顶级游资敢死队 (六一中路等知名席位)",
      shortName: "游资作手",
      style: "题材点火 · 连板炒作 · 情绪共振 · 次日核按钮",
      preferredSectors: ["商业航天", "新能源汽车", "半导体", "面板"],
      marketWeight: 0.18,
      bias: "MOMENTUM"
    }
  };

  // 2. 经典量化多因子计算模块 (参照 Qlib Alpha158 与 Barra CNE6)
  const QuantFactorEngine = {
    /**
     * 计算单只股票的多维度量化因子
     * @param {Array} history K线历史数据 [{open, close, high, low, vol}, ...]
     * @param {Object} stockInfo 股票基础信息 {code, name, sector, beta, vol}
     * @param {Object} options 附加参数
     */
    computeFactors(history, stockInfo, options = {}) {
      const len = history ? history.length : 0;
      if (len < 5) {
        return {
          momentum5: 0,
          momentum10: 0,
          momentum20: 0,
          maCrossScore: 0,
          bias20: 0,
          volumeRatio: 1.0,
          atr10Normalized: 2.0,
          beta: stockInfo.beta || 1.0,
          compositeScore: 0
        };
      }

      const latest = history[len - 1];
      const prevClose = latest.close;

      // 因子1: 动量因子 (Momentum / ROC - 参照 Qlib ROC5, ROC10, ROC20)
      const c5 = history[Math.max(0, len - 5)].close;
      const c10 = history[Math.max(0, len - 10)].close;
      const c20 = history[Math.max(0, len - 20)].close;
      const momentum5 = c5 > 0 ? (prevClose - c5) / c5 : 0;
      const momentum10 = c10 > 0 ? (prevClose - c10) / c10 : 0;
      const momentum20 = c20 > 0 ? (prevClose - c20) / c20 : 0;

      // 均线多头/空头排列因子 (MA排列)
      const ma5 = this.calculateSMA(history, 5);
      const ma10 = this.calculateSMA(history, 10);
      const ma20 = this.calculateSMA(history, 20);
      let maCrossScore = 0;
      if (ma5 > ma10 && ma10 > ma20) maCrossScore = 1.0; // 黄金多头排列
      else if (ma5 < ma10 && ma10 < ma20) maCrossScore = -1.0; // 死亡空头排列
      else if (ma5 > ma20) maCrossScore = 0.4;
      else maCrossScore = -0.4;

      // 因子2: 均值回归反转因子 (Reversal / 20日BIAS乖离率)
      const bias20 = ma20 > 0 ? (prevClose - ma20) / ma20 : 0;

      // 因子3: 量比异动因子 (Volume Spike / Volume Ratio)
      const avgVol5 = this.calculateAvgVolume(history, 5);
      const volumeRatio = avgVol5 > 0 ? latest.vol / avgVol5 : 1.0;

      // 因子4: 真实波幅与波动率因子 (ATR10 Normalized)
      const atr10 = this.calculateATR(history, 10);
      const atr10Normalized = prevClose > 0 ? (atr10 / prevClose) * 100 : 2.0;

      // 因子5: Beta 与弹性暴露
      const beta = stockInfo.beta != null ? stockInfo.beta : (stockInfo.vol || 1.0);

      // 合成 Alpha 综合评分:
      // 动量项: 顺势推动
      const momentumAlpha = momentum5 * 1.6 + momentum10 * 0.8 + maCrossScore * 0.02;

      // 均值回归反转项: 当短期涨幅或跌幅偏离均线过远时，产生强大的理性纠偏拉力
      let reversalAlpha = 0;
      if (bias20 > 0.06) {
        reversalAlpha = - (bias20 - 0.06) * 1.5; // 超买回踩压力
      } else if (bias20 < -0.06) {
        reversalAlpha = (-bias20 - 0.06) * 1.3; // 超跌估值修复动力
      }

      // 量价背离修正:
      let volumeAlpha = 0;
      if (momentum5 > 0.04 && volumeRatio < 0.75) {
        volumeAlpha = -0.012; // 缩量上涨易衰竭
      } else if (momentum5 > 0.03 && volumeRatio > 1.4) {
        volumeAlpha = 0.010; // 放量突破，趋势延续
      } else if (momentum5 < -0.04 && volumeRatio > 1.6) {
        volumeAlpha = 0.008; // 恐慌盘涌出，短线见底信号
      }

      const compositeScore = momentumAlpha * 0.45 + reversalAlpha * 0.40 + volumeAlpha;

      return {
        momentum5: round2(momentum5 * 100),
        momentum10: round2(momentum10 * 100),
        momentum20: round2(momentum20 * 100),
        maCrossScore,
        bias20: round2(bias20 * 100),
        volumeRatio: round2(volumeRatio),
        atr10Normalized: round2(atr10Normalized),
        beta,
        compositeScore
      };
    },

    calculateSMA(history, period) {
      const len = history.length;
      if (len === 0) return 0;
      const count = Math.min(len, period);
      let sum = 0;
      for (let i = len - count; i < len; i++) sum += history[i].close;
      return sum / count;
    },

    calculateAvgVolume(history, period) {
      const len = history.length;
      if (len === 0) return 0;
      const count = Math.min(len, period);
      let sum = 0;
      for (let i = len - count; i < len; i++) sum += history[i].vol;
      return sum / count;
    },

    calculateATR(history, period) {
      const len = history.length;
      if (len < 2) return history[0] ? (history[0].high - history[0].low) : 1;
      const count = Math.min(len - 1, period);
      let trSum = 0;
      for (let i = len - count; i < len; i++) {
        const cur = history[i];
        const prev = history[i - 1];
        const tr = Math.max(
          cur.high - cur.low,
          Math.abs(cur.high - prev.close),
          Math.abs(cur.low - prev.close)
        );
        trSum += tr;
      }
      return trSum / count;
    },

    /**
     * 基于量化因子与大盘宏观收益合成单日预期收益与波动空间
     */
    synthesizeDailyTarget(factors, benchmarkReturn, eventImpact = null, randomVal = 0) {
      // 1. Beta 传导大盘走势
      const betaContribution = benchmarkReturn * factors.beta * 0.85;

      // 2. 特质 Alpha 贡献 (动量、均值回归、量价)
      const alphaContribution = clamp(factors.compositeScore * 0.45, -0.065, 0.065);

      // 3. 事件冲击
      let eventContribution = 0;
      if (eventImpact) {
        eventContribution += (eventImpact.marketShock || 0) * (factors.beta * 0.55);
        if (eventImpact.sectorShock) {
          eventContribution += eventImpact.sectorShock;
        }
      }

      // 4. 波动率噪声 (由 ATR 真实波幅决定日内震荡空间)
      const noiseAmp = Math.max(0.006, (factors.atr10Normalized / 100) * 0.25);
      const noise = randomVal * noiseAmp;

      const target = betaContribution + alphaContribution + eventContribution + noise;
      return clamp(target, -0.095, 0.095);
    }
  };

  // 3. A股典型人为控盘剧本与大盘机制 (MacroRegimeEngine)
  const MacroRegimeEngine = {
    /**
     * 初始化大盘宏观状态
     */
    createState(baseSeed = Date.now()) {
      return {
        seed: baseSeed,
        day: 0,
        indexLevel: 3000.0,
        benchmarkLevel: 3000.0,
        indexHistory: [3000.0],
        benchmarkHistory: [3000.0],
        consecutiveDownDays: 0,
        consecutiveUpDays: 0,
        marketSentiment: 52, // 0 极度恐慌 - 100 极度贪婪
        regimeState: "OSCILLATING", // OSCILLATING, BULL_RUN, BEAR_CRASH, GOV_STABILIZE, HIGH_VOL
        activeScript: "NORMAL", // NORMAL, NATIONAL_TEAM_BUY, MORNING_PUMP_AFTERNOON_DUMP, etc.
        dailyScriptMeta: null,
        factions: {
          NATIONAL_TEAM: { netFlow: 0, stance: "WATCHING" },
          FOREIGN_CAPITAL: { netFlow: 0, stance: "BALANCED" },
          QUANT_CONSORTIUM: { netFlow: 0, stance: "ACTIVE" },
          HOT_MONEY: { netFlow: 0, stance: "SELECTIVE" }
        }
      };
    },

    /**
     * 每日开盘前判定大盘宏观演化与人为控盘剧本
     * @param {Object} state 宏观状态
     * @param {Function} rng 伪随机函数
     * @param {Object} eventInstance 今日开盘判定事件（如有）
     */
    stepMacro(state, rng, eventInstance = null) {
      state.day++;
      const rand = rng || Math.random;

      // 1. 监测指数关键防线与连跌天数
      const prevLevel = state.indexLevel;
      const isSub3000 = prevLevel < 2980; // 跌破3000点整数心理关口
      const panicLevel = state.consecutiveDownDays >= 3 || state.marketSentiment < 32;

      // 2. 判定 A 股特色人为控盘剧本 (Institutional Market-Making Script)
      let script = "NORMAL";
      let scriptMeta = null;

      if (eventInstance && eventInstance.isBlackSwan) {
        script = "BLACK_SWAN_PANIC";
        scriptMeta = {
          name: "黑天鹅极端冲击",
          desc: "突发系统性黑天鹅事件，量化与恐慌盘集中释放，全天多空激烈博弈",
          intradayBias: "DUMP"
        };
      } else if (panicLevel || (isSub3000 && rand() < 0.65)) {
        // A股经典控盘 1: 【国家队尾盘暴力托底护盘】
        // 当连续大跌或破位时，中央平准基金突发挂出巨额买单扫货四大行与沪深300 ETF，拉权重护盘
        script = "NATIONAL_TEAM_BUY";
        scriptMeta = {
          name: "国家队尾盘救市托底",
          desc: "汇金与证金神秘资金进场，尾盘集中拉抬大金融与中特估，分时走出绝地反击红V",
          intradayBias: "AFTERNOON_SURGE"
        };
      } else if (state.consecutiveUpDays >= 3 && rand() < 0.45) {
        // A股经典控盘 2: 【早盘诱多，午后砸盘出货】
        // 连续反弹后主力资金早盘拉高吸引散户追高接盘，午后反手跳水出货
        script = "MORNING_PUMP_AFTERNOON_DUMP";
        scriptMeta = {
          name: "早盘诱多 · 午后砸盘出货",
          desc: "主力早盘急拉制造踏空恐慌，午后大单反手无情离场，留下一地冲高回落长上影",
          intradayBias: "PUMP_AND_DUMP"
        };
      } else if (rand() < 0.16) {
        // A股经典控盘 3: 【重大利好高开低走（利好出尽是利空）】
        script = "GOOD_NEWS_GAP_AND_FADE";
        scriptMeta = {
          name: "利好高开低走 · 获利盘抢跑",
          desc: "隔夜消息刺激早盘大幅跳空高开，但场内潜伏盘获利了结引发踩踏，逐级回落收阴",
          intradayBias: "GAP_AND_FADE"
        };
      } else if (rand() < 0.15) {
        // A股经典控盘 4: 【权重掩护 · 二八分化（赚指数不赚钱）】
        script = "INDEX_UP_STOCKS_DOWN";
        scriptMeta = {
          name: "权重护盘 · 题材失血二八分化",
          desc: "主力单拉大盘中字头维持指数红盘，但题材小盘股大面积飘绿失血，盘面极度分化",
          intradayBias: "DIVERGENCE"
        };
      } else if (rand() < 0.12) {
        // A股经典控盘 5: 【重要会议窗口维稳（窄幅心电图控盘）】
        script = "WINDOW_STABILITY";
        scriptMeta = {
          name: "关键窗口维稳 · 窄幅心电图",
          desc: "大资金严丝合缝进行对敲控盘，大盘全天振幅极低，指数被精准定在窄幅区间",
          intradayBias: "TIGHT_FLAT"
        };
      } else {
        script = "NORMAL";
        scriptMeta = {
          name: "常态博弈",
          desc: "各大势力资金处于常规量化平衡博弈，多因子客观演化",
          intradayBias: "NEUTRAL"
        };
      }

      state.activeScript = script;
      state.dailyScriptMeta = scriptMeta;

      // 3. 计算今日大盘基准收益率 (由控盘剧本与宏观事件共同主导)
      let baseMacroReturn = 0;

      switch (script) {
        case "NATIONAL_TEAM_BUY":
          // 国家队发力：拉抬大盘 +0.8% ~ +2.4%
          baseMacroReturn = 0.008 + rand() * 0.016;
          state.factions.NATIONAL_TEAM.netFlow = 80 + rand() * 120; // 净买入80-200亿
          state.factions.NATIONAL_TEAM.stance = "AGGRESSIVE_BUY";
          state.marketSentiment = clamp(state.marketSentiment + 12, 10, 90);
          break;

        case "MORNING_PUMP_AFTERNOON_DUMP":
          // 诱多出货：收盘微跌或明显回落 -0.6% ~ -1.8%
          baseMacroReturn = -(0.006 + rand() * 0.012);
          state.factions.QUANT_CONSORTIUM.netFlow = -(50 + rand() * 60);
          state.factions.HOT_MONEY.netFlow = -(30 + rand() * 40);
          state.marketSentiment = clamp(state.marketSentiment - 8, 10, 90);
          break;

        case "GOOD_NEWS_GAP_AND_FADE":
          // 高开低走：收盘小幅翻绿或微涨 -0.8% ~ +0.3%
          baseMacroReturn = (rand() - 0.7) * 0.014;
          state.factions.FOREIGN_CAPITAL.netFlow = -(20 + rand() * 50);
          state.marketSentiment = clamp(state.marketSentiment - 6, 10, 90);
          break;

        case "INDEX_UP_STOCKS_DOWN":
          // 指数微涨 +0.3% ~ +0.9%，掩护小盘股
          baseMacroReturn = 0.003 + rand() * 0.006;
          state.factions.NATIONAL_TEAM.netFlow = 40 + rand() * 60;
          break;

        case "WINDOW_STABILITY":
          // 心电图极致窄幅震荡 -0.15% ~ +0.15%
          baseMacroReturn = (rand() - 0.5) * 0.003;
          break;

        case "BLACK_SWAN_PANIC":
          // 黑天鹅极端冲击
          baseMacroReturn = (eventInstance.marketShock || -0.025) * (0.85 + rand() * 0.3);
          state.marketSentiment = clamp(state.marketSentiment - 25, 10, 90);
          break;

        default:
          // 常态随机漂移与情绪均值回归
          const sentimentDrift = ((state.marketSentiment - 50) / 100) * 0.003;
          baseMacroReturn = sentimentDrift + (rand() - 0.5) * 0.011;
          state.marketSentiment += (rand() - 0.5) * 8 - (state.marketSentiment - 50) * 0.06;
          break;
      }

      // 4. 叠加事件的大盘直接冲击（若有普通重大事件）
      if (eventInstance && !eventInstance.isBlackSwan) {
        baseMacroReturn += (eventInstance.marketShock || 0) * (0.8 + rand() * 0.4);
        state.marketSentiment = clamp(state.marketSentiment + (eventInstance.sentimentDelta || 0), 10, 90);
      }

      baseMacroReturn = clamp(baseMacroReturn, -0.048, 0.048);

      // 5. 更新大盘指数与连涨连跌统计
      const newIndexLevel = round2(Math.max(1200, prevLevel * (1 + baseMacroReturn)));
      state.indexLevel = newIndexLevel;
      state.benchmarkLevel = newIndexLevel;
      state.indexHistory.push(newIndexLevel);
      state.benchmarkHistory.push(newIndexLevel);

      if (baseMacroReturn < -0.002) {
        state.consecutiveDownDays++;
        state.consecutiveUpDays = 0;
      } else if (baseMacroReturn > 0.002) {
        state.consecutiveUpDays++;
        state.consecutiveDownDays = 0;
      } else {
        // 平盘轻微衰减
        state.consecutiveDownDays = Math.max(0, state.consecutiveDownDays - 1);
        state.consecutiveUpDays = Math.max(0, state.consecutiveUpDays - 1);
      }

      // 6. 更新周期状态
      if (state.consecutiveDownDays >= 3 || state.indexLevel < 2800) state.regimeState = "BEAR_CRASH";
      else if (state.consecutiveUpDays >= 3 || state.indexLevel > 3400) state.regimeState = "BULL_RUN";
      else if (script === "NATIONAL_TEAM_BUY" || script === "WINDOW_STABILITY") state.regimeState = "GOV_STABILIZE";
      else state.regimeState = "OSCILLATING";

      return baseMacroReturn;
    }
  };

  // 4. 12个A股特色与黑天鹅事件模板库
  const EVENT_TEMPLATES = [
    {
      id: "DMA_UNWIND_PANIC",
      name: "头部量化DMA爆仓踩踏",
      isBlackSwan: true,
      category: "BLACK_SWAN",
      severity: "CRITICAL",
      faction: FACTIONS.QUANT_CONSORTIUM,
      probabilityWeight: 8,
      triggerTimeWindow: { startHour: 9, startMin: 32, endHour: 9, endMin: 50 },
      timeDesc: "早盘 09:35",
      headlineTemplate: "【黑天鹅·流动性踩踏】头部量化联盟DMA多空杠杆触发平仓预警，小盘微盘股现无差别抛售",
      detailTemplate: "{time}，{faction}旗下多只高杠杆中性对冲策略遭遇净值下穿强平线，诱发程序化算法连续市价砸盘。全市场流动性瞬间收紧，{sector}板块首当其冲，大盘承压深挫。",
      marketShock: -0.024,
      sectorMultiplier: 1.6,
      volatilityMult: 1.85,
      targetSector: "半导体",
      sentimentDelta: -28
    },
    {
      id: "GEOPOLITICAL_SANCTIONS",
      name: "突发地缘海啸与贸易限令",
      isBlackSwan: true,
      category: "BLACK_SWAN",
      severity: "CRITICAL",
      faction: FACTIONS.FOREIGN_CAPITAL,
      probabilityWeight: 7,
      triggerTimeWindow: { startHour: 13, startMin: 5, endHour: 13, endMin: 30 },
      timeDesc: "午后 13:08",
      headlineTemplate: "【黑天鹅·突发地缘风暴】外围突发扩大科技与贸易管制清单，北向资金大举挂单撤退",
      detailTemplate: "{time}，海外突发针对我国高端技术供应链的限制声明。{faction}启动紧急避险风控模型，单边净流出逾百亿元，{sector}板块龙头{primaryStock}剧烈下探。",
      marketShock: -0.028,
      sectorMultiplier: 2.1,
      volatilityMult: 2.0,
      targetSector: "半导体",
      sentimentDelta: -32
    },
    {
      id: "AUDIT_SCANDAL_DISASTER",
      name: "行业巨头审计爆雷与巨额计提",
      isBlackSwan: true,
      category: "BLACK_SWAN",
      severity: "CRITICAL",
      faction: FACTIONS.QUANT_CONSORTIUM,
      probabilityWeight: 6,
      triggerTimeWindow: { startHour: 9, startMin: 16, endHour: 9, endMin: 28 },
      timeDesc: "集合竞价 09:18",
      headlineTemplate: "【黑天鹅·财报暴雷】{primaryStock}遭年审会计所出具保留意见，爆出百亿海外坏账计提",
      detailTemplate: "{time}集合竞价阶段，{primaryStock}突发重磅利空核弹，财报疑云引发恐慌性封死跌停，带动{sector}产业链全线暴跌，市场信任度遭遇严峻冲击。",
      marketShock: -0.015,
      sectorMultiplier: 2.5,
      volatilityMult: 1.6,
      targetSector: "地产",
      sentimentDelta: -22
    },
    {
      id: "POWER_GRID_OUTAGE",
      name: "超算中心与电网突发断电灾害",
      isBlackSwan: true,
      category: "BLACK_SWAN",
      severity: "HIGH",
      faction: FACTIONS.HOT_MONEY,
      probabilityWeight: 5,
      triggerTimeWindow: { startHour: 13, startMin: 35, endHour: 14, endMin: 10 },
      timeDesc: "午后 13:42",
      headlineTemplate: "【黑天鹅·超级断电事故】区域主干电网与国家智算集群突发熔断故障，高耗能高科技产线停摆",
      detailTemplate: "{time}，突发极端外力导致某智算核心枢纽断电，多家先进制造企业生产被迫中断。{sector}板块急速下挫，而绿色电力与公用事业避险资金反向涌入。",
      marketShock: -0.012,
      sectorMultiplier: 1.9,
      volatilityMult: 1.5,
      targetSector: "面板",
      sentimentDelta: -16
    },
    {
      id: "SHORT_SELLER_REPORT",
      name: "海外激进做空机构突袭狙击",
      isBlackSwan: true,
      category: "BLACK_SWAN",
      severity: "HIGH",
      faction: FACTIONS.FOREIGN_CAPITAL,
      probabilityWeight: 6,
      triggerTimeWindow: { startHour: 10, startMin: 35, endHour: 11, endMin: 15 },
      timeDesc: "盘中 10:48",
      headlineTemplate: "【黑天鹅·做空狙击】国际沽空机构突发发布百页详实做空指控，剑指{primaryStock}造假",
      detailTemplate: "{time}，香橼与浑水联合发表针对国内白马龙头的做空研报，直指收入确认虚增。多空博弈白热化，{sector}板块成交量瞬间破百亿，多头防线频频告急。",
      marketShock: -0.016,
      sectorMultiplier: 2.2,
      volatilityMult: 1.75,
      targetSector: "创新药",
      sentimentDelta: -20
    },
    {
      id: "ANTITRUST_PENALTY",
      name: "反垄断与合规治理天价罚单",
      isBlackSwan: true,
      category: "BLACK_SWAN",
      severity: "HIGH",
      faction: FACTIONS.NATIONAL_TEAM,
      probabilityWeight: 5,
      triggerTimeWindow: { startHour: 14, startMin: 25, endHour: 14, endMin: 55 },
      timeDesc: "尾盘 14:38",
      headlineTemplate: "【黑天鹅·反垄断天价处罚】市监部门对行业平台龙头开出百亿巨额合规整改罚单",
      detailTemplate: "{time}，尾盘重磅执法公报出炉，直指某行业平台巨头滥用市场支配地位并要求拆分部分壁垒业务。龙头股尾盘直线下挫，拖累大盘指数失守关键支撑点位。",
      marketShock: -0.018,
      sectorMultiplier: 2.0,
      volatilityMult: 1.6,
      targetSector: "面板",
      sentimentDelta: -22
    },
    {
      id: "NATIONAL_TEAM_INTERVENTION",
      name: "国家级平准基金千亿托底救市",
      isBlackSwan: false,
      category: "POLICY",
      severity: "HIGH",
      faction: FACTIONS.NATIONAL_TEAM,
      probabilityWeight: 14,
      triggerTimeWindow: { startHour: 14, startMin: 10, endHour: 14, endMin: 40 },
      timeDesc: "尾盘 14:18",
      headlineTemplate: "【宏观·降维托底】国家平准资金天量扫货多只宽基ETF，大金融与权重股垂直脉冲拉升",
      detailTemplate: "{time}，市场急跌之际，{faction}数千手超级托单瞬间现身，{primaryStock}及核心蓝筹放量翻红，强势扭转大盘恐慌盘颓势，大盘分时走出反转金针。",
      marketShock: 0.022,
      sectorMultiplier: 1.5,
      volatilityMult: 1.4,
      targetSector: "银行",
      sentimentDelta: 26
    },
    {
      id: "PBOC_LIQUIDITY_INJECTION",
      name: "央行重磅宣布全面降准降息",
      isBlackSwan: false,
      category: "POLICY",
      severity: "HIGH",
      faction: FACTIONS.NATIONAL_TEAM,
      probabilityWeight: 12,
      triggerTimeWindow: { startHour: 9, startMin: 18, endHour: 9, endMin: 30 },
      timeDesc: "盘前 09:22",
      headlineTemplate: "【宏观·重磅政策利好】央行突发宣布降准0.5个百分点，并设立5000亿元互换便利支持股市",
      detailTemplate: "{time}，金融监督管理部门在盘前联合召开高规格发布会，宣布释放长期流动性超万亿元。市场做多热情全面引爆，券商与核心资产集体大幅高开！",
      marketShock: 0.025,
      sectorMultiplier: 1.4,
      volatilityMult: 1.3,
      targetSector: "券商",
      sentimentDelta: 30
    },
    {
      id: "HOT_MONEY_LIMIT_ATTACK",
      name: "游资敢死队天量对倒点火封板",
      isBlackSwan: false,
      category: "FACTION",
      severity: "MEDIUM",
      faction: FACTIONS.HOT_MONEY,
      probabilityWeight: 15,
      triggerTimeWindow: { startHour: 10, startMin: 10, endHour: 10, endMin: 45 },
      timeDesc: "盘中 10:26",
      headlineTemplate: "【势力·游资突袭】江浙顶级作手联合席位数十亿点火{primaryStock}，百档买单封死涨停",
      detailTemplate: "{time}，{faction}主攻席位在{sector}方向发起凌厉闪击战，分时拉升斜率直逼90度，引爆全市场跟风情绪，短线投机连板热度飙升！",
      marketShock: 0.010,
      sectorMultiplier: 2.8,
      volatilityMult: 1.7,
      targetSector: "商业航天",
      sentimentDelta: 18
    },
    {
      id: "TECH_BREAKTHROUGH_ORDER",
      name: "重大产业技术突破与巨单签署",
      isBlackSwan: false,
      category: "SECTOR",
      severity: "MEDIUM",
      faction: FACTIONS.NATIONAL_TEAM,
      probabilityWeight: 14,
      triggerTimeWindow: { startHour: 10, startMin: 0, endHour: 10, endMin: 30 },
      timeDesc: "早盘 10:05",
      headlineTemplate: "【产业·核心突破】{sector}领域打破国外垄断，{primaryStock}斩获百亿首发商业大单",
      detailTemplate: "{time}，官方科技媒体发布快讯，我国新一代核心技术通过最高规格产业化评审，{primaryStock}签署首批独家供货协议，行业景气周期全面反转。",
      marketShock: 0.012,
      sectorMultiplier: 2.2,
      volatilityMult: 1.35,
      targetSector: "动力电池",
      sentimentDelta: 16
    },
    {
      id: "REGULATORY_CRACKDOWN",
      name: "监管雷霆严打高频量化与转融通",
      isBlackSwan: false,
      category: "REGULATION",
      severity: "HIGH",
      faction: FACTIONS.QUANT_CONSORTIUM,
      probabilityWeight: 10,
      triggerTimeWindow: { startHour: 11, startMin: 15, endHour: 11, endMin: 30 },
      timeDesc: "早盘 11:22",
      headlineTemplate: "【监管·雷霆风暴】监管部门现场严查程序化高频拆单异常交易，宣布限制借券与做空通道",
      detailTemplate: "{time}，证监部门下发紧急风控指导意见，{faction}被要求下调程序化报撤单速率与杠杆倍数。市场量能骤然缩减，高频做市资金紧急收缩敞口。",
      marketShock: -0.011,
      sectorMultiplier: 1.5,
      volatilityMult: 1.45,
      targetSector: "券商",
      sentimentDelta: -14
    },
    {
      id: "FED_HAWKISH_SHOCK",
      name: "美联储超预期强硬鹰派言论冲击",
      isBlackSwan: false,
      category: "MACRO",
      severity: "MEDIUM",
      faction: FACTIONS.FOREIGN_CAPITAL,
      probabilityWeight: 11,
      triggerTimeWindow: { startHour: 9, startMin: 30, endHour: 9, endMin: 45 },
      timeDesc: "开盘 09:31",
      headlineTemplate: "【外围·美联储议息】美联储表态维持长期紧缩高利率，美元狂飙引发亚太外资普遍避险",
      detailTemplate: "{time}，美联储深夜纪要超预期强硬，离岸汇率早盘剧烈波动。{faction}对新兴市场权益仓位被动收缩，重仓股开盘集体遭遇估值承压。",
      marketShock: -0.014,
      sectorMultiplier: 1.3,
      volatilityMult: 1.25,
      targetSector: "白酒",
      sentimentDelta: -15
    }
  ];

  // 5. 开盘大盘事件判定系统 (MarketEventSystem)
  const MarketEventSystem = {
    templates: EVENT_TEMPLATES,

    /**
     * 在开盘时判定是否触发事件、黑天鹅概率与日内触发时间
     */
    evaluateDay(day, dateParts, stockList, rng, macroState = {}) {
      const rand = rng || Math.random;

      // 每日事件触发概率：约 36%
      const EVENT_CHANCE = 0.36;
      const roll = rand();
      if (roll > EVENT_CHANCE) return null;

      // 判定是否黑天鹅 (约占事件总数的 25%，即绝对概率约 9%)
      const isBlackSwan = rand() < 0.25;
      const eligibleTemplates = this.templates.filter(t => t.isBlackSwan === isBlackSwan);
      if (eligibleTemplates.length === 0) return null;

      // 按权重抽取模板
      const totalWeight = eligibleTemplates.reduce((sum, t) => sum + t.probabilityWeight, 0);
      let weightRoll = rand() * totalWeight;
      let selectedTemplate = eligibleTemplates[0];
      for (const t of eligibleTemplates) {
        weightRoll -= t.probabilityWeight;
        if (weightRoll <= 0) {
          selectedTemplate = t;
          break;
        }
      }

      // 计算精准日内触发时间
      const tw = selectedTemplate.triggerTimeWindow;
      const hour = Math.floor(tw.startHour + rand() * (tw.endHour - tw.startHour + 0.99));
      let min;
      if (hour === tw.startHour && hour === tw.endHour) {
        min = Math.floor(tw.startMin + rand() * (tw.endMin - tw.startMin + 1));
      } else if (hour === tw.startHour) {
        min = Math.floor(tw.startMin + rand() * (60 - tw.startMin));
      } else if (hour === tw.endHour) {
        min = Math.floor(rand() * (tw.endMin + 1));
      } else {
        min = Math.floor(rand() * 60);
      }
      const triggerTimeStr = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

      // 寻找受影响的目标板块与股票
      let targetSector = selectedTemplate.targetSector;
      let matchingStocks = stockList.filter(s => s.sector === targetSector);
      if (matchingStocks.length === 0) {
        matchingStocks = stockList;
        targetSector = matchingStocks[0].sector;
      }
      const primaryStock = matchingStocks[Math.floor(rand() * matchingStocks.length)];
      const faction = selectedTemplate.faction;

      // 补齐模板字符串
      const replacements = {
        "{time}": triggerTimeStr,
        "{date}": dateParts.full,
        "{day}": String(day),
        "{faction}": faction.shortName,
        "{factionFull}": faction.name,
        "{sector}": targetSector,
        "{primaryStock}": primaryStock.name,
        "{primaryCode}": primaryStock.code
      };

      let headline = selectedTemplate.headlineTemplate;
      let detail = selectedTemplate.detailTemplate;
      for (const [key, val] of Object.entries(replacements)) {
        headline = headline.split(key).join(val);
        detail = detail.split(key).join(val);
      }

      // 计算对大盘与行业的量化冲击值
      const marketShock = selectedTemplate.marketShock * (0.8 + rand() * 0.4);
      const sectorShock = marketShock * selectedTemplate.sectorMultiplier;

      const eventInstance = {
        id: `EVT-${day}-${Date.now().toString(36)}-${Math.floor(rand() * 1000)}`,
        day,
        date: dateParts.full,
        week: dateParts.week,
        time: triggerTimeStr,
        templateId: selectedTemplate.id,
        isBlackSwan: selectedTemplate.isBlackSwan,
        category: selectedTemplate.category,
        severity: selectedTemplate.severity,
        faction: faction,
        headline,
        detail,
        targetSector,
        primaryStockCode: primaryStock.code,
        primaryStockName: primaryStock.name,
        marketShock: round2(marketShock * 100) / 100,
        sectorShock: round2(sectorShock * 100) / 100,
        volatilityMult: selectedTemplate.volatilityMult,
        sentimentDelta: selectedTemplate.sentimentDelta
      };

      return eventInstance;
    }
  };

  return {
    FACTIONS,
    QuantFactorEngine,
    MacroRegimeEngine,
    MarketEventSystem,
    EVENT_TEMPLATES
  };
});
