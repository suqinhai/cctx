// strategies/maAtr.js
const sma = require("../indicators/sma");
const atr = require("../indicators/atr");

module.exports = class MaAtrStrategy {
  // config: { fast, slow, atrPeriod, atrMultiplier, riskPct }
  constructor(config = {}) {
    this.fast = config.fast || 10;
    this.slow = config.slow || 30;
    this.atrPeriod = config.atrPeriod || 14;
    this.atrMultiplier = config.atrMultiplier || 3; // 止损倍数
    this.riskPct = config.riskPct || 0.01; // 每笔风险占净值比例（1%）
    // ATR series 会在 backtest 初始化并注入到策略实例
    this._atrs = null;
  }

  // backtest 会注入 atrs 到策略实例
  setAtrSeries(atrs) {
    this._atrs = atrs;
  }

  onBar(ctx) {
    // ctx: { data, i, cash, position, nav }
    const { data, i, cash, position, nav } = ctx;

    const fastMA = sma(data, i, this.fast);
    const slowMA = sma(data, i, this.slow);
    const currAtr = this._atrs ? this._atrs[i] : null;

    if (!fastMA || !slowMA) return { type: "HOLD" };

    // 买入信号：金叉
    if (position === 0 && fastMA > slowMA) {
      // 要求 ATR 可用
      if (!currAtr) return { type: "HOLD" };

      // 计算止损价：entry - atr * multiplier
      // 仓位按风险率算：riskCash = nav * riskPct
      // stopDistance = atr * multiplier
      // shares = floor(riskCash / stopDistance / entryPrice?) —— 注意单位变换，通常按价格差计算份数
      const entryPrice = data[i].close;
      const stopDistance = currAtr * this.atrMultiplier; // 价格单位
      if (stopDistance <= 0) return { type: "HOLD" };

      const equity = nav;
      const riskCash = equity * this.riskPct;
      // 每份资产亏损 = stopDistance （每股/每币的绝对价格跌幅）
      // 需要购买多少份，使得 max亏损 ≈ riskCash
      // shares = floor(riskCash / stopDistance)
      let shares = Math.floor(riskCash / stopDistance);

      // 若 shares 为 0（风险太小），可以尝试最小 1 股/1 单位
      if (shares < 1) shares = 1;

      // 返回买入信号，并携带止损和预估仓位
      const stopPrice = entryPrice - stopDistance;
      return {
        type: "BUY",
        shares,
        entryPrice,
        stopPrice,
      };
    }

    // 卖出信号：死叉
    if (position > 0 && fastMA < slowMA) {
      return { type: "SELL", exitPrice: data[i].close };
    }

    return { type: "HOLD" };
  }
};
