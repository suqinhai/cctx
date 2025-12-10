// indicators/atr.js
// ============================================
// ATR (Average True Range) 平均真实波幅指标
// ============================================
//
// 什么是ATR？
// ATR由J. Welles Wilder Jr.发明，用于衡量市场波动性。
// ATR值越大表示市场波动越剧烈，越小表示市场越平静。
//
// 用途：
// 1. 设置止损位：入场价 ± N倍ATR
// 2. 仓位管理：根据波动性调整仓位大小
// 3. 判断市场状态：高ATR=趋势行情，低ATR=震荡行情
//
// 计算步骤：
// 1. 计算真实波幅 TR (True Range)
// 2. 对TR进行平滑处理得到ATR
//

/**
 * 计算ATR序列
 *
 * @param {Array} data - K线数据数组，每个元素需包含 {high, low, close}
 * @param {number} period - ATR周期，默认14（Wilder推荐值）
 *
 * @returns {Array} 返回ATR数组，长度与data相同，前period-1个为null
 *
 * 使用示例：
 *   const atrSeries = atr(data, 14);
 *   const currentAtr = atrSeries[atrSeries.length - 1];
 */
module.exports = function atr(data, period = 14) {
  // ========== 第一步：计算每根K线的真实波幅(TR) ==========
  // TR的定义：当日波动范围，考虑跳空缺口
  // TR = max(当日最高-最低, |当日最高-昨收|, |当日最低-昨收|)
  const trs = [];  // 存储所有TR值

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      // 第一根K线没有"昨收"，直接用当日振幅
      // TR = 最高价 - 最低价
      trs.push(data[i].high - data[i].low);
    } else {
      // 后续K线：计算三个值中的最大值
      const curr = data[i];           // 当前K线
      const prevClose = data[i - 1].close;  // 昨日收盘价

      // 三个候选值：
      // 1. 当日振幅：high - low
      // 2. 跳空高开幅度：|high - 昨收|（向上跳空）
      // 3. 跳空低开幅度：|low - 昨收|（向下跳空）
      const tr = Math.max(
        curr.high - curr.low,              // 当日振幅
        Math.abs(curr.high - prevClose),   // 高点与昨收的距离
        Math.abs(curr.low - prevClose)     // 低点与昨收的距离
      );
      trs.push(tr);
    }
  }

  // ========== 第二步：计算ATR（对TR进行平滑） ==========
  // 初始化ATR数组，全部填充null
  const atrs = new Array(data.length).fill(null);

  // 用于计算首个ATR的累加器
  let sum = 0;

  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      // 前period根K线：累加TR，用于计算首个ATR
      sum += trs[i];

      if (i === period - 1) {
        // 第period根K线：计算首个ATR（简单算术平均）
        // 例如：period=14时，在第14根K线(索引13)计算首个ATR
        atrs[i] = sum / period;
      }
      // 索引 0 到 period-2 的ATR保持为null
    } else {
      // 后续K线：使用Wilder平滑法（指数移动平均的变体）
      // Wilder平滑公式：ATR(t) = [ATR(t-1) × (N-1) + TR(t)] / N
      // 这比简单平均更平滑，对近期数据赋予更高权重
      atrs[i] = (atrs[i - 1] * (period - 1) + trs[i]) / period;
    }
  }

  // 返回完整的ATR序列
  return atrs;
};
