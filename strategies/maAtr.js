// strategies/maAtr.js
// ============================================
// MA+ATR 双均线交叉策略（带ATR动态止损）
// ============================================
//
// 策略原理：
// 1. 买入信号：快速均线上穿慢速均线（金叉）
// 2. 卖出信号：快速均线下穿慢速均线（死叉）
// 3. 止损：基于ATR动态设置止损位
// 4. 仓位：基于风险百分比计算仓位大小
//
// 这是一种经典的趋势跟踪策略，适合趋势明显的市场
// 在震荡市中可能产生较多假信号
//

// 引入技术指标
const sma = require("../indicators/sma");  // 简单移动平均线
const atr = require("../indicators/atr");  // 平均真实波幅

/**
 * MA+ATR 策略类
 *
 * 策略参数说明：
 * - fast: 快速均线周期（默认10），反应灵敏
 * - slow: 慢速均线周期（默认30），过滤噪音
 * - atrPeriod: ATR计算周期（默认14）
 * - atrMultiplier: 止损距离 = ATR × 此倍数（默认3）
 * - riskPct: 每笔交易最大风险占净值比例（默认1%）
 */
module.exports = class MaAtrStrategy {

  /**
   * 构造函数 - 初始化策略参数
   * @param {Object} config - 策略配置对象
   */
  constructor(config = {}) {
    // 快速均线周期，默认10日
    // 快线反应灵敏，能更快捕捉价格变化
    this.fast = config.fast || 10;

    // 慢速均线周期，默认30日
    // 慢线平滑稳定，用于确认趋势方向
    this.slow = config.slow || 30;

    // ATR计算周期，默认14日（Wilder推荐值）
    this.atrPeriod = config.atrPeriod || 14;

    // ATR止损倍数，默认3倍
    // 止损价 = 入场价 - ATR × atrMultiplier
    // 倍数越大，止损越宽松，被震出的概率越小，但单笔亏损可能更大
    this.atrMultiplier = config.atrMultiplier || 3;

    // 单笔风险比例，默认1%
    // 表示每笔交易最多亏损净值的1%
    // 这是凯利公式和风险管理的核心参数
    this.riskPct = config.riskPct || 0.01;

    // ATR序列，由回测引擎注入
    // 预计算好整个ATR序列，避免重复计算
    this._atrs = null;
  }

  /**
   * 设置ATR序列（由回测引擎调用）
   * @param {Array} atrs - 预计算的ATR数组
   */
  setAtrSeries(atrs) {
    this._atrs = atrs;
  }

  /**
   * 每根K线调用一次，返回交易信号
   *
   * @param {Object} ctx - 上下文对象
   * @param {Array} ctx.data - 完整K线数据
   * @param {number} ctx.i - 当前K线索引
   * @param {number} ctx.cash - 当前可用现金
   * @param {number} ctx.position - 当前持仓数量
   * @param {number} ctx.nav - 当前净值
   *
   * @returns {Object} 交易信号
   *   - { type: "HOLD" } 持有/观望
   *   - { type: "BUY", shares, entryPrice, stopPrice } 买入信号
   *   - { type: "SELL", exitPrice } 卖出信号
   */
  onBar(ctx) {
    // 解构上下文参数
    const { data, i, cash, position, nav } = ctx;

    // ========== 计算技术指标 ==========
    // 计算当前K线的快速均线值
    const fastMA = sma(data, i, this.fast);

    // 计算当前K线的慢速均线值
    const slowMA = sma(data, i, this.slow);

    // 获取当前K线的ATR值（从预计算的序列中取）
    const currAtr = this._atrs ? this._atrs[i] : null;

    // ========== 数据有效性检查 ==========
    // 如果均线数据不足（前期K线数量不够），返回持有信号
    if (!fastMA || !slowMA) {
      return { type: "HOLD" };
    }

    // ========== 买入逻辑：金叉 ==========
    // 条件：没有持仓 且 快线 > 慢线（金叉形态）
    if (position === 0 && fastMA > slowMA) {
      // ATR必须可用才能计算止损和仓位
      if (!currAtr) {
        return { type: "HOLD" };
      }

      // ----- 止损价格计算 -----
      // 入场价使用当前收盘价
      const entryPrice = data[i].close;

      // 止损距离 = ATR × 倍数
      // 例如：ATR=0.5，倍数=3，则止损距离=1.5元
      const stopDistance = currAtr * this.atrMultiplier;

      // 止损距离必须为正数
      if (stopDistance <= 0) {
        return { type: "HOLD" };
      }

      // ----- 仓位计算（基于风险的仓位管理） -----
      // 核心思想：控制每笔交易的最大亏损金额
      //
      // 当前净值（总资产）
      const equity = nav;

      // 本次交易允许的最大亏损金额
      // 例如：净值10万，风险比例2%，则最多亏损2000元
      const riskCash = equity * this.riskPct;

      // 计算可买股数
      // 公式：股数 = 允许亏损金额 / 每股最大亏损
      // 每股最大亏损 = 止损距离（stopDistance）
      // 例如：允许亏损2000元，每股最大亏损1.5元，则买2000/1.5=1333股
      let shares = Math.floor(riskCash / stopDistance);

      // 至少买1股（防止股数为0的情况）
      if (shares < 1) {
        shares = 1;
      }

      // 计算止损价格 = 入场价 - 止损距离
      const stopPrice = entryPrice - stopDistance;

      // ----- 返回买入信号 -----
      return {
        type: "BUY",           // 信号类型：买入
        shares,                // 建议买入股数
        entryPrice,            // 入场价格
        stopPrice,             // 止损价格
      };
    }

    // ========== 卖出逻辑：死叉 ==========
    // 条件：有持仓 且 快线 < 慢线（死叉形态）
    if (position > 0 && fastMA < slowMA) {
      return {
        type: "SELL",                 // 信号类型：卖出
        exitPrice: data[i].close      // 卖出价格：当前收盘价
      };
    }

    // ========== 默认：持有/观望 ==========
    // 既不满足买入条件，也不满足卖出条件
    return { type: "HOLD" };
  }
};
