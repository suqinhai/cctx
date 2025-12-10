// indicators/sma.js
// 简单移动平均 Simple Moving Average
// data: K线数组
// i: 当前索引
// period: 周期
module.exports = function sma(data, i, period) {
  if (i < period - 1) return null;

  let sum = 0;
  for (let j = i - period + 1; j <= i; j++) {
    sum += data[j].close;
  }
  return sum / period;
};