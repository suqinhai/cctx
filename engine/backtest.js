// engine/backtest.js
// ============================================
// 回测引擎 - 核心模块，负责模拟历史交易并计算收益
// ============================================

// ========== 交易成本常量 ==========
// 手续费率：0.1%（万分之十），A股实际约为万3左右
const COMMISSION = 0.001;

// 滑点率：0%（简化处理，实际交易中会有买卖价差）
// 滑点：实际成交价与预期价格之间的差异
const SLIPPAGE_PCT = 0.000;

/**
 * 回测主函数
 *
 * @param {Array} data - K线数据数组，每个元素包含 {date, open, high, low, close, volume}
 * @param {Class} StrategyClass - 策略类（如 MaAtrStrategy）
 * @param {Object} opts - 配置选项
 * @param {number} opts.initialCash - 初始资金，默认10000
 * @param {Object} opts.strategyConfig - 策略参数配置
 *
 * @returns {Object} 回测结果，包含:
 *   - navs: 每日净值数组 [{date, nav}, ...]
 *   - trades: 成交记录数组
 *   - commissionsPaid: 所有手续费记录
 *   - finalCash: 最终现金余额
 *   - finalPosition: 最终持仓数量
 */
module.exports = function backtest(data, StrategyClass, opts = {}) {
  // ========== 第一步：初始化策略实例 ==========
  // 使用传入的配置参数创建策略对象
  const strategy = new StrategyClass(opts.strategyConfig || {});

  // ========== 第二步：预计算ATR指标 ==========
  // ATR (Average True Range) 平均真实波幅，用于止损和仓位计算
  // 需要提前计算整个序列，因为策略需要在每根K线使用
  const atr = require("../indicators/atr");
  const atrSeries = atr(data, opts.strategyConfig?.atrPeriod || 14);

  // 如果策略支持ATR注入，则设置ATR序列
  // 使用鸭子类型检测：检查策略是否有 setAtrSeries 方法
  if (typeof strategy.setAtrSeries === "function") {
    strategy.setAtrSeries(atrSeries);
  }

  // ========== 第三步：初始化账户状态 ==========
  let cash = opts.initialCash || 10000;  // 可用现金
  let position = 0;                       // 持仓数量（股数/份数）
  let entryPrice = null;                  // 入场价格（用于计算盈亏）
  let entryDate = null;                   // 入场日期
  let stopPrice = null;                   // 止损价格

  // ========== 第四步：初始化记录数组 ==========
  let navs = [];                          // 净值序列，用于绘制收益曲线
  const commissionsPaid = [];             // 手续费记录
  const trades = [];                      // 成交记录数组

  // 当前交易的临时变量
  let currentTrade = null;

  // ========== 第五步：遍历每根K线进行回测 ==========
  for (let i = 0; i < data.length; i++) {
    // 获取当前K线数据
    const bar = data[i];
    const price = bar.close;  // 收盘价，作为默认成交价
    const low = bar.low;      // 最低价，用于判断止损是否触发
    const high = bar.high;    // 最高价（暂未使用，可用于止盈）

    // 计算当前净值 = 现金 + 持仓市值
    // 持仓市值按收盘价计算
    const nav = cash + position * price;

    // ========== 止损逻辑（优先级最高） ==========
    // 如果有持仓且设置了止损价，检查是否触发止损
    if (position > 0 && stopPrice !== null) {
      // 判断条件：当日最低价 <= 止损价
      // 说明盘中价格曾经触及止损位
      if (low <= stopPrice) {
        // 按止损价成交（假设止损单能够在止损价成交）
        const sellPrice = stopPrice;

        // 计算卖出所得 = 股数 × 价格 × (1 - 手续费率)
        const proceeds = position * sellPrice * (1 - COMMISSION);
        const commission = position * sellPrice * COMMISSION;
        cash += proceeds;  // 资金回笼

        // 记录手续费
        commissionsPaid.push(commission);

        // ========== 记录成交（止损卖出） ==========
        if (currentTrade) {
          currentTrade.exitDate = bar.date;
          currentTrade.exitPrice = sellPrice;
          currentTrade.exitType = 'STOP_LOSS';  // 止损出场
          currentTrade.exitCommission = commission;
          currentTrade.proceeds = proceeds;
          currentTrade.pnl = proceeds - currentTrade.cost;  // 盈亏金额
          currentTrade.pnlPct = (sellPrice - currentTrade.entryPrice) / currentTrade.entryPrice;  // 盈亏比例
          currentTrade.holdingDays = trades.length > 0 ?
            Math.round((new Date(bar.date) - new Date(currentTrade.entryDate)) / (1000 * 60 * 60 * 24)) : 0;
          trades.push({ ...currentTrade });
          currentTrade = null;
        }

        // 清空持仓状态
        position = 0;
        entryPrice = null;
        entryDate = null;
        stopPrice = null;

        // 记录止损后的净值（此时净值 = 现金，因为已清仓）
        navs.push({ date: bar.date, nav: cash });

        // 跳过本根K线的后续处理，进入下一根
        continue;
      }
    }

    // ========== 策略信号处理 ==========
    // 调用策略的 onBar 方法，获取交易信号
    // 传入上下文信息供策略决策使用
    const signal = strategy.onBar({
      data,      // 完整K线数据（策略可以看历史）
      i,         // 当前K线索引
      cash,      // 当前可用现金
      position,  // 当前持仓数量
      nav,       // 当前净值
    });

    // ========== 处理卖出信号 ==========
    // 条件：收到卖出信号 且 有持仓
    if (signal && signal.type === "SELL" && position > 0) {
      // 获取卖出价格，默认使用收盘价
      const sellPrice = signal.exitPrice || price;

      // 计算卖出所得（扣除手续费）
      const commission = position * sellPrice * COMMISSION;
      const proceeds = position * sellPrice * (1 - COMMISSION);
      cash += proceeds;

      // 记录手续费
      commissionsPaid.push(commission);

      // ========== 记录成交（信号卖出） ==========
      if (currentTrade) {
        currentTrade.exitDate = bar.date;
        currentTrade.exitPrice = sellPrice;
        currentTrade.exitType = 'SIGNAL';  // 信号出场
        currentTrade.exitCommission = commission;
        currentTrade.proceeds = proceeds;
        currentTrade.pnl = proceeds - currentTrade.cost;  // 盈亏金额
        currentTrade.pnlPct = (sellPrice - currentTrade.entryPrice) / currentTrade.entryPrice;  // 盈亏比例
        currentTrade.holdingDays = Math.round((new Date(bar.date) - new Date(currentTrade.entryDate)) / (1000 * 60 * 60 * 24));
        trades.push({ ...currentTrade });
        currentTrade = null;
      }

      // 清空持仓状态
      position = 0;
      entryPrice = null;
      entryDate = null;
      stopPrice = null;

      // 记录卖出后的净值
      navs.push({ date: bar.date, nav: cash });

      // 卖出后跳过后续处理
      continue;
    }

    // ========== 处理买入信号 ==========
    // 条件：收到买入信号 且 没有持仓（本策略不支持加仓）
    if (signal && signal.type === "BUY" && position === 0) {
      // 获取策略建议的买入股数
      let shares = signal.shares || 0;

      // 计算买入成本 = 股数 × 价格 × (1 + 手续费率)
      const cost = shares * price * (1 + COMMISSION);

      // 资金不足时，调整到能买的最大股数
      if (cost > cash) {
        // 反推最大可买股数：shares = floor(现金 / (单价 × (1+手续费)))
        shares = Math.floor(cash / (price * (1 + COMMISSION)));
      }

      // 只有能买入至少1股时才执行
      if (shares > 0) {
        // 获取买入价格，默认使用收盘价
        const buyPrice = signal.entryPrice || price;

        // 计算实际成本（含手续费）
        const commission = shares * buyPrice * COMMISSION;
        const actualCost = shares * buyPrice * (1 + COMMISSION);
        cash -= actualCost;  // 扣除资金

        // 记录手续费
        commissionsPaid.push(commission);

        // ========== 记录成交（买入） ==========
        currentTrade = {
          tradeNo: trades.length + 1,    // 交易编号
          entryDate: bar.date,           // 入场日期
          entryPrice: buyPrice,          // 入场价格
          shares: shares,                // 买入股数
          stopPrice: signal.stopPrice,   // 止损价格
          entryCommission: commission,   // 入场手续费
          cost: actualCost,              // 总成本（含手续费）
          // 以下字段在卖出时填充
          exitDate: null,
          exitPrice: null,
          exitType: null,
          exitCommission: null,
          proceeds: null,
          pnl: null,
          pnlPct: null,
          holdingDays: null
        };

        // 更新持仓状态
        position = shares;           // 持仓数量
        entryPrice = buyPrice;       // 入场价格
        entryDate = bar.date;        // 入场日期
        stopPrice = signal.stopPrice; // 止损价格（由策略设定）
      }
    }

    // ========== 记录每日净值 ==========
    // 无论是否有交易，都记录当日收盘时的净值
    const navAfter = cash + position * price;
    navs.push({ date: bar.date, nav: navAfter });
  }

  // ========== 处理未平仓的持仓 ==========
  // 如果回测结束时还有持仓，记录为未平仓交易
  if (currentTrade && position > 0) {
    const lastBar = data[data.length - 1];
    currentTrade.exitDate = lastBar.date + ' (未平仓)';
    currentTrade.exitPrice = lastBar.close;
    currentTrade.exitType = 'OPEN';  // 未平仓
    currentTrade.exitCommission = 0;
    currentTrade.proceeds = position * lastBar.close;
    currentTrade.pnl = currentTrade.proceeds - currentTrade.cost;
    currentTrade.pnlPct = (lastBar.close - currentTrade.entryPrice) / currentTrade.entryPrice;
    currentTrade.holdingDays = Math.round((new Date(lastBar.date) - new Date(currentTrade.entryDate)) / (1000 * 60 * 60 * 24));
    trades.push({ ...currentTrade });
  }

  // ========== 第六步：返回回测结果 ==========
  return {
    navs,              // 净值序列，用于计算收益率、回撤等
    trades,            // 成交记录数组
    commissionsPaid,   // 手续费记录，用于分析交易成本
    finalCash: cash,   // 最终现金余额
    finalPosition: position,  // 最终持仓（如果还有的话）
    initialCash: opts.initialCash || 10000,  // 初始资金
  };
};
