// utils/metrics.js
// ============================================
// 业绩指标计算工具模块
// ============================================
//
// 本模块提供各种量化回测业绩指标的计算函数
// 包括：夏普比率、最大回撤、胜率、盈亏比等
//

/**
 * 计算日收益率序列
 *
 * @param {Array} navs - 净值序列 [{date, nav}, ...]
 * @returns {Array} 日收益率数组（小数形式，如 0.01 表示 1%）
 *
 * 公式：dailyReturn[i] = (nav[i] - nav[i-1]) / nav[i-1]
 */
function calcDailyReturns(navs) {
    const returns = [];
    for (let i = 1; i < navs.length; i++) {
        const ret = (navs[i].nav - navs[i - 1].nav) / navs[i - 1].nav;
        returns.push(ret);
    }
    return returns;
}

/**
 * 计算年化收益率
 *
 * @param {Array} navs - 净值序列
 * @returns {number} 年化收益率（小数形式）
 *
 * 公式：annualReturn = (endNav / startNav) ^ (252 / days) - 1
 * 252 是一年的交易日数量
 */
function calcAnnualReturn(navs) {
    if (navs.length < 2) return 0;

    const startNav = navs[0].nav;
    const endNav = navs[navs.length - 1].nav;
    const days = navs.length;

    // 复利年化公式
    const totalReturn = endNav / startNav;
    const annualReturn = Math.pow(totalReturn, 252 / days) - 1;

    return annualReturn;
}

/**
 * 计算年化波动率
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @returns {number} 年化波动率（小数形式）
 *
 * 公式：annualVolatility = std(dailyReturns) × sqrt(252)
 * 波动率反映收益的不确定性，越高风险越大
 */
function calcAnnualVolatility(dailyReturns) {
    if (dailyReturns.length < 2) return 0;

    // 计算平均值
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;

    // 计算方差
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (dailyReturns.length - 1);

    // 标准差
    const stdDev = Math.sqrt(variance);

    // 年化（乘以 sqrt(252)）
    return stdDev * Math.sqrt(252);
}

/**
 * 计算夏普比率 (Sharpe Ratio)
 *
 * @param {number} annualReturn - 年化收益率
 * @param {number} annualVolatility - 年化波动率
 * @param {number} riskFreeRate - 无风险利率，默认 3%
 * @returns {number} 夏普比率
 *
 * 公式：sharpe = (annualReturn - riskFreeRate) / annualVolatility
 *
 * 夏普比率说明：
 *   > 1.0：良好
 *   > 2.0：优秀
 *   > 3.0：卓越
 *   < 0：策略跑输无风险收益
 */
function calcSharpeRatio(annualReturn, annualVolatility, riskFreeRate = 0.03) {
    if (annualVolatility === 0) return 0;
    return (annualReturn - riskFreeRate) / annualVolatility;
}

/**
 * 计算最大回撤及相关信息
 *
 * @param {Array} navs - 净值序列
 * @returns {Object} 包含:
 *   - maxDrawdown: 最大回撤比例
 *   - peakDate: 峰值日期
 *   - troughDate: 谷值日期
 *   - recoveryDate: 恢复日期（如有）
 *   - drawdownDays: 回撤持续天数
 *   - recoveryDays: 恢复所需天数
 */
function calcMaxDrawdown(navs) {
    if (navs.length < 2) {
        return {
            maxDrawdown: 0,
            peakDate: null,
            troughDate: null,
            recoveryDate: null,
            drawdownDays: 0,
            recoveryDays: null
        };
    }

    let peak = navs[0].nav;
    let peakIdx = 0;
    let maxDrawdown = 0;
    let maxDrawdownPeakIdx = 0;
    let maxDrawdownTroughIdx = 0;

    // 遍历寻找最大回撤
    for (let i = 1; i < navs.length; i++) {
        if (navs[i].nav > peak) {
            peak = navs[i].nav;
            peakIdx = i;
        }

        const drawdown = (peak - navs[i].nav) / peak;
        if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
            maxDrawdownPeakIdx = peakIdx;
            maxDrawdownTroughIdx = i;
        }
    }

    // 寻找恢复日期
    let recoveryIdx = null;
    const peakNav = navs[maxDrawdownPeakIdx].nav;
    for (let i = maxDrawdownTroughIdx + 1; i < navs.length; i++) {
        if (navs[i].nav >= peakNav) {
            recoveryIdx = i;
            break;
        }
    }

    return {
        maxDrawdown,
        peakDate: navs[maxDrawdownPeakIdx].date,
        troughDate: navs[maxDrawdownTroughIdx].date,
        recoveryDate: recoveryIdx !== null ? navs[recoveryIdx].date : '未恢复',
        drawdownDays: maxDrawdownTroughIdx - maxDrawdownPeakIdx,
        recoveryDays: recoveryIdx !== null ? recoveryIdx - maxDrawdownTroughIdx : null
    };
}

/**
 * 计算交易统计指标
 *
 * @param {Array} trades - 成交记录数组
 * @returns {Object} 包含:
 *   - totalTrades: 总交易次数
 *   - winTrades: 盈利交易次数
 *   - loseTrades: 亏损交易次数
 *   - winRate: 胜率
 *   - avgWin: 平均盈利金额
 *   - avgLoss: 平均亏损金额
 *   - avgWinPct: 平均盈利比例
 *   - avgLossPct: 平均亏损比例
 *   - profitLossRatio: 盈亏比（平均盈利/平均亏损）
 *   - expectancy: 期望值
 */
function calcTradeStats(trades) {
    // 过滤掉未平仓的交易
    const closedTrades = trades.filter(t => t.exitType !== 'OPEN');

    if (closedTrades.length === 0) {
        return {
            totalTrades: 0,
            winTrades: 0,
            loseTrades: 0,
            winRate: 0,
            avgWin: 0,
            avgLoss: 0,
            avgWinPct: 0,
            avgLossPct: 0,
            profitLossRatio: 0,
            expectancy: 0,
            avgHoldingDays: 0,
            maxWin: 0,
            maxLoss: 0,
            maxWinPct: 0,
            maxLossPct: 0,
            stopLossCount: 0,
            signalExitCount: 0
        };
    }

    // 分类盈亏交易
    const winTrades = closedTrades.filter(t => t.pnl > 0);
    const loseTrades = closedTrades.filter(t => t.pnl <= 0);

    // 盈利统计
    const totalWin = winTrades.reduce((sum, t) => sum + t.pnl, 0);
    const avgWin = winTrades.length > 0 ? totalWin / winTrades.length : 0;
    const avgWinPct = winTrades.length > 0 ?
        winTrades.reduce((sum, t) => sum + t.pnlPct, 0) / winTrades.length : 0;

    // 亏损统计
    const totalLoss = loseTrades.reduce((sum, t) => sum + Math.abs(t.pnl), 0);
    const avgLoss = loseTrades.length > 0 ? totalLoss / loseTrades.length : 0;
    const avgLossPct = loseTrades.length > 0 ?
        loseTrades.reduce((sum, t) => sum + Math.abs(t.pnlPct), 0) / loseTrades.length : 0;

    // 盈亏比
    const profitLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

    // 胜率
    const winRate = closedTrades.length > 0 ? winTrades.length / closedTrades.length : 0;

    // 期望值 = 胜率 × 平均盈利 - (1-胜率) × 平均亏损
    const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

    // 平均持仓天数
    const avgHoldingDays = closedTrades.reduce((sum, t) => sum + (t.holdingDays || 0), 0) / closedTrades.length;

    // 最大单笔盈亏
    const maxWin = winTrades.length > 0 ? Math.max(...winTrades.map(t => t.pnl)) : 0;
    const maxLoss = loseTrades.length > 0 ? Math.max(...loseTrades.map(t => Math.abs(t.pnl))) : 0;
    const maxWinPct = winTrades.length > 0 ? Math.max(...winTrades.map(t => t.pnlPct)) : 0;
    const maxLossPct = loseTrades.length > 0 ? Math.max(...loseTrades.map(t => Math.abs(t.pnlPct))) : 0;

    // 出场方式统计
    const stopLossCount = closedTrades.filter(t => t.exitType === 'STOP_LOSS').length;
    const signalExitCount = closedTrades.filter(t => t.exitType === 'SIGNAL').length;

    return {
        totalTrades: closedTrades.length,
        winTrades: winTrades.length,
        loseTrades: loseTrades.length,
        winRate,
        avgWin,
        avgLoss,
        avgWinPct,
        avgLossPct,
        profitLossRatio,
        expectancy,
        avgHoldingDays,
        maxWin,
        maxLoss,
        maxWinPct,
        maxLossPct,
        stopLossCount,
        signalExitCount
    };
}

/**
 * 计算滚动夏普比率
 *
 * @param {Array} navs - 净值序列
 * @param {number} window - 滚动窗口大小（交易日），默认60天
 * @param {number} riskFreeRate - 年化无风险利率，默认 3%
 * @returns {Array} 滚动夏普比率序列 [{date, sharpe}, ...]
 *
 * 用途：观察策略在不同时期的表现稳定性
 */
function calcRollingSharpe(navs, window = 60, riskFreeRate = 0.03) {
    const rollingSharpes = [];

    // 需要至少 window 个数据点
    if (navs.length < window) return rollingSharpes;

    // 先计算日收益率
    const dailyReturns = calcDailyReturns(navs);

    // 滚动计算
    for (let i = window - 1; i < dailyReturns.length; i++) {
        // 取窗口内的收益率
        const windowReturns = dailyReturns.slice(i - window + 1, i + 1);

        // 计算窗口内的年化收益率和波动率
        const meanReturn = windowReturns.reduce((a, b) => a + b, 0) / windowReturns.length;
        const annualReturn = meanReturn * 252;

        const variance = windowReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (windowReturns.length - 1);
        const annualVol = Math.sqrt(variance) * Math.sqrt(252);

        // 计算夏普
        const sharpe = annualVol > 0 ? (annualReturn - riskFreeRate) / annualVol : 0;

        rollingSharpes.push({
            date: navs[i + 1].date,  // +1 因为收益率比净值少一个
            sharpe
        });
    }

    return rollingSharpes;
}

/**
 * 计算回撤恢复期统计
 *
 * @param {Array} navs - 净值序列
 * @param {number} threshold - 回撤阈值，默认 5%（0.05）
 * @returns {Array} 回撤事件数组，每个包含回撤开始、结束、恢复日期等
 */
function calcDrawdownPeriods(navs, threshold = 0.05) {
    const periods = [];

    let peak = navs[0].nav;
    let peakIdx = 0;
    let inDrawdown = false;
    let currentPeriod = null;

    for (let i = 1; i < navs.length; i++) {
        const drawdown = (peak - navs[i].nav) / peak;

        if (!inDrawdown && drawdown >= threshold) {
            // 进入回撤期
            inDrawdown = true;
            currentPeriod = {
                peakDate: navs[peakIdx].date,
                peakNav: peak,
                troughDate: navs[i].date,
                troughNav: navs[i].nav,
                maxDrawdown: drawdown,
                recoveryDate: null,
                drawdownDays: i - peakIdx,
                recoveryDays: null
            };
        } else if (inDrawdown) {
            // 在回撤期内
            if (drawdown > currentPeriod.maxDrawdown) {
                // 更新谷值
                currentPeriod.troughDate = navs[i].date;
                currentPeriod.troughNav = navs[i].nav;
                currentPeriod.maxDrawdown = drawdown;
                currentPeriod.drawdownDays = i - peakIdx;
            }

            if (navs[i].nav >= peak) {
                // 恢复到峰值
                currentPeriod.recoveryDate = navs[i].date;
                currentPeriod.recoveryDays = i - peakIdx - currentPeriod.drawdownDays;
                periods.push({ ...currentPeriod });

                // 重置
                inDrawdown = false;
                peak = navs[i].nav;
                peakIdx = i;
                currentPeriod = null;
            }
        } else if (navs[i].nav > peak) {
            // 创新高
            peak = navs[i].nav;
            peakIdx = i;
        }
    }

    // 如果结束时还在回撤中
    if (inDrawdown && currentPeriod) {
        currentPeriod.recoveryDate = '未恢复';
        currentPeriod.recoveryDays = null;
        periods.push(currentPeriod);
    }

    return periods;
}

/**
 * 计算卡尔玛比率 (Calmar Ratio)
 *
 * @param {number} annualReturn - 年化收益率
 * @param {number} maxDrawdown - 最大回撤
 * @returns {number} 卡尔玛比率
 *
 * 公式：calmar = annualReturn / maxDrawdown
 * 衡量每承担1%回撤风险获得的收益
 */
function calcCalmarRatio(annualReturn, maxDrawdown) {
    if (maxDrawdown === 0) return annualReturn > 0 ? Infinity : 0;
    return annualReturn / maxDrawdown;
}

/**
 * 计算索提诺比率 (Sortino Ratio)
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @param {number} riskFreeRate - 年化无风险利率
 * @returns {number} 索提诺比率
 *
 * 与夏普比率类似，但只考虑下行波动率
 * 更准确地衡量下行风险
 */
function calcSortinoRatio(dailyReturns, riskFreeRate = 0.03) {
    if (dailyReturns.length < 2) return 0;

    // 日无风险收益率
    const dailyRf = riskFreeRate / 252;

    // 计算超额收益
    const excessReturns = dailyReturns.map(r => r - dailyRf);

    // 计算年化超额收益
    const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
    const annualExcess = meanExcess * 252;

    // 只取负收益计算下行波动率
    const negativeReturns = dailyReturns.filter(r => r < dailyRf);
    if (negativeReturns.length === 0) return annualExcess > 0 ? Infinity : 0;

    const downVariance = negativeReturns.reduce((sum, r) => sum + Math.pow(r - dailyRf, 2), 0) / negativeReturns.length;
    const downDeviation = Math.sqrt(downVariance) * Math.sqrt(252);

    return downDeviation > 0 ? annualExcess / downDeviation : 0;
}

/**
 * 生成完整的业绩报告
 *
 * @param {Object} result - 回测结果对象
 * @returns {Object} 完整的业绩指标
 */
function generateMetrics(result) {
    const { navs, trades, initialCash } = result;

    // 基础收益计算
    const dailyReturns = calcDailyReturns(navs);
    const totalReturn = (navs[navs.length - 1].nav - navs[0].nav) / navs[0].nav;
    const annualReturn = calcAnnualReturn(navs);
    const annualVolatility = calcAnnualVolatility(dailyReturns);

    // 风险调整收益
    const sharpeRatio = calcSharpeRatio(annualReturn, annualVolatility);
    const sortinoRatio = calcSortinoRatio(dailyReturns);

    // 回撤分析
    const drawdownInfo = calcMaxDrawdown(navs);
    const calmarRatio = calcCalmarRatio(annualReturn, drawdownInfo.maxDrawdown);
    const drawdownPeriods = calcDrawdownPeriods(navs);

    // 交易统计
    const tradeStats = calcTradeStats(trades);

    // 滚动夏普
    const rollingSharpe = calcRollingSharpe(navs, 60);

    // 交易日数
    const tradingDays = navs.length;

    return {
        // ===== 收益指标 =====
        totalReturn,           // 总收益率
        annualReturn,          // 年化收益率
        tradingDays,           // 交易日数

        // ===== 风险指标 =====
        annualVolatility,      // 年化波动率
        maxDrawdown: drawdownInfo.maxDrawdown,  // 最大回撤
        drawdownPeakDate: drawdownInfo.peakDate,
        drawdownTroughDate: drawdownInfo.troughDate,
        drawdownRecoveryDate: drawdownInfo.recoveryDate,
        drawdownDays: drawdownInfo.drawdownDays,
        recoveryDays: drawdownInfo.recoveryDays,

        // ===== 风险调整收益 =====
        sharpeRatio,           // 夏普比率
        sortinoRatio,          // 索提诺比率
        calmarRatio,           // 卡尔玛比率

        // ===== 交易统计 =====
        ...tradeStats,

        // ===== 滚动指标 =====
        rollingSharpe,         // 滚动夏普序列

        // ===== 回撤事件 =====
        drawdownPeriods        // 回撤恢复期列表
    };
}

// 导出所有函数
module.exports = {
    calcDailyReturns,
    calcAnnualReturn,
    calcAnnualVolatility,
    calcSharpeRatio,
    calcMaxDrawdown,
    calcTradeStats,
    calcRollingSharpe,
    calcDrawdownPeriods,
    calcCalmarRatio,
    calcSortinoRatio,
    generateMetrics
};
