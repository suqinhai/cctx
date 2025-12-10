// indicators/atr.js
// 输入 data 数组（每项包含 date, high, low, close）
// 返回数组 atrs，长度与 data 相同，前面 period-1 个为 null
module.exports = function atr(data, period = 14) {
  const trs = []; // true ranges
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      // 第一条用 high-low
      trs.push(data[i].high - data[i].low);
    } else {
      const curr = data[i];
      const prevClose = data[i - 1].close;
      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prevClose),
        Math.abs(curr.low - prevClose)
      );
      trs.push(tr);
    }
  }

  const atrs = new Array(data.length).fill(null);
  // 首次 ATR 用简单平均
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      sum += trs[i];
      if (i === period - 1) {
        atrs[i] = sum / period;
      }
    } else {
      // Wilder's smoothing: ATR_t = (ATR_{t-1}*(n-1) + TR_t) / n
      atrs[i] = (atrs[i - 1] * (period - 1) + trs[i]) / period;
    }
  }

  return atrs;
};
