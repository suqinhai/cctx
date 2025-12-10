// engine/backtest.js
const COMMISSION = 0.001; // 手续费
const SLIPPAGE_PCT = 0.000; // 简化先不加滑点

module.exports = function backtest(data, StrategyClass, opts = {}) {
  const strategy = new StrategyClass(opts.strategyConfig || {});
  // 计算 ATR 并注入
  const atr = require("../indicators/atr");
  const atrSeries = atr(data, opts.strategyConfig?.atrPeriod || 14);
  if (typeof strategy.setAtrSeries === "function") {
    strategy.setAtrSeries(atrSeries);
  }

  let cash = opts.initialCash || 10000;
  let position = 0; // 持仓份数
  let entryPrice = null;
  let stopPrice = null;

  let navs = [];
  const commissionsPaid = [];

  for (let i = 0; i < data.length; i++) {
    const bar = data[i];
    const price = bar.close;
    const low = bar.low;
    const high = bar.high;

    // 计算当前净值（市值按收盘价）
    const nav = cash + position * price;

    // 1) 止损优先：如果持仓并且当日最低价 <= stopPrice 则触发止损
    if (position > 0 && stopPrice !== null) {
      // 若当天低价 <= stopPrice，按 stopPrice 价成交（更稳妥）
      if (low <= stopPrice) {
        const sellPrice = stopPrice;
        const proceeds = position * sellPrice * (1 - COMMISSION);
        cash += proceeds;
        commissionsPaid.push(position * sellPrice * COMMISSION);
        // 清仓
        position = 0;
        entryPrice = null;
        stopPrice = null;
        // 记录 NAV after stop
        navs.push({ date: bar.date, nav: cash });
        continue; // 跳到下一根 K 线
      }
    }

    // 2) 策略信号
    const signal = strategy.onBar({
      data,
      i,
      cash,
      position,
      nav,
    });

    if (signal && signal.type === "SELL" && position > 0) {
      // 按收盘价卖出
      const sellPrice = signal.exitPrice || price;
      const proceeds = position * sellPrice * (1 - COMMISSION);
      cash += proceeds;
      commissionsPaid.push(position * sellPrice * COMMISSION);
      position = 0;
      entryPrice = null;
      stopPrice = null;
      // 记录 NAV
      navs.push({ date: bar.date, nav: cash });
      continue;
    }

    if (signal && signal.type === "BUY" && position === 0) {
      // signal.shars 为策略估算的 shares
      let shares = signal.shares || 0;
      // 额外检查资金是否足够（考虑手续费）
      const cost = shares * price * (1 + COMMISSION);
      if (cost > cash) {
        // 调整到能买的最大份数
        shares = Math.floor(cash / (price * (1 + COMMISSION)));
      }
      if (shares > 0) {
        // 买入按收盘价
        const buyPrice = signal.entryPrice || price;
        const actualCost = shares * buyPrice * (1 + COMMISSION);
        cash -= actualCost;
        commissionsPaid.push(shares * buyPrice * COMMISSION);
        position = shares;
        entryPrice = buyPrice;
        stopPrice = signal.stopPrice;
      }
    }

    // 每根 K 线结束记录净值
    const navAfter = cash + position * price;
    navs.push({ date: bar.date, nav: navAfter });
  }

  return {
    navs,
    commissionsPaid,
    finalCash: cash,
    finalPosition: position,
  };
};
