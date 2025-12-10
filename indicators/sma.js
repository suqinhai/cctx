// indicators/sma.js
// ============================================
// SMA (Simple Moving Average) 简单移动平均线指标
// ============================================
//
// 什么是SMA？
// SMA是最基础的技术指标之一，计算过去N个周期收盘价的算术平均值。
// 用途：判断趋势方向、支撑阻力位、生成交易信号（如均线交叉）
//
// 计算公式：
// SMA(N) = (P1 + P2 + ... + Pn) / N
// 其中 P1~Pn 是最近N个周期的收盘价
//

/**
 * 计算简单移动平均线
 *
 * @param {Array} data - K线数据数组，每个元素需包含 close 属性
 * @param {number} i - 当前K线索引（从0开始）
 * @param {number} period - 计算周期，如 5日均线、20日均线
 *
 * @returns {number|null} 返回SMA值，数据不足时返回null
 *
 * 使用示例：
 *   const ma5 = sma(data, 10, 5);   // 计算第10根K线的5日均线
 *   const ma20 = sma(data, 25, 20); // 计算第25根K线的20日均线
 */
module.exports = function sma(data, i, period) {
  // 数据不足判断：
  // 如果当前索引 i 小于 period-1，说明历史数据不够计算均线
  // 例如：计算5日均线需要至少5根K线，索引从0开始，所以需要 i >= 4
  if (i < period - 1) {
    return null;  // 返回null表示无法计算
  }

  // 累加计算：从 (i - period + 1) 到 i 的收盘价之和
  // 例如：i=10, period=5，则累加索引 6,7,8,9,10 共5根K线
  let sum = 0;
  for (let j = i - period + 1; j <= i; j++) {
    sum += data[j].close;  // 累加收盘价
  }

  // 返回平均值
  return sum / period;
};
