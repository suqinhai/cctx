// utils/metrics.js
// ============================================
// 业绩指标计算工具模块（完整版）
// ============================================
//
// 本模块提供各种量化回测业绩指标的计算函数
// 包括：收益、风险、风险调整收益、交易统计、Alpha/Beta等
//

/**
 * 计算日收益率序列
 *
 * @param {Array} navs - 净值序列 [{date, nav}, ...]
 * @returns {Array} 日收益率数组（小数形式，如 0.01 表示 1%）
 */
function calcDailyReturns(navs) {
    const returns = [];
    for (let i = 1; i < navs.length; i++) {
        const ret = (navs[i].nav - navs[i - 1].nav) / navs[i - 1].nav;
        returns.push({
            date: navs[i].date,
            return: ret
        });
    }
    return returns;
}

/**
 * 计算年化收益率
 *
 * @param {Array} navs - 净值序列
 * @returns {number} 年化收益率（小数形式）
 */
function calcAnnualReturn(navs) {
    if (navs.length < 2) return 0;

    const startNav = navs[0].nav;
    const endNav = navs[navs.length - 1].nav;
    const days = navs.length;

    const totalReturn = endNav / startNav;
    const annualReturn = Math.pow(totalReturn, 252 / days) - 1;

    return annualReturn;
}

/**
 * 计算年化波动率
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @returns {number} 年化波动率（小数形式）
 */
function calcAnnualVolatility(dailyReturns) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length < 2) return 0;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);

    return stdDev * Math.sqrt(252);
}

/**
 * 计算夏普比率 (Sharpe Ratio)
 *
 * @param {number} annualReturn - 年化收益率
 * @param {number} annualVolatility - 年化波动率
 * @param {number} riskFreeRate - 无风险利率，默认 3%
 * @returns {number} 夏普比率
 */
function calcSharpeRatio(annualReturn, annualVolatility, riskFreeRate = 0.03) {
    if (annualVolatility === 0) return 0;
    return (annualReturn - riskFreeRate) / annualVolatility;
}

/**
 * 计算最大回撤及相关信息
 *
 * @param {Array} navs - 净值序列
 * @returns {Object} 回撤详情
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
 * @returns {Object} 交易统计
 */
function calcTradeStats(trades) {
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
            signalExitCount: 0,
            maxConsecutiveWins: 0,
            maxConsecutiveLosses: 0,
            maxConsecutiveLossAmount: 0
        };
    }

    const winTrades = closedTrades.filter(t => t.pnl > 0);
    const loseTrades = closedTrades.filter(t => t.pnl <= 0);

    const totalWin = winTrades.reduce((sum, t) => sum + t.pnl, 0);
    const avgWin = winTrades.length > 0 ? totalWin / winTrades.length : 0;
    const avgWinPct = winTrades.length > 0 ?
        winTrades.reduce((sum, t) => sum + t.pnlPct, 0) / winTrades.length : 0;

    const totalLoss = loseTrades.reduce((sum, t) => sum + Math.abs(t.pnl), 0);
    const avgLoss = loseTrades.length > 0 ? totalLoss / loseTrades.length : 0;
    const avgLossPct = loseTrades.length > 0 ?
        loseTrades.reduce((sum, t) => sum + Math.abs(t.pnlPct), 0) / loseTrades.length : 0;

    const profitLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;
    const winRate = closedTrades.length > 0 ? winTrades.length / closedTrades.length : 0;
    const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;
    const avgHoldingDays = closedTrades.reduce((sum, t) => sum + (t.holdingDays || 0), 0) / closedTrades.length;

    const maxWin = winTrades.length > 0 ? Math.max(...winTrades.map(t => t.pnl)) : 0;
    const maxLoss = loseTrades.length > 0 ? Math.max(...loseTrades.map(t => Math.abs(t.pnl))) : 0;
    const maxWinPct = winTrades.length > 0 ? Math.max(...winTrades.map(t => t.pnlPct)) : 0;
    const maxLossPct = loseTrades.length > 0 ? Math.max(...loseTrades.map(t => Math.abs(t.pnlPct))) : 0;

    const stopLossCount = closedTrades.filter(t => t.exitType === 'STOP_LOSS').length;
    const signalExitCount = closedTrades.filter(t => t.exitType === 'SIGNAL').length;

    // 计算最大连续盈亏
    let consecutiveWins = 0, consecutiveLosses = 0;
    let maxConsecutiveWins = 0, maxConsecutiveLosses = 0;
    let consecutiveLossAmount = 0, maxConsecutiveLossAmount = 0;

    closedTrades.forEach(t => {
        if (t.pnl > 0) {
            consecutiveWins++;
            maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins);
            consecutiveLosses = 0;
            consecutiveLossAmount = 0;
        } else {
            consecutiveLosses++;
            consecutiveLossAmount += Math.abs(t.pnl);
            maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
            maxConsecutiveLossAmount = Math.max(maxConsecutiveLossAmount, consecutiveLossAmount);
            consecutiveWins = 0;
        }
    });

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
        signalExitCount,
        maxConsecutiveWins,
        maxConsecutiveLosses,
        maxConsecutiveLossAmount
    };
}

/**
 * 计算滚动夏普比率
 *
 * @param {Array} navs - 净值序列
 * @param {number} window - 滚动窗口大小，默认60天
 * @param {number} riskFreeRate - 无风险利率
 * @returns {Array} 滚动夏普序列
 */
function calcRollingSharpe(navs, window = 60, riskFreeRate = 0.03) {
    const rollingSharpes = [];
    if (navs.length < window) return rollingSharpes;

    const dailyReturns = calcDailyReturns(navs);

    for (let i = window - 1; i < dailyReturns.length; i++) {
        const windowReturns = dailyReturns.slice(i - window + 1, i + 1).map(r => r.return);
        const meanReturn = windowReturns.reduce((a, b) => a + b, 0) / windowReturns.length;
        const annualReturn = meanReturn * 252;
        const variance = windowReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (windowReturns.length - 1);
        const annualVol = Math.sqrt(variance) * Math.sqrt(252);
        const sharpe = annualVol > 0 ? (annualReturn - riskFreeRate) / annualVol : 0;

        rollingSharpes.push({
            date: dailyReturns[i].date,
            sharpe
        });
    }

    return rollingSharpes;
}

/**
 * 计算回撤恢复期统计
 *
 * @param {Array} navs - 净值序列
 * @param {number} threshold - 回撤阈值，默认5%
 * @returns {Array} 回撤事件数组
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
            if (drawdown > currentPeriod.maxDrawdown) {
                currentPeriod.troughDate = navs[i].date;
                currentPeriod.troughNav = navs[i].nav;
                currentPeriod.maxDrawdown = drawdown;
                currentPeriod.drawdownDays = i - peakIdx;
            }

            if (navs[i].nav >= peak) {
                currentPeriod.recoveryDate = navs[i].date;
                currentPeriod.recoveryDays = i - peakIdx - currentPeriod.drawdownDays;
                periods.push({ ...currentPeriod });
                inDrawdown = false;
                peak = navs[i].nav;
                peakIdx = i;
                currentPeriod = null;
            }
        } else if (navs[i].nav > peak) {
            peak = navs[i].nav;
            peakIdx = i;
        }
    }

    if (inDrawdown && currentPeriod) {
        currentPeriod.recoveryDate = '未恢复';
        currentPeriod.recoveryDays = null;
        periods.push(currentPeriod);
    }

    return periods;
}

/**
 * 计算卡尔玛比率 (Calmar Ratio)
 */
function calcCalmarRatio(annualReturn, maxDrawdown) {
    if (maxDrawdown === 0) return annualReturn > 0 ? Infinity : 0;
    return annualReturn / maxDrawdown;
}

/**
 * 计算索提诺比率 (Sortino Ratio)
 */
function calcSortinoRatio(dailyReturns, riskFreeRate = 0.03) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length < 2) return 0;

    const dailyRf = riskFreeRate / 252;
    const excessReturns = returns.map(r => r - dailyRf);
    const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
    const annualExcess = meanExcess * 252;

    const negativeReturns = returns.filter(r => r < dailyRf);
    if (negativeReturns.length === 0) return annualExcess > 0 ? Infinity : 0;

    const downVariance = negativeReturns.reduce((sum, r) => sum + Math.pow(r - dailyRf, 2), 0) / negativeReturns.length;
    const downDeviation = Math.sqrt(downVariance) * Math.sqrt(252);

    return downDeviation > 0 ? annualExcess / downDeviation : 0;
}

// ============================================
// 新增指标
// ============================================

/**
 * 计算月度收益分布
 *
 * @param {Array} navs - 净值序列
 * @returns {Array} 月度收益数组 [{month, return, nav}, ...]
 */
function calcMonthlyReturns(navs) {
    if (navs.length < 2) return [];

    const monthlyReturns = [];
    let currentMonth = navs[0].date.substring(0, 7); // YYYY-MM
    let monthStartNav = navs[0].nav;

    for (let i = 1; i < navs.length; i++) {
        const month = navs[i].date.substring(0, 7);

        if (month !== currentMonth) {
            // 月份切换，计算上月收益
            const prevNav = navs[i - 1].nav;
            const monthReturn = (prevNav - monthStartNav) / monthStartNav;
            monthlyReturns.push({
                month: currentMonth,
                return: monthReturn,
                startNav: monthStartNav,
                endNav: prevNav
            });

            currentMonth = month;
            monthStartNav = prevNav;
        }
    }

    // 最后一个月
    const lastNav = navs[navs.length - 1].nav;
    const lastReturn = (lastNav - monthStartNav) / monthStartNav;
    monthlyReturns.push({
        month: currentMonth,
        return: lastReturn,
        startNav: monthStartNav,
        endNav: lastNav
    });

    return monthlyReturns;
}

/**
 * 计算年度收益分布
 *
 * @param {Array} navs - 净值序列
 * @returns {Array} 年度收益数组
 */
function calcYearlyReturns(navs) {
    if (navs.length < 2) return [];

    const yearlyReturns = [];
    let currentYear = navs[0].date.substring(0, 4);
    let yearStartNav = navs[0].nav;

    for (let i = 1; i < navs.length; i++) {
        const year = navs[i].date.substring(0, 4);

        if (year !== currentYear) {
            const prevNav = navs[i - 1].nav;
            const yearReturn = (prevNav - yearStartNav) / yearStartNav;
            yearlyReturns.push({
                year: currentYear,
                return: yearReturn,
                startNav: yearStartNav,
                endNav: prevNav
            });

            currentYear = year;
            yearStartNav = prevNav;
        }
    }

    const lastNav = navs[navs.length - 1].nav;
    const lastReturn = (lastNav - yearStartNav) / yearStartNav;
    yearlyReturns.push({
        year: currentYear,
        return: lastReturn,
        startNav: yearStartNav,
        endNav: lastNav
    });

    return yearlyReturns;
}

/**
 * 计算月度胜率
 *
 * @param {Array} monthlyReturns - 月度收益数组
 * @returns {number} 月度胜率
 */
function calcMonthlyWinRate(monthlyReturns) {
    if (monthlyReturns.length === 0) return 0;
    const winMonths = monthlyReturns.filter(m => m.return > 0).length;
    return winMonths / monthlyReturns.length;
}

/**
 * 计算VaR (Value at Risk)
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @param {number} confidence - 置信度，默认95%
 * @returns {number} VaR值（正数表示损失）
 */
function calcVaR(dailyReturns, confidence = 0.95) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length < 10) return 0;

    // 排序收益率（从小到大）
    const sortedReturns = [...returns].sort((a, b) => a - b);

    // 找到对应分位点
    const index = Math.floor(returns.length * (1 - confidence));
    const var95 = -sortedReturns[index]; // 取负值，使VaR为正数

    return var95;
}

/**
 * 计算CVaR (Conditional VaR / Expected Shortfall)
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @param {number} confidence - 置信度
 * @returns {number} CVaR值
 */
function calcCVaR(dailyReturns, confidence = 0.95) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length < 10) return 0;

    const sortedReturns = [...returns].sort((a, b) => a - b);
    const index = Math.floor(returns.length * (1 - confidence));

    // CVaR是尾部损失的平均值
    const tailReturns = sortedReturns.slice(0, index + 1);
    const cvar = -tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length;

    return cvar;
}

/**
 * 计算盈利/亏损天数统计
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @returns {Object} 盈亏天数统计
 */
function calcProfitLossDays(dailyReturns) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);

    const profitDays = returns.filter(r => r > 0).length;
    const lossDays = returns.filter(r => r < 0).length;
    const flatDays = returns.filter(r => r === 0).length;

    return {
        profitDays,
        lossDays,
        flatDays,
        totalDays: returns.length,
        profitDaysRatio: returns.length > 0 ? profitDays / returns.length : 0,
        lossDaysRatio: returns.length > 0 ? lossDays / returns.length : 0
    };
}

/**
 * 计算资金利用率（平均仓位）
 *
 * @param {Object} result - 回测结果
 * @returns {number} 资金利用率
 */
function calcCapitalUtilization(result) {
    const { navs, trades, initialCash } = result;

    // 计算每天的仓位占比
    let totalUtilization = 0;
    let daysWithPosition = 0;

    // 简化计算：用交易记录估算
    trades.forEach(t => {
        if (t.holdingDays && t.cost) {
            // 估算该笔交易期间的资金占用
            const utilizationDays = t.holdingDays;
            const utilization = t.cost / initialCash;
            totalUtilization += utilization * utilizationDays;
            daysWithPosition += utilizationDays;
        }
    });

    const totalDays = navs.length;
    return totalDays > 0 ? totalUtilization / totalDays : 0;
}

/**
 * 计算交易频率
 *
 * @param {Array} trades - 交易记录
 * @param {number} tradingDays - 交易日数
 * @returns {Object} 交易频率统计
 */
function calcTradeFrequency(trades, tradingDays) {
    const closedTrades = trades.filter(t => t.exitType !== 'OPEN');
    const totalTrades = closedTrades.length;

    return {
        totalTrades,
        tradesPerYear: tradingDays > 0 ? (totalTrades / tradingDays) * 252 : 0,
        tradesPerMonth: tradingDays > 0 ? (totalTrades / tradingDays) * 21 : 0,
        avgDaysBetweenTrades: totalTrades > 1 ? tradingDays / totalTrades : tradingDays
    };
}

/**
 * 计算收益分布的偏度 (Skewness)
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @returns {number} 偏度值
 *
 * 正偏度：右尾较长，大收益出现频率较高
 * 负偏度：左尾较长，大亏损出现频率较高
 */
function calcSkewness(dailyReturns) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length < 3) return 0;

    const n = returns.length;
    const mean = returns.reduce((a, b) => a + b, 0) / n;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    const skewness = returns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 3), 0) / n;
    return skewness;
}

/**
 * 计算收益分布的峰度 (Kurtosis)
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @returns {number} 峰度值（超额峰度，正态分布为0）
 *
 * 正峰度：尖峰肥尾，极端收益出现频率较高
 * 负峰度：平顶瘦尾，收益分布更均匀
 */
function calcKurtosis(dailyReturns) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length < 4) return 0;

    const n = returns.length;
    const mean = returns.reduce((a, b) => a + b, 0) / n;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    const kurtosis = returns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 4), 0) / n;
    return kurtosis - 3; // 超额峰度（正态分布的峰度为3）
}

/**
 * 计算Beta（相对于基准的波动性）
 *
 * @param {Array} strategyReturns - 策略日收益率
 * @param {Array} benchmarkReturns - 基准日收益率
 * @returns {number} Beta值
 *
 * Beta > 1：策略波动大于市场
 * Beta < 1：策略波动小于市场
 * Beta < 0：与市场负相关
 */
function calcBeta(strategyReturns, benchmarkReturns) {
    const sReturns = strategyReturns.map(r => typeof r === 'object' ? r.return : r);
    const bReturns = benchmarkReturns.map(r => typeof r === 'object' ? r.return : r);

    // 确保长度一致
    const len = Math.min(sReturns.length, bReturns.length);
    if (len < 2) return 1;

    const sSlice = sReturns.slice(0, len);
    const bSlice = bReturns.slice(0, len);

    const sMean = sSlice.reduce((a, b) => a + b, 0) / len;
    const bMean = bSlice.reduce((a, b) => a + b, 0) / len;

    // 计算协方差和基准方差
    let covariance = 0;
    let bVariance = 0;

    for (let i = 0; i < len; i++) {
        covariance += (sSlice[i] - sMean) * (bSlice[i] - bMean);
        bVariance += Math.pow(bSlice[i] - bMean, 2);
    }

    covariance /= len;
    bVariance /= len;

    return bVariance > 0 ? covariance / bVariance : 1;
}

/**
 * 计算Alpha（超额收益）
 *
 * @param {number} strategyReturn - 策略年化收益率
 * @param {number} benchmarkReturn - 基准年化收益率
 * @param {number} beta - Beta值
 * @param {number} riskFreeRate - 无风险利率
 * @returns {number} Alpha值
 *
 * Alpha = 策略收益 - [无风险收益 + Beta × (基准收益 - 无风险收益)]
 */
function calcAlpha(strategyReturn, benchmarkReturn, beta, riskFreeRate = 0.03) {
    const expectedReturn = riskFreeRate + beta * (benchmarkReturn - riskFreeRate);
    return strategyReturn - expectedReturn;
}

/**
 * 计算信息比率 (Information Ratio)
 *
 * @param {Array} strategyReturns - 策略日收益率
 * @param {Array} benchmarkReturns - 基准日收益率
 * @returns {number} 信息比率
 *
 * IR = 超额收益 / 跟踪误差
 */
function calcInformationRatio(strategyReturns, benchmarkReturns) {
    const sReturns = strategyReturns.map(r => typeof r === 'object' ? r.return : r);
    const bReturns = benchmarkReturns.map(r => typeof r === 'object' ? r.return : r);

    const len = Math.min(sReturns.length, bReturns.length);
    if (len < 2) return 0;

    // 计算超额收益序列
    const excessReturns = [];
    for (let i = 0; i < len; i++) {
        excessReturns.push(sReturns[i] - bReturns[i]);
    }

    // 计算平均超额收益（年化）
    const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / len;
    const annualExcess = meanExcess * 252;

    // 计算跟踪误差（年化）
    const variance = excessReturns.reduce((sum, r) => sum + Math.pow(r - meanExcess, 2), 0) / (len - 1);
    const trackingError = Math.sqrt(variance) * Math.sqrt(252);

    return trackingError > 0 ? annualExcess / trackingError : 0;
}

/**
 * 计算相关系数
 *
 * @param {Array} returns1 - 收益率序列1
 * @param {Array} returns2 - 收益率序列2
 * @returns {number} 相关系数 (-1 到 1)
 */
function calcCorrelation(returns1, returns2) {
    const r1 = returns1.map(r => typeof r === 'object' ? r.return : r);
    const r2 = returns2.map(r => typeof r === 'object' ? r.return : r);

    const len = Math.min(r1.length, r2.length);
    if (len < 2) return 0;

    const r1Slice = r1.slice(0, len);
    const r2Slice = r2.slice(0, len);

    const mean1 = r1Slice.reduce((a, b) => a + b, 0) / len;
    const mean2 = r2Slice.reduce((a, b) => a + b, 0) / len;

    let covariance = 0;
    let var1 = 0;
    let var2 = 0;

    for (let i = 0; i < len; i++) {
        covariance += (r1Slice[i] - mean1) * (r2Slice[i] - mean2);
        var1 += Math.pow(r1Slice[i] - mean1, 2);
        var2 += Math.pow(r2Slice[i] - mean2, 2);
    }

    const stdProduct = Math.sqrt(var1 * var2);
    return stdProduct > 0 ? covariance / stdProduct : 0;
}

/**
 * 计算收益回撤比
 *
 * @param {number} totalReturn - 总收益率
 * @param {number} maxDrawdown - 最大回撤
 * @returns {number} 收益回撤比
 */
function calcReturnDrawdownRatio(totalReturn, maxDrawdown) {
    return maxDrawdown > 0 ? totalReturn / maxDrawdown : (totalReturn > 0 ? Infinity : 0);
}

// ============================================
// 新增指标函数 - 第二批
// ============================================

/**
 * 计算下行波动率（只计算亏损部分的波动率）
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @param {number} threshold - 目标收益率阈值，默认0
 * @returns {number} 年化下行波动率
 */
function calcDownsideVolatility(dailyReturns, threshold = 0) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length < 2) return 0;

    // 只取低于阈值的收益
    const downsideReturns = returns.filter(r => r < threshold);
    if (downsideReturns.length === 0) return 0;

    const variance = downsideReturns.reduce((sum, r) => sum + Math.pow(r - threshold, 2), 0) / downsideReturns.length;
    return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * 计算最大单日涨跌幅
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @returns {Object} 最大单日涨跌幅信息
 */
function calcMaxDailyReturn(dailyReturns) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length === 0) return { maxGain: 0, maxLoss: 0, maxGainDate: null, maxLossDate: null };

    let maxGain = -Infinity, maxLoss = Infinity;
    let maxGainIdx = 0, maxLossIdx = 0;

    returns.forEach((r, i) => {
        if (r > maxGain) { maxGain = r; maxGainIdx = i; }
        if (r < maxLoss) { maxLoss = r; maxLossIdx = i; }
    });

    return {
        maxGain: maxGain === -Infinity ? 0 : maxGain,
        maxLoss: maxLoss === Infinity ? 0 : Math.abs(maxLoss),
        maxGainDate: dailyReturns[maxGainIdx]?.date || null,
        maxLossDate: dailyReturns[maxLossIdx]?.date || null
    };
}

/**
 * 计算平均回撤
 *
 * @param {Array} navs - 净值序列
 * @returns {number} 平均回撤
 */
function calcAverageDrawdown(navs) {
    if (navs.length < 2) return 0;

    let peak = navs[0].nav;
    let totalDrawdown = 0;
    let drawdownCount = 0;

    for (let i = 1; i < navs.length; i++) {
        if (navs[i].nav > peak) {
            peak = navs[i].nav;
        } else {
            const drawdown = (peak - navs[i].nav) / peak;
            if (drawdown > 0) {
                totalDrawdown += drawdown;
                drawdownCount++;
            }
        }
    }

    return drawdownCount > 0 ? totalDrawdown / drawdownCount : 0;
}

/**
 * 计算水下时间比例（净值低于历史高点的时间占比）
 *
 * @param {Array} navs - 净值序列
 * @returns {number} 水下时间比例
 */
function calcUnderwaterRatio(navs) {
    if (navs.length < 2) return 0;

    let peak = navs[0].nav;
    let underwaterDays = 0;

    for (let i = 1; i < navs.length; i++) {
        if (navs[i].nav < peak) {
            underwaterDays++;
        } else {
            peak = navs[i].nav;
        }
    }

    return underwaterDays / (navs.length - 1);
}

/**
 * 计算累计收益率最高点
 *
 * @param {Array} navs - 净值序列
 * @returns {Object} 最高点信息
 */
function calcPeakReturn(navs) {
    if (navs.length < 2) return { peakReturn: 0, peakDate: null, peakNav: 0 };

    const startNav = navs[0].nav;
    let maxReturn = -Infinity;
    let maxReturnIdx = 0;

    for (let i = 1; i < navs.length; i++) {
        const ret = (navs[i].nav - startNav) / startNav;
        if (ret > maxReturn) {
            maxReturn = ret;
            maxReturnIdx = i;
        }
    }

    return {
        peakReturn: maxReturn === -Infinity ? 0 : maxReturn,
        peakDate: navs[maxReturnIdx].date,
        peakNav: navs[maxReturnIdx].nav
    };
}

/**
 * 计算日均收益率
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @returns {number} 日均收益率
 */
function calcDailyAvgReturn(dailyReturns) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length === 0) return 0;
    return returns.reduce((a, b) => a + b, 0) / returns.length;
}

/**
 * 计算收益率中位数
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @returns {number} 收益率中位数
 */
function calcMedianReturn(dailyReturns) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length === 0) return 0;

    const sorted = [...returns].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 计算收益率标准差
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @returns {number} 日收益率标准差
 */
function calcReturnStdDev(dailyReturns) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length < 2) return 0;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    return Math.sqrt(variance);
}

/**
 * 计算正收益占比
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @returns {number} 正收益占比
 */
function calcPositiveReturnRatio(dailyReturns) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length === 0) return 0;

    const positiveCount = returns.filter(r => r > 0).length;
    return positiveCount / returns.length;
}

/**
 * 计算周度收益和胜率
 *
 * @param {Array} navs - 净值序列
 * @returns {Object} 周度统计
 */
function calcWeeklyStats(navs) {
    if (navs.length < 5) return { weeklyReturns: [], weeklyWinRate: 0 };

    const weeklyReturns = [];
    let weekStartNav = navs[0].nav;
    let weekStartIdx = 0;

    for (let i = 1; i < navs.length; i++) {
        // 简化处理：每5个交易日为一周
        if ((i - weekStartIdx) >= 5 || i === navs.length - 1) {
            const weekReturn = (navs[i].nav - weekStartNav) / weekStartNav;
            weeklyReturns.push({
                startDate: navs[weekStartIdx].date,
                endDate: navs[i].date,
                return: weekReturn
            });
            weekStartNav = navs[i].nav;
            weekStartIdx = i;
        }
    }

    const winWeeks = weeklyReturns.filter(w => w.return > 0).length;
    const weeklyWinRate = weeklyReturns.length > 0 ? winWeeks / weeklyReturns.length : 0;

    return { weeklyReturns, weeklyWinRate };
}

/**
 * 计算季度收益
 *
 * @param {Array} navs - 净值序列
 * @returns {Array} 季度收益数组
 */
function calcQuarterlyReturns(navs) {
    if (navs.length < 2) return [];

    const quarterlyReturns = [];
    let currentQuarter = getQuarter(navs[0].date);
    let quarterStartNav = navs[0].nav;

    for (let i = 1; i < navs.length; i++) {
        const quarter = getQuarter(navs[i].date);

        if (quarter !== currentQuarter) {
            const prevNav = navs[i - 1].nav;
            const quarterReturn = (prevNav - quarterStartNav) / quarterStartNav;
            quarterlyReturns.push({
                quarter: currentQuarter,
                return: quarterReturn,
                startNav: quarterStartNav,
                endNav: prevNav
            });

            currentQuarter = quarter;
            quarterStartNav = prevNav;
        }
    }

    // 最后一个季度
    const lastNav = navs[navs.length - 1].nav;
    const lastReturn = (lastNav - quarterStartNav) / quarterStartNav;
    quarterlyReturns.push({
        quarter: currentQuarter,
        return: lastReturn,
        startNav: quarterStartNav,
        endNav: lastNav
    });

    return quarterlyReturns;
}

// 辅助函数：获取季度标识
function getQuarter(dateStr) {
    const month = parseInt(dateStr.substring(5, 7));
    const year = dateStr.substring(0, 4);
    const q = Math.ceil(month / 3);
    return `${year}Q${q}`;
}

/**
 * 计算最佳/最差月份
 *
 * @param {Array} monthlyReturns - 月度收益数组
 * @returns {Object} 最佳最差月份信息
 */
function calcBestWorstMonth(monthlyReturns) {
    if (monthlyReturns.length === 0) {
        return { bestMonth: null, bestReturn: 0, worstMonth: null, worstReturn: 0 };
    }

    let best = monthlyReturns[0], worst = monthlyReturns[0];

    monthlyReturns.forEach(m => {
        if (m.return > best.return) best = m;
        if (m.return < worst.return) worst = m;
    });

    return {
        bestMonth: best.month,
        bestReturn: best.return,
        worstMonth: worst.month,
        worstReturn: worst.return
    };
}

/**
 * 计算连续盈利/亏损月数
 *
 * @param {Array} monthlyReturns - 月度收益数组
 * @returns {Object} 连续月度统计
 */
function calcConsecutiveMonths(monthlyReturns) {
    if (monthlyReturns.length === 0) {
        return { maxConsecutiveWinMonths: 0, maxConsecutiveLossMonths: 0 };
    }

    let consecutiveWin = 0, consecutiveLoss = 0;
    let maxConsecutiveWin = 0, maxConsecutiveLoss = 0;

    monthlyReturns.forEach(m => {
        if (m.return > 0) {
            consecutiveWin++;
            maxConsecutiveWin = Math.max(maxConsecutiveWin, consecutiveWin);
            consecutiveLoss = 0;
        } else if (m.return < 0) {
            consecutiveLoss++;
            maxConsecutiveLoss = Math.max(maxConsecutiveLoss, consecutiveLoss);
            consecutiveWin = 0;
        } else {
            consecutiveWin = 0;
            consecutiveLoss = 0;
        }
    });

    return {
        maxConsecutiveWinMonths: maxConsecutiveWin,
        maxConsecutiveLossMonths: maxConsecutiveLoss
    };
}

/**
 * 计算交易持仓天数统计
 *
 * @param {Array} trades - 交易记录
 * @returns {Object} 持仓天数统计
 */
function calcHoldingDaysStats(trades) {
    const closedTrades = trades.filter(t => t.exitType !== 'OPEN' && t.holdingDays);
    if (closedTrades.length === 0) {
        return { maxHoldingDays: 0, minHoldingDays: 0, avgHoldingDays: 0 };
    }

    const holdingDays = closedTrades.map(t => t.holdingDays);
    return {
        maxHoldingDays: Math.max(...holdingDays),
        minHoldingDays: Math.min(...holdingDays),
        avgHoldingDays: holdingDays.reduce((a, b) => a + b, 0) / holdingDays.length
    };
}

/**
 * 计算平均每笔交易成本
 *
 * @param {number} totalCost - 总交易成本
 * @param {number} totalTrades - 总交易次数
 * @returns {number} 平均每笔成本
 */
function calcAvgTradeCost(totalCost, totalTrades) {
    return totalTrades > 0 ? totalCost / totalTrades : 0;
}

/**
 * 计算单笔最大投入资金
 *
 * @param {Array} trades - 交易记录
 * @returns {Object} 最大投入信息
 */
function calcMaxTradeSize(trades) {
    if (trades.length === 0) {
        return { maxTradeSize: 0, maxTradeSizeDate: null };
    }

    let maxSize = 0, maxSizeIdx = 0;
    trades.forEach((t, i) => {
        if (t.cost > maxSize) {
            maxSize = t.cost;
            maxSizeIdx = i;
        }
    });

    return {
        maxTradeSize: maxSize,
        maxTradeSizeDate: trades[maxSizeIdx].entryDate
    };
}

/**
 * 计算换手率
 *
 * @param {Array} trades - 交易记录
 * @param {number} avgNav - 平均净值
 * @returns {number} 换手率
 */
function calcTurnoverRate(trades, avgNav) {
    if (trades.length === 0 || avgNav === 0) return 0;

    const totalTradeValue = trades.reduce((sum, t) => {
        const buyValue = t.cost || 0;
        const sellValue = t.proceeds || 0;
        return sum + buyValue + sellValue;
    }, 0);

    return totalTradeValue / avgNav;
}

/**
 * 计算空仓统计
 *
 * @param {Array} trades - 交易记录
 * @param {number} totalDays - 总交易日数
 * @returns {Object} 空仓统计
 */
function calcEmptyPositionStats(trades, totalDays) {
    if (trades.length === 0) {
        return { emptyDays: totalDays, emptyRatio: 1 };
    }

    // 计算持仓天数总和
    const holdingDays = trades.reduce((sum, t) => sum + (t.holdingDays || 0), 0);
    const emptyDays = Math.max(0, totalDays - holdingDays);

    return {
        emptyDays,
        emptyRatio: totalDays > 0 ? emptyDays / totalDays : 0
    };
}

/**
 * 计算Omega比率
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @param {number} threshold - 目标收益率阈值，默认0
 * @returns {number} Omega比率
 */
function calcOmegaRatio(dailyReturns, threshold = 0) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length === 0) return 0;

    let sumGains = 0, sumLosses = 0;

    returns.forEach(r => {
        if (r > threshold) {
            sumGains += (r - threshold);
        } else {
            sumLosses += (threshold - r);
        }
    });

    return sumLosses > 0 ? sumGains / sumLosses : (sumGains > 0 ? Infinity : 0);
}

/**
 * 计算Gain-to-Pain比率（总盈利/总亏损绝对值）
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @returns {number} Gain-to-Pain比率
 */
function calcGainToPainRatio(dailyReturns) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length === 0) return 0;

    const totalGain = returns.filter(r => r > 0).reduce((a, b) => a + b, 0);
    const totalPain = Math.abs(returns.filter(r => r < 0).reduce((a, b) => a + b, 0));

    return totalPain > 0 ? totalGain / totalPain : (totalGain > 0 ? Infinity : 0);
}

/**
 * 计算Tail比率（右尾/左尾收益比）
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @param {number} percentile - 尾部百分位，默认5%
 * @returns {number} Tail比率
 */
function calcTailRatio(dailyReturns, percentile = 0.05) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length < 20) return 0;

    const sorted = [...returns].sort((a, b) => a - b);
    const tailSize = Math.floor(returns.length * percentile);
    if (tailSize === 0) return 0;

    // 左尾（最差的收益）
    const leftTail = sorted.slice(0, tailSize);
    const leftTailAvg = Math.abs(leftTail.reduce((a, b) => a + b, 0) / tailSize);

    // 右尾（最好的收益）
    const rightTail = sorted.slice(-tailSize);
    const rightTailAvg = rightTail.reduce((a, b) => a + b, 0) / tailSize;

    return leftTailAvg > 0 ? rightTailAvg / leftTailAvg : (rightTailAvg > 0 ? Infinity : 0);
}

/**
 * 计算Ulcer Index（考虑回撤深度和持续时间的风险指标）
 *
 * @param {Array} navs - 净值序列
 * @returns {number} Ulcer Index
 */
function calcUlcerIndex(navs) {
    if (navs.length < 2) return 0;

    let peak = navs[0].nav;
    let sumSquaredDrawdown = 0;

    for (let i = 1; i < navs.length; i++) {
        if (navs[i].nav > peak) {
            peak = navs[i].nav;
        }
        const drawdown = (peak - navs[i].nav) / peak * 100; // 百分比形式
        sumSquaredDrawdown += drawdown * drawdown;
    }

    return Math.sqrt(sumSquaredDrawdown / navs.length);
}

/**
 * 计算Sterling比率（年化收益/平均回撤）
 *
 * @param {number} annualReturn - 年化收益率
 * @param {number} avgDrawdown - 平均回撤
 * @returns {number} Sterling比率
 */
function calcSterlingRatio(annualReturn, avgDrawdown) {
    return avgDrawdown > 0 ? annualReturn / avgDrawdown : (annualReturn > 0 ? Infinity : 0);
}

/**
 * 计算Burke比率（年化收益/回撤平方和的平方根）
 *
 * @param {number} annualReturn - 年化收益率
 * @param {Array} drawdownPeriods - 回撤事件数组
 * @returns {number} Burke比率
 */
function calcBurkeRatio(annualReturn, drawdownPeriods) {
    if (drawdownPeriods.length === 0) return annualReturn > 0 ? Infinity : 0;

    const sumSquaredDrawdown = drawdownPeriods.reduce((sum, p) => sum + Math.pow(p.maxDrawdown, 2), 0);
    const burkeRisk = Math.sqrt(sumSquaredDrawdown);

    return burkeRisk > 0 ? annualReturn / burkeRisk : (annualReturn > 0 ? Infinity : 0);
}

/**
 * 计算去除极端值后的收益表现
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @param {number} excludeDays - 排除的天数，默认5
 * @returns {Object} 去除极端值后的统计
 */
function calcTrimmedReturn(dailyReturns, excludeDays = 5) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length <= excludeDays * 2) {
        return { trimmedTotalReturn: 0, trimmedAvgReturn: 0 };
    }

    const sorted = [...returns].sort((a, b) => a - b);
    // 去掉最好和最差的N天
    const trimmed = sorted.slice(excludeDays, -excludeDays);

    const trimmedTotal = trimmed.reduce((a, b) => a + b, 0);
    const trimmedAvg = trimmedTotal / trimmed.length;

    // 累计收益（简化计算）
    const trimmedTotalReturn = trimmed.reduce((acc, r) => acc * (1 + r), 1) - 1;

    return {
        trimmedTotalReturn,
        trimmedAvgReturn: trimmedAvg,
        excludedBestDays: excludeDays,
        excludedWorstDays: excludeDays
    };
}

/**
 * 计算超额收益率
 *
 * @param {number} strategyReturn - 策略收益率
 * @param {number} benchmarkReturn - 基准收益率
 * @returns {number} 超额收益率
 */
function calcExcessReturn(strategyReturn, benchmarkReturn) {
    return strategyReturn - benchmarkReturn;
}

/**
 * 计算基准对比（买入持有收益）
 *
 * @param {Array} data - K线数据
 * @returns {Object} 基准收益信息
 */
function calcBenchmarkReturn(data) {
    if (data.length < 2) return { totalReturn: 0, annualReturn: 0 };

    const startPrice = data[0].close;
    const endPrice = data[data.length - 1].close;
    const totalReturn = (endPrice - startPrice) / startPrice;
    const days = data.length;
    const annualReturn = Math.pow(1 + totalReturn, 252 / days) - 1;

    return {
        totalReturn,
        annualReturn,
        startPrice,
        endPrice
    };
}

/**
 * 生成基准的日收益率序列
 *
 * @param {Array} data - K线数据
 * @returns {Array} 日收益率序列
 */
function calcBenchmarkDailyReturns(data) {
    const returns = [];
    for (let i = 1; i < data.length; i++) {
        returns.push({
            date: data[i].date,
            return: (data[i].close - data[i - 1].close) / data[i - 1].close
        });
    }
    return returns;
}

/**
 * 生成完整的业绩报告
 *
 * @param {Object} result - 回测结果对象
 * @param {Array} marketData - 原始K线数据（用于基准对比）
 * @returns {Object} 完整的业绩指标
 */
function generateMetrics(result, marketData = null) {
    const { navs, trades, initialCash } = result;

    // 基础收益计算
    const dailyReturns = calcDailyReturns(navs);
    const dailyReturnsArray = dailyReturns.map(r => r.return);
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

    // ===== 已有指标 =====

    // 月度/年度收益
    const monthlyReturns = calcMonthlyReturns(navs);
    const yearlyReturns = calcYearlyReturns(navs);
    const monthlyWinRate = calcMonthlyWinRate(monthlyReturns);

    // VaR和CVaR
    const var95 = calcVaR(dailyReturns, 0.95);
    const var99 = calcVaR(dailyReturns, 0.99);
    const cvar95 = calcCVaR(dailyReturns, 0.95);

    // 盈亏天数
    const profitLossDays = calcProfitLossDays(dailyReturns);

    // 资金利用率
    const capitalUtilization = calcCapitalUtilization(result);

    // 交易频率
    const tradeFrequency = calcTradeFrequency(trades, tradingDays);

    // 偏度和峰度
    const skewness = calcSkewness(dailyReturns);
    const kurtosis = calcKurtosis(dailyReturns);

    // 收益回撤比
    const returnDrawdownRatio = calcReturnDrawdownRatio(totalReturn, drawdownInfo.maxDrawdown);

    // ===== 新增指标 - 第二批 =====

    // 下行波动率
    const downsideVolatility = calcDownsideVolatility(dailyReturns);

    // 最大单日涨跌幅
    const maxDailyReturn = calcMaxDailyReturn(dailyReturns);

    // 平均回撤
    const averageDrawdown = calcAverageDrawdown(navs);

    // 水下时间比例
    const underwaterRatio = calcUnderwaterRatio(navs);

    // 累计收益率最高点
    const peakReturn = calcPeakReturn(navs);

    // 日均收益率
    const dailyAvgReturn = calcDailyAvgReturn(dailyReturns);

    // 收益率中位数
    const medianReturn = calcMedianReturn(dailyReturns);

    // 收益率标准差
    const returnStdDev = calcReturnStdDev(dailyReturns);

    // 正收益占比
    const positiveReturnRatio = calcPositiveReturnRatio(dailyReturns);

    // 周度统计
    const weeklyStats = calcWeeklyStats(navs);

    // 季度收益
    const quarterlyReturns = calcQuarterlyReturns(navs);

    // 最佳/最差月份
    const bestWorstMonth = calcBestWorstMonth(monthlyReturns);

    // 连续盈亏月数
    const consecutiveMonths = calcConsecutiveMonths(monthlyReturns);

    // 持仓天数统计
    const holdingDaysStats = calcHoldingDaysStats(trades);

    // 单笔最大投入
    const maxTradeSize = calcMaxTradeSize(trades);

    // 计算平均净值用于换手率
    const avgNav = navs.reduce((sum, n) => sum + n.nav, 0) / navs.length;

    // 换手率
    const turnoverRate = calcTurnoverRate(trades, avgNav);

    // 空仓统计
    const emptyPositionStats = calcEmptyPositionStats(trades, tradingDays);

    // Omega比率
    const omegaRatio = calcOmegaRatio(dailyReturns);

    // Gain-to-Pain比率
    const gainToPainRatio = calcGainToPainRatio(dailyReturns);

    // Tail比率
    const tailRatio = calcTailRatio(dailyReturns);

    // Ulcer Index
    const ulcerIndex = calcUlcerIndex(navs);

    // Sterling比率
    const sterlingRatio = calcSterlingRatio(annualReturn, averageDrawdown);

    // Burke比率
    const burkeRatio = calcBurkeRatio(annualReturn, drawdownPeriods);

    // 去除极端值收益
    const trimmedReturn = calcTrimmedReturn(dailyReturns, 5);

    // Alpha/Beta（如果有基准数据）
    let alpha = null;
    let beta = null;
    let informationRatio = null;
    let correlation = null;
    let benchmarkStats = null;
    let excessReturn = null;

    if (marketData && marketData.length > 0) {
        const benchmarkReturns = calcBenchmarkDailyReturns(marketData);
        benchmarkStats = calcBenchmarkReturn(marketData);

        beta = calcBeta(dailyReturns, benchmarkReturns);
        alpha = calcAlpha(annualReturn, benchmarkStats.annualReturn, beta);
        informationRatio = calcInformationRatio(dailyReturns, benchmarkReturns);
        correlation = calcCorrelation(dailyReturns, benchmarkReturns);
        excessReturn = calcExcessReturn(totalReturn, benchmarkStats.totalReturn);
    }

    return {
        // ===== 收益指标 =====
        totalReturn,
        annualReturn,
        tradingDays,
        dailyAvgReturn,
        medianReturn,
        returnStdDev,
        positiveReturnRatio,

        // ===== 收益最高点 =====
        peakReturn: peakReturn.peakReturn,
        peakReturnDate: peakReturn.peakDate,
        peakNav: peakReturn.peakNav,

        // ===== 风险指标 =====
        annualVolatility,
        downsideVolatility,
        maxDrawdown: drawdownInfo.maxDrawdown,
        drawdownPeakDate: drawdownInfo.peakDate,
        drawdownTroughDate: drawdownInfo.troughDate,
        drawdownRecoveryDate: drawdownInfo.recoveryDate,
        drawdownDays: drawdownInfo.drawdownDays,
        recoveryDays: drawdownInfo.recoveryDays,
        averageDrawdown,
        underwaterRatio,

        // ===== 最大单日涨跌 =====
        maxDailyGain: maxDailyReturn.maxGain,
        maxDailyGainDate: maxDailyReturn.maxGainDate,
        maxDailyLoss: maxDailyReturn.maxLoss,
        maxDailyLossDate: maxDailyReturn.maxLossDate,

        // ===== VaR =====
        var95,
        var99,
        cvar95,

        // ===== 风险调整收益 =====
        sharpeRatio,
        sortinoRatio,
        calmarRatio,
        returnDrawdownRatio,
        omegaRatio,
        gainToPainRatio,
        tailRatio,
        ulcerIndex,
        sterlingRatio,
        burkeRatio,

        // ===== 交易统计 =====
        ...tradeStats,

        // ===== 持仓天数 =====
        ...holdingDaysStats,

        // ===== 单笔最大投入 =====
        maxTradeSize: maxTradeSize.maxTradeSize,
        maxTradeSizeDate: maxTradeSize.maxTradeSizeDate,

        // ===== 换手率和空仓 =====
        turnoverRate,
        emptyDays: emptyPositionStats.emptyDays,
        emptyRatio: emptyPositionStats.emptyRatio,

        // ===== 时间分布收益 =====
        monthlyReturns,
        yearlyReturns,
        quarterlyReturns,
        monthlyWinRate,
        weeklyWinRate: weeklyStats.weeklyWinRate,

        // ===== 最佳/最差月份 =====
        bestMonth: bestWorstMonth.bestMonth,
        bestMonthReturn: bestWorstMonth.bestReturn,
        worstMonth: bestWorstMonth.worstMonth,
        worstMonthReturn: bestWorstMonth.worstReturn,

        // ===== 连续月度统计 =====
        maxConsecutiveWinMonths: consecutiveMonths.maxConsecutiveWinMonths,
        maxConsecutiveLossMonths: consecutiveMonths.maxConsecutiveLossMonths,

        // ===== 盈亏天数 =====
        ...profitLossDays,

        // ===== 资金效率 =====
        capitalUtilization,
        ...tradeFrequency,

        // ===== 收益分布特征 =====
        skewness,
        kurtosis,

        // ===== 去除极端值收益 =====
        trimmedTotalReturn: trimmedReturn.trimmedTotalReturn,
        trimmedAvgReturn: trimmedReturn.trimmedAvgReturn,

        // ===== Alpha/Beta（相对基准）=====
        alpha,
        beta,
        informationRatio,
        correlation,
        excessReturn,
        benchmarkStats,

        // ===== 滚动指标 =====
        rollingSharpe,

        // ===== 回撤事件 =====
        drawdownPeriods,

        // ===== 日收益率序列（用于导出）=====
        dailyReturns
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
    calcMonthlyReturns,
    calcYearlyReturns,
    calcMonthlyWinRate,
    calcVaR,
    calcCVaR,
    calcProfitLossDays,
    calcCapitalUtilization,
    calcTradeFrequency,
    calcSkewness,
    calcKurtosis,
    calcBeta,
    calcAlpha,
    calcInformationRatio,
    calcCorrelation,
    calcReturnDrawdownRatio,
    calcBenchmarkReturn,
    calcBenchmarkDailyReturns,
    // 新增导出
    calcDownsideVolatility,
    calcMaxDailyReturn,
    calcAverageDrawdown,
    calcUnderwaterRatio,
    calcPeakReturn,
    calcDailyAvgReturn,
    calcMedianReturn,
    calcReturnStdDev,
    calcPositiveReturnRatio,
    calcWeeklyStats,
    calcQuarterlyReturns,
    calcBestWorstMonth,
    calcConsecutiveMonths,
    calcHoldingDaysStats,
    calcAvgTradeCost,
    calcMaxTradeSize,
    calcTurnoverRate,
    calcEmptyPositionStats,
    calcOmegaRatio,
    calcGainToPainRatio,
    calcTailRatio,
    calcUlcerIndex,
    calcSterlingRatio,
    calcBurkeRatio,
    calcTrimmedReturn,
    calcExcessReturn,
    generateMetrics
};
