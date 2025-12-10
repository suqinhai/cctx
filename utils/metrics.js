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

// ============================================
// 新增指标函数 - 第三批
// ============================================

/**
 * 计算Treynor Ratio（特雷诺比率）
 * 单位系统风险的超额收益，适合比较不同Beta的策略
 *
 * @param {number} annualReturn - 年化收益率
 * @param {number} beta - Beta值
 * @param {number} riskFreeRate - 无风险利率
 * @returns {number} Treynor比率
 */
function calcTreynorRatio(annualReturn, beta, riskFreeRate = 0.03) {
    if (beta === 0 || beta === null) return 0;
    return (annualReturn - riskFreeRate) / beta;
}

/**
 * 计算M² (Modigliani-Modigliani)
 * 调整到与基准相同风险后的收益，更直观
 *
 * @param {number} sharpeRatio - 策略夏普比率
 * @param {number} benchmarkVolatility - 基准年化波动率
 * @param {number} riskFreeRate - 无风险利率
 * @returns {number} M²值
 */
function calcM2(sharpeRatio, benchmarkVolatility, riskFreeRate = 0.03) {
    return sharpeRatio * benchmarkVolatility + riskFreeRate;
}

/**
 * 计算Pain Index（痛苦指数）
 * 平均回撤深度，反映投资者承受的平均痛苦程度
 *
 * @param {Array} navs - 净值序列
 * @returns {number} Pain Index
 */
function calcPainIndex(navs) {
    if (navs.length < 2) return 0;

    let peak = navs[0].nav;
    let totalDrawdown = 0;

    for (let i = 1; i < navs.length; i++) {
        if (navs[i].nav > peak) {
            peak = navs[i].nav;
        }
        const drawdown = (peak - navs[i].nav) / peak;
        totalDrawdown += drawdown;
    }

    return totalDrawdown / (navs.length - 1);
}

/**
 * 计算Pain Ratio（痛苦比率）
 * 年化收益/Pain Index
 *
 * @param {number} annualReturn - 年化收益率
 * @param {number} painIndex - Pain Index
 * @returns {number} Pain Ratio
 */
function calcPainRatio(annualReturn, painIndex) {
    if (painIndex === 0) return annualReturn > 0 ? Infinity : 0;
    return annualReturn / painIndex;
}

/**
 * 计算最大连续亏损天数
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @returns {Object} 最大连续亏损天数信息
 */
function calcMaxConsecutiveLossDays(dailyReturns) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length === 0) return { maxLossDays: 0, maxWinDays: 0 };

    let consecutiveLoss = 0, consecutiveWin = 0;
    let maxLossDays = 0, maxWinDays = 0;

    returns.forEach(r => {
        if (r < 0) {
            consecutiveLoss++;
            maxLossDays = Math.max(maxLossDays, consecutiveLoss);
            consecutiveWin = 0;
        } else if (r > 0) {
            consecutiveWin++;
            maxWinDays = Math.max(maxWinDays, consecutiveWin);
            consecutiveLoss = 0;
        } else {
            // 持平不打断连续
        }
    });

    return { maxLossDays, maxWinDays };
}

/**
 * 计算95%最大回撤（排除极端5%的回撤）
 *
 * @param {Array} navs - 净值序列
 * @returns {number} 95%最大回撤
 */
function calcDrawdown95(navs) {
    if (navs.length < 20) return 0;

    // 计算每日回撤
    let peak = navs[0].nav;
    const drawdowns = [];

    for (let i = 1; i < navs.length; i++) {
        if (navs[i].nav > peak) {
            peak = navs[i].nav;
        }
        const drawdown = (peak - navs[i].nav) / peak;
        drawdowns.push(drawdown);
    }

    // 排序后取95分位
    const sorted = [...drawdowns].sort((a, b) => b - a);
    const index = Math.floor(sorted.length * 0.05);
    return sorted[index] || 0;
}

/**
 * 计算收益一致性（正收益月份占比）
 *
 * @param {Array} monthlyReturns - 月度收益数组
 * @returns {number} 收益一致性
 */
function calcReturnConsistency(monthlyReturns) {
    if (monthlyReturns.length === 0) return 0;
    const positiveMonths = monthlyReturns.filter(m => m.return > 0).length;
    return positiveMonths / monthlyReturns.length;
}

/**
 * 计算滚动收益稳定性（12月滚动收益的标准差）
 *
 * @param {Array} navs - 净值序列
 * @param {number} window - 滚动窗口（交易日），默认252天约等于12个月
 * @returns {Object} 滚动收益统计
 */
function calcRollingReturnStability(navs, window = 252) {
    if (navs.length < window) return { stability: 0, avgRollingReturn: 0, rollingReturns: [] };

    const rollingReturns = [];
    for (let i = window; i < navs.length; i++) {
        const ret = (navs[i].nav - navs[i - window].nav) / navs[i - window].nav;
        rollingReturns.push({
            date: navs[i].date,
            return: ret
        });
    }

    if (rollingReturns.length === 0) return { stability: 0, avgRollingReturn: 0, rollingReturns: [] };

    const returns = rollingReturns.map(r => r.return);
    const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return {
        stability: stdDev,  // 标准差越小越稳定
        avgRollingReturn: avg,
        rollingReturns
    };
}

/**
 * 计算利润因子（Profit Factor）
 * 总盈利 / 总亏损的绝对值
 *
 * @param {Array} trades - 交易记录
 * @returns {number} 利润因子
 */
function calcProfitFactor(trades) {
    const closedTrades = trades.filter(t => t.exitType !== 'OPEN');
    if (closedTrades.length === 0) return 0;

    const totalProfit = closedTrades
        .filter(t => t.pnl > 0)
        .reduce((sum, t) => sum + t.pnl, 0);

    const totalLoss = Math.abs(closedTrades
        .filter(t => t.pnl < 0)
        .reduce((sum, t) => sum + t.pnl, 0));

    if (totalLoss === 0) return totalProfit > 0 ? Infinity : 0;
    return totalProfit / totalLoss;
}

/**
 * 计算系统质量数 SQN (System Quality Number)
 * SQN = (平均R倍数 / R倍数标准差) × √交易次数
 * Van Tharp提出的衡量交易系统质量的指标
 *
 * @param {Array} trades - 交易记录
 * @returns {Object} SQN相关指标
 */
function calcSQN(trades) {
    const closedTrades = trades.filter(t => t.exitType !== 'OPEN' && t.pnlPct !== undefined);
    if (closedTrades.length < 2) return { sqn: 0, avgR: 0, rStdDev: 0 };

    // 使用盈亏比例作为R倍数的近似
    const rMultiples = closedTrades.map(t => t.pnlPct);

    const avgR = rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length;
    const variance = rMultiples.reduce((sum, r) => sum + Math.pow(r - avgR, 2), 0) / (rMultiples.length - 1);
    const rStdDev = Math.sqrt(variance);

    if (rStdDev === 0) return { sqn: 0, avgR, rStdDev: 0 };

    // SQN = (avgR / rStdDev) × √n
    const sqn = (avgR / rStdDev) * Math.sqrt(closedTrades.length);

    return { sqn, avgR, rStdDev };
}

/**
 * 计算平均R倍数
 * R = 实际盈亏 / 初始风险
 *
 * @param {Array} trades - 交易记录
 * @returns {number} 平均R倍数
 */
function calcAvgRMultiple(trades) {
    const closedTrades = trades.filter(t =>
        t.exitType !== 'OPEN' &&
        t.stopPrice &&
        t.entryPrice &&
        t.pnl !== undefined
    );

    if (closedTrades.length === 0) return 0;

    const rMultiples = closedTrades.map(t => {
        // 初始风险 = (入场价 - 止损价) × 股数
        const initialRisk = Math.abs(t.entryPrice - t.stopPrice) * t.shares;
        if (initialRisk === 0) return 0;
        return t.pnl / initialRisk;
    });

    return rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length;
}

/**
 * 计算凯利比例（Kelly Criterion）
 * 最优仓位比例 = 胜率 - (1-胜率)/盈亏比
 *
 * @param {number} winRate - 胜率
 * @param {number} profitLossRatio - 盈亏比
 * @returns {number} 凯利比例
 */
function calcKellyRatio(winRate, profitLossRatio) {
    if (profitLossRatio === 0 || profitLossRatio === Infinity) return 0;
    const kelly = winRate - (1 - winRate) / profitLossRatio;
    return Math.max(0, kelly);  // 凯利比例不能为负
}

/**
 * 计算最长盈利/亏损周期（连续盈利/亏损的最长天数）
 *
 * @param {Array} navs - 净值序列
 * @returns {Object} 最长周期信息
 */
function calcLongestProfitLossPeriod(navs) {
    if (navs.length < 2) return {
        longestProfitPeriod: 0,
        longestLossPeriod: 0,
        profitPeriodStart: null,
        profitPeriodEnd: null,
        lossPeriodStart: null,
        lossPeriodEnd: null
    };

    let profitStreak = 0, lossStreak = 0;
    let maxProfitStreak = 0, maxLossStreak = 0;
    let profitStart = 0, lossStart = 0;
    let maxProfitStart = 0, maxProfitEnd = 0;
    let maxLossStart = 0, maxLossEnd = 0;

    const startNav = navs[0].nav;
    let prevAboveStart = navs[0].nav >= startNav;

    for (let i = 1; i < navs.length; i++) {
        const currentAboveStart = navs[i].nav >= startNav;
        const dailyReturn = (navs[i].nav - navs[i-1].nav) / navs[i-1].nav;

        if (dailyReturn > 0) {
            if (profitStreak === 0) profitStart = i;
            profitStreak++;
            if (profitStreak > maxProfitStreak) {
                maxProfitStreak = profitStreak;
                maxProfitStart = profitStart;
                maxProfitEnd = i;
            }
            lossStreak = 0;
        } else if (dailyReturn < 0) {
            if (lossStreak === 0) lossStart = i;
            lossStreak++;
            if (lossStreak > maxLossStreak) {
                maxLossStreak = lossStreak;
                maxLossStart = lossStart;
                maxLossEnd = i;
            }
            profitStreak = 0;
        }
    }

    return {
        longestProfitPeriod: maxProfitStreak,
        longestLossPeriod: maxLossStreak,
        profitPeriodStart: maxProfitStreak > 0 ? navs[maxProfitStart].date : null,
        profitPeriodEnd: maxProfitStreak > 0 ? navs[maxProfitEnd].date : null,
        lossPeriodStart: maxLossStreak > 0 ? navs[maxLossStart].date : null,
        lossPeriodEnd: maxLossStreak > 0 ? navs[maxLossEnd].date : null
    };
}

/**
 * 计算基准波动率
 *
 * @param {Array} data - K线数据
 * @returns {number} 基准年化波动率
 */
function calcBenchmarkVolatility(data) {
    if (data.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < data.length; i++) {
        returns.push((data[i].close - data[i-1].close) / data[i-1].close);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * 计算交易R倍数分布
 *
 * @param {Array} trades - 交易记录
 * @returns {Object} R倍数分布统计
 */
function calcRMultipleDistribution(trades) {
    const closedTrades = trades.filter(t =>
        t.exitType !== 'OPEN' &&
        t.stopPrice &&
        t.entryPrice
    );

    if (closedTrades.length === 0) {
        return {
            rMultiples: [],
            maxR: 0,
            minR: 0,
            positiveRCount: 0,
            negativeRCount: 0
        };
    }

    const rMultiples = closedTrades.map(t => {
        const initialRisk = Math.abs(t.entryPrice - t.stopPrice) * t.shares;
        if (initialRisk === 0) return 0;
        return t.pnl / initialRisk;
    });

    return {
        rMultiples,
        maxR: Math.max(...rMultiples),
        minR: Math.min(...rMultiples),
        positiveRCount: rMultiples.filter(r => r > 0).length,
        negativeRCount: rMultiples.filter(r => r < 0).length
    };
}

/**
 * 计算回撤持续时间统计
 *
 * @param {Array} navs - 净值序列
 * @returns {Object} 回撤持续时间统计
 */
function calcDrawdownDurationStats(navs) {
    if (navs.length < 2) return { avgDrawdownDuration: 0, maxDrawdownDuration: 0, totalUnderwaterDays: 0 };

    let peak = navs[0].nav;
    let peakIdx = 0;
    let underwaterDays = 0;
    const drawdownDurations = [];
    let currentDrawdownStart = null;

    for (let i = 1; i < navs.length; i++) {
        if (navs[i].nav >= peak) {
            if (currentDrawdownStart !== null) {
                drawdownDurations.push(i - currentDrawdownStart);
                currentDrawdownStart = null;
            }
            peak = navs[i].nav;
            peakIdx = i;
        } else {
            if (currentDrawdownStart === null) {
                currentDrawdownStart = i;
            }
            underwaterDays++;
        }
    }

    // 如果最后还在回撤中
    if (currentDrawdownStart !== null) {
        drawdownDurations.push(navs.length - 1 - currentDrawdownStart);
    }

    const avgDuration = drawdownDurations.length > 0
        ? drawdownDurations.reduce((a, b) => a + b, 0) / drawdownDurations.length
        : 0;
    const maxDuration = drawdownDurations.length > 0
        ? Math.max(...drawdownDurations)
        : 0;

    return {
        avgDrawdownDuration: avgDuration,
        maxDrawdownDuration: maxDuration,
        totalUnderwaterDays: underwaterDays,
        drawdownCount: drawdownDurations.length
    };
}

/**
 * 计算风险调整后的交易统计
 *
 * @param {Array} trades - 交易记录
 * @param {number} initialCash - 初始资金
 * @returns {Object} 风险调整交易统计
 */
function calcRiskAdjustedTradeStats(trades, initialCash) {
    const closedTrades = trades.filter(t => t.exitType !== 'OPEN');
    if (closedTrades.length === 0) {
        return {
            avgTradeReturn: 0,
            tradeReturnStdDev: 0,
            tradeReturnSharpe: 0,
            maxTradeReturn: 0,
            minTradeReturn: 0
        };
    }

    const tradeReturns = closedTrades.map(t => t.pnlPct || 0);
    const avgReturn = tradeReturns.reduce((a, b) => a + b, 0) / tradeReturns.length;
    const variance = tradeReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (tradeReturns.length - 1);
    const stdDev = Math.sqrt(variance);

    return {
        avgTradeReturn: avgReturn,
        tradeReturnStdDev: stdDev,
        tradeReturnSharpe: stdDev > 0 ? avgReturn / stdDev : 0,
        maxTradeReturn: Math.max(...tradeReturns),
        minTradeReturn: Math.min(...tradeReturns)
    };
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

// ============================================
// 新增指标函数 - 第四批
// ============================================

/**
 * 计算波动率偏度（收益波动的不对称性）
 * 正偏度表示上涨时波动更大，负偏度表示下跌时波动更大
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @returns {number} 波动率偏度
 */
function calcVolatilitySkew(dailyReturns) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length < 20) return 0;

    // 分离正收益和负收益
    const positiveReturns = returns.filter(r => r > 0);
    const negativeReturns = returns.filter(r => r < 0);

    if (positiveReturns.length === 0 || negativeReturns.length === 0) return 0;

    // 计算上涨波动率
    const upMean = positiveReturns.reduce((a, b) => a + b, 0) / positiveReturns.length;
    const upVariance = positiveReturns.reduce((sum, r) => sum + Math.pow(r - upMean, 2), 0) / positiveReturns.length;
    const upVol = Math.sqrt(upVariance);

    // 计算下跌波动率
    const downMean = negativeReturns.reduce((a, b) => a + b, 0) / negativeReturns.length;
    const downVariance = negativeReturns.reduce((sum, r) => sum + Math.pow(r - downMean, 2), 0) / negativeReturns.length;
    const downVol = Math.sqrt(downVariance);

    // 波动率偏度 = 上涨波动率 / 下跌波动率 - 1
    return downVol > 0 ? (upVol / downVol) - 1 : 0;
}

/**
 * 计算指定无风险利率的夏普比率
 *
 * @param {number} annualReturn - 年化收益率
 * @param {number} annualVolatility - 年化波动率
 * @param {number} riskFreeRate - 无风险利率
 * @returns {number} 夏普比率
 */
function calcSharpeWithRf(annualReturn, annualVolatility, riskFreeRate) {
    if (annualVolatility === 0) return 0;
    return (annualReturn - riskFreeRate) / annualVolatility;
}

/**
 * 计算Jensen's Alpha（詹森阿尔法）
 * CAPM模型下的超额收益，与calcAlpha类似但更标准
 *
 * @param {number} portfolioReturn - 组合收益率
 * @param {number} marketReturn - 市场收益率
 * @param {number} beta - Beta值
 * @param {number} riskFreeRate - 无风险利率
 * @returns {number} Jensen's Alpha
 */
function calcJensensAlpha(portfolioReturn, marketReturn, beta, riskFreeRate = 0.03) {
    // Jensen's Alpha = Rp - [Rf + β(Rm - Rf)]
    const expectedReturn = riskFreeRate + beta * (marketReturn - riskFreeRate);
    return portfolioReturn - expectedReturn;
}

/**
 * 计算年化超额收益（相对于基准）
 *
 * @param {number} strategyAnnualReturn - 策略年化收益
 * @param {number} benchmarkAnnualReturn - 基准年化收益
 * @returns {number} 年化超额收益
 */
function calcAnnualExcessReturn(strategyAnnualReturn, benchmarkAnnualReturn) {
    return strategyAnnualReturn - benchmarkAnnualReturn;
}

/**
 * 计算年化换手率
 *
 * @param {Array} trades - 交易记录
 * @param {number} avgNav - 平均净值
 * @param {number} tradingDays - 交易日数
 * @returns {number} 年化换手率
 */
function calcAnnualTurnover(trades, avgNav, tradingDays) {
    if (trades.length === 0 || avgNav === 0 || tradingDays === 0) return 0;

    // 计算总交易金额
    const totalTradeValue = trades.reduce((sum, t) => {
        const buyValue = t.cost || 0;
        const sellValue = t.proceeds || 0;
        return sum + buyValue + sellValue;
    }, 0);

    // 单边换手率
    const turnover = totalTradeValue / (2 * avgNav);
    // 年化
    return turnover * (252 / tradingDays);
}

/**
 * 计算单次调仓换手率
 *
 * @param {Array} trades - 交易记录
 * @param {number} avgNav - 平均净值
 * @returns {Object} 单次调仓换手统计
 */
function calcSingleRebalanceTurnover(trades, avgNav) {
    if (trades.length === 0 || avgNav === 0) {
        return { avgTurnover: 0, maxTurnover: 0, minTurnover: 0 };
    }

    const turnovers = trades.map(t => {
        const tradeValue = (t.cost || 0) + (t.proceeds || 0);
        return tradeValue / (2 * avgNav);
    });

    return {
        avgTurnover: turnovers.reduce((a, b) => a + b, 0) / turnovers.length,
        maxTurnover: Math.max(...turnovers),
        minTurnover: Math.min(...turnovers)
    };
}

/**
 * 计算交易成本率（总成本占初始资金比例）
 *
 * @param {number} totalTradingCost - 总交易成本
 * @param {number} initialCash - 初始资金
 * @returns {number} 交易成本率
 */
function calcTradingCostRate(totalTradingCost, initialCash) {
    if (initialCash === 0) return 0;
    return totalTradingCost / initialCash;
}

/**
 * 计算滑点率（模拟）
 * 注意：实际滑点需要实盘数据，这里返回配置值或估算值
 *
 * @param {Array} trades - 交易记录
 * @param {number} configSlippage - 配置的滑点率
 * @returns {Object} 滑点统计
 */
function calcSlippageRate(trades, configSlippage = 0) {
    // 估算滑点：基于交易规模和市场流动性
    // 简化处理：返回配置值和估算值
    const totalTrades = trades.filter(t => t.exitType !== 'OPEN').length;

    return {
        configuredSlippage: configSlippage,
        estimatedSlippage: configSlippage * totalTrades,
        avgSlippagePerTrade: configSlippage
    };
}

/**
 * 计算市场冲击成本（估算）
 * 基于成交量占比估算对市场的冲击
 *
 * @param {Array} trades - 交易记录
 * @param {Array} marketData - 市场数据（含成交量）
 * @returns {Object} 市场冲击成本估算
 */
function calcMarketImpact(trades, marketData) {
    if (trades.length === 0 || !marketData || marketData.length === 0) {
        return { avgImpact: 0, maxImpact: 0, impactCost: 0 };
    }

    // 创建日期到成交量的映射
    const volumeMap = {};
    marketData.forEach(d => {
        volumeMap[d.date] = d.volume || 0;
    });

    const impacts = [];
    trades.forEach(t => {
        const volume = volumeMap[t.entryDate] || 0;
        if (volume > 0 && t.shares) {
            // 成交量占比
            const volumeRatio = t.shares / volume;
            // 简化的冲击成本模型：冲击 = 0.1% × √(成交量占比 × 10000)
            const impact = 0.001 * Math.sqrt(volumeRatio * 10000);
            impacts.push(impact);
        }
    });

    if (impacts.length === 0) return { avgImpact: 0, maxImpact: 0, impactCost: 0 };

    const avgImpact = impacts.reduce((a, b) => a + b, 0) / impacts.length;
    return {
        avgImpact,
        maxImpact: Math.max(...impacts),
        impactCost: avgImpact * trades.length
    };
}

/**
 * 计算策略容量估算（亿元）
 * 基于成交量和冲击成本估算策略最大容量
 *
 * @param {Array} trades - 交易记录
 * @param {Array} marketData - 市场数据
 * @param {number} maxImpactThreshold - 最大可接受冲击成本，默认0.5%
 * @returns {Object} 策略容量估算
 */
function calcStrategyCapacity(trades, marketData, maxImpactThreshold = 0.005) {
    if (!marketData || marketData.length === 0) {
        return { capacityYi: 0, avgDailyVolume: 0, capacityRatio: 0 };
    }

    // 计算平均日成交额
    const dailyAmounts = marketData.map(d => (d.close || 0) * (d.volume || 0));
    const avgDailyAmount = dailyAmounts.reduce((a, b) => a + b, 0) / dailyAmounts.length;

    // 假设最大可占用日成交额的2%（避免冲击过大）
    const maxDailyCapacity = avgDailyAmount * 0.02;

    // 策略容量（亿元）
    const capacityYi = maxDailyCapacity / 100000000;

    return {
        capacityYi: capacityYi,
        avgDailyVolume: avgDailyAmount,
        capacityRatio: 0.02  // 假设的最大占比
    };
}

/**
 * 计算日均成交额占比
 *
 * @param {Array} trades - 交易记录
 * @param {Array} marketData - 市场数据
 * @returns {Object} 成交额占比统计
 */
function calcVolumeRatio(trades, marketData) {
    if (trades.length === 0 || !marketData || marketData.length === 0) {
        return { avgRatio: 0, maxRatio: 0, minRatio: 0 };
    }

    // 创建日期到成交额的映射
    const amountMap = {};
    marketData.forEach(d => {
        amountMap[d.date] = (d.close || 0) * (d.volume || 0);
    });

    const ratios = [];
    trades.forEach(t => {
        const dailyAmount = amountMap[t.entryDate] || 0;
        if (dailyAmount > 0 && t.cost) {
            ratios.push(t.cost / dailyAmount);
        }
    });

    if (ratios.length === 0) return { avgRatio: 0, maxRatio: 0, minRatio: 0 };

    return {
        avgRatio: ratios.reduce((a, b) => a + b, 0) / ratios.length,
        maxRatio: Math.max(...ratios),
        minRatio: Math.min(...ratios)
    };
}

/**
 * 计算个股流动性分数
 *
 * @param {Array} marketData - 市场数据
 * @returns {Object} 流动性分数
 */
function calcLiquidityScore(marketData) {
    if (!marketData || marketData.length < 20) {
        return { score: 0, avgSpread: 0, avgVolume: 0, volumeStability: 0 };
    }

    // 计算平均成交量
    const volumes = marketData.map(d => d.volume || 0);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

    // 计算成交量稳定性（标准差/均值）
    const volVariance = volumes.reduce((sum, v) => sum + Math.pow(v - avgVolume, 2), 0) / volumes.length;
    const volStdDev = Math.sqrt(volVariance);
    const volumeStability = avgVolume > 0 ? 1 - Math.min(1, volStdDev / avgVolume) : 0;

    // 估算买卖价差（使用日内波动作为代理）
    const spreads = marketData.map(d => {
        if (d.high && d.low && d.close) {
            return (d.high - d.low) / d.close;
        }
        return 0;
    });
    const avgSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length;

    // 综合流动性分数（0-100）
    // 成交量越大、价差越小、稳定性越高，分数越高
    const volumeScore = Math.min(50, Math.log10(avgVolume + 1) * 5);
    const spreadScore = Math.max(0, 30 - avgSpread * 1000);
    const stabilityScore = volumeStability * 20;
    const score = volumeScore + spreadScore + stabilityScore;

    return {
        score: Math.min(100, Math.max(0, score)),
        avgSpread,
        avgVolume,
        volumeStability
    };
}

/**
 * 计算持仓集中度（HHI指数）
 * 对于单标的策略，HHI = 1
 *
 * @param {Array} positions - 持仓数组 [{symbol, weight}, ...]
 * @returns {Object} 集中度指标
 */
function calcConcentration(positions) {
    if (!positions || positions.length === 0) {
        // 单标的策略
        return {
            hhi: 1,  // 完全集中
            top10Ratio: 1,
            effectiveN: 1,
            isConcentrated: true
        };
    }

    // 计算权重
    const totalWeight = positions.reduce((sum, p) => sum + (p.weight || 0), 0);
    if (totalWeight === 0) return { hhi: 0, top10Ratio: 0, effectiveN: 0, isConcentrated: false };

    const weights = positions.map(p => (p.weight || 0) / totalWeight);

    // HHI = Σ(wi²)
    const hhi = weights.reduce((sum, w) => sum + w * w, 0);

    // 前10持仓占比
    const sortedWeights = [...weights].sort((a, b) => b - a);
    const top10Ratio = sortedWeights.slice(0, 10).reduce((a, b) => a + b, 0);

    // 有效持仓数量 = 1 / HHI
    const effectiveN = hhi > 0 ? 1 / hhi : 0;

    return {
        hhi,
        top10Ratio,
        effectiveN,
        isConcentrated: hhi > 0.25  // HHI > 0.25 认为是高集中度
    };
}

/**
 * 计算流通市值下限（估算）
 *
 * @param {Array} marketData - 市场数据
 * @param {number} avgTradeSize - 平均交易规模
 * @returns {Object} 市值下限估算
 */
function calcMarketCapFloor(marketData, avgTradeSize) {
    if (!marketData || marketData.length === 0) {
        return { floorYi: 0, currentEstimate: 0 };
    }

    // 估算当前流通市值（使用最新收盘价 × 平均成交量 × 假设换手率倒数）
    const lastBar = marketData[marketData.length - 1];
    const avgVolume = marketData.reduce((sum, d) => sum + (d.volume || 0), 0) / marketData.length;

    // 假设日换手率1%，则流通市值 = 日成交量 / 1%
    const estimatedMarketCap = avgVolume * lastBar.close / 0.01;

    // 策略所需最低市值（确保单笔交易不超过日成交额的1%）
    const minCapRequired = avgTradeSize * 100;

    return {
        floorYi: minCapRequired / 100000000,
        currentEstimate: estimatedMarketCap / 100000000
    };
}

/**
 * 计算年化衰减率
 * 比较前期和后期收益，估算策略衰减
 *
 * @param {Array} navs - 净值序列
 * @returns {Object} 衰减率统计
 */
function calcAnnualDecayRate(navs) {
    if (navs.length < 100) {
        return { decayRate: 0, firstHalfReturn: 0, secondHalfReturn: 0, isDecaying: false };
    }

    const mid = Math.floor(navs.length / 2);

    // 前半段年化收益
    const firstHalfNavs = navs.slice(0, mid);
    const firstReturn = (firstHalfNavs[mid - 1].nav - firstHalfNavs[0].nav) / firstHalfNavs[0].nav;
    const firstAnnual = Math.pow(1 + firstReturn, 252 / mid) - 1;

    // 后半段年化收益
    const secondHalfNavs = navs.slice(mid);
    const secondReturn = (secondHalfNavs[secondHalfNavs.length - 1].nav - secondHalfNavs[0].nav) / secondHalfNavs[0].nav;
    const secondAnnual = Math.pow(1 + secondReturn, 252 / (navs.length - mid)) - 1;

    // 衰减率 = (后半段 - 前半段) / |前半段|
    const decayRate = firstAnnual !== 0 ? (secondAnnual - firstAnnual) / Math.abs(firstAnnual) : 0;

    return {
        decayRate,
        firstHalfReturn: firstAnnual,
        secondHalfReturn: secondAnnual,
        isDecaying: decayRate < -0.2  // 衰减超过20%认为有衰减
    };
}

/**
 * 计算样本内外收益比
 * 将数据分为训练集和测试集，比较收益差异
 *
 * @param {Array} navs - 净值序列
 * @param {number} trainRatio - 训练集比例，默认0.7
 * @returns {Object} 样本内外收益比
 */
function calcInOutSampleRatio(navs, trainRatio = 0.7) {
    if (navs.length < 50) {
        return { ratio: 0, inSampleReturn: 0, outSampleReturn: 0 };
    }

    const splitIdx = Math.floor(navs.length * trainRatio);

    // 样本内收益（训练集）
    const inSampleReturn = (navs[splitIdx - 1].nav - navs[0].nav) / navs[0].nav;

    // 样本外收益（测试集）
    const outSampleReturn = (navs[navs.length - 1].nav - navs[splitIdx].nav) / navs[splitIdx].nav;

    // 收益比
    const ratio = inSampleReturn !== 0 ? outSampleReturn / inSampleReturn : 0;

    return {
        ratio,
        inSampleReturn,
        outSampleReturn,
        isOverfit: ratio < 0.5  // 样本外收益不到样本内的一半，可能过拟合
    };
}

/**
 * 计算Walk-Forward收益
 * 滚动窗口优化和测试
 *
 * @param {Array} navs - 净值序列
 * @param {number} windowSize - 滚动窗口大小，默认60天
 * @returns {Object} Walk-Forward统计
 */
function calcWalkForwardReturn(navs, windowSize = 60) {
    if (navs.length < windowSize * 2) {
        return { avgReturn: 0, consistency: 0, periods: 0 };
    }

    const periods = [];
    for (let i = windowSize; i < navs.length; i += windowSize) {
        const endIdx = Math.min(i + windowSize, navs.length);
        if (endIdx - i < windowSize / 2) break;

        const periodReturn = (navs[endIdx - 1].nav - navs[i].nav) / navs[i].nav;
        periods.push(periodReturn);
    }

    if (periods.length === 0) return { avgReturn: 0, consistency: 0, periods: 0 };

    const avgReturn = periods.reduce((a, b) => a + b, 0) / periods.length;
    const positiveRatio = periods.filter(r => r > 0).length / periods.length;

    return {
        avgReturn,
        consistency: positiveRatio,
        periods: periods.length,
        periodReturns: periods
    };
}

/**
 * 蒙特卡洛模拟胜率
 * 通过打乱收益率序列模拟随机情况下的表现
 *
 * @param {Array} dailyReturns - 日收益率数组
 * @param {number} simulations - 模拟次数，默认1000
 * @returns {Object} 蒙特卡洛模拟结果
 */
function calcMonteCarloWinRate(dailyReturns, simulations = 1000) {
    const returns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    if (returns.length < 30) {
        return { winRate: 0, avgSimReturn: 0, percentile: 0 };
    }

    // 实际总收益
    const actualReturn = returns.reduce((acc, r) => acc * (1 + r), 1) - 1;

    // 蒙特卡洛模拟
    let betterCount = 0;
    const simReturns = [];

    for (let s = 0; s < simulations; s++) {
        // 随机打乱收益率序列
        const shuffled = [...returns].sort(() => Math.random() - 0.5);
        const simReturn = shuffled.reduce((acc, r) => acc * (1 + r), 1) - 1;
        simReturns.push(simReturn);

        if (actualReturn > simReturn) {
            betterCount++;
        }
    }

    const avgSimReturn = simReturns.reduce((a, b) => a + b, 0) / simulations;
    const winRate = betterCount / simulations;

    // 计算实际收益在模拟分布中的百分位
    const sortedSim = [...simReturns].sort((a, b) => a - b);
    const percentileIdx = sortedSim.findIndex(r => r >= actualReturn);
    const percentile = percentileIdx >= 0 ? percentileIdx / simulations : 1;

    return {
        winRate,
        avgSimReturn,
        percentile,
        isSignificant: winRate > 0.95  // 95%置信度
    };
}

/**
 * 计算参数稳定性
 * 评估策略对参数变化的敏感度（简化版）
 *
 * @param {Object} currentMetrics - 当前指标
 * @returns {Object} 参数稳定性评估
 */
function calcParameterStability(currentMetrics) {
    // 简化实现：基于现有指标估算稳定性
    // 真正的参数稳定性需要多次回测

    const { sharpeRatio, winRate, profitLossRatio, maxDrawdown } = currentMetrics;

    // 稳定性分数基于各指标的质量
    let score = 0;

    // 夏普比率稳定性
    if (sharpeRatio > 1) score += 25;
    else if (sharpeRatio > 0.5) score += 15;
    else if (sharpeRatio > 0) score += 5;

    // 胜率稳定性
    if (winRate > 0.4 && winRate < 0.6) score += 25;  // 适中的胜率更稳定
    else if (winRate > 0.3 && winRate < 0.7) score += 15;
    else score += 5;

    // 盈亏比稳定性
    if (profitLossRatio > 1.5 && profitLossRatio < 3) score += 25;
    else if (profitLossRatio > 1 && profitLossRatio < 5) score += 15;
    else score += 5;

    // 回撤稳定性
    if (maxDrawdown < 0.1) score += 25;
    else if (maxDrawdown < 0.2) score += 15;
    else if (maxDrawdown < 0.3) score += 5;

    return {
        stabilityScore: score,
        isStable: score >= 70,
        riskLevel: score >= 80 ? '低' : score >= 60 ? '中' : '高'
    };
}

/**
 * 估算策略寿命
 * 基于衰减率和市场变化估算策略可用时长
 *
 * @param {Object} decayInfo - 衰减率信息
 * @param {Object} stabilityInfo - 稳定性信息
 * @returns {Object} 策略寿命估算
 */
function calcStrategyLifespan(decayInfo, stabilityInfo) {
    const { decayRate, isDecaying } = decayInfo;
    const { stabilityScore } = stabilityInfo;

    // 基础寿命（月）
    let baseLifespan = 24;  // 默认2年

    // 根据衰减率调整
    if (decayRate < -0.5) baseLifespan *= 0.3;
    else if (decayRate < -0.3) baseLifespan *= 0.5;
    else if (decayRate < -0.1) baseLifespan *= 0.7;
    else if (decayRate > 0.1) baseLifespan *= 1.2;

    // 根据稳定性调整
    baseLifespan *= (stabilityScore / 100);

    return {
        estimatedMonths: Math.round(baseLifespan),
        isShortLived: baseLifespan < 6,
        confidence: stabilityScore > 70 ? '高' : stabilityScore > 50 ? '中' : '低'
    };
}

/**
 * 计算多周期年化收益（日/周/月频率）
 *
 * @param {Array} navs - 净值序列
 * @returns {Object} 多周期收益
 */
function calcMultiPeriodReturns(navs) {
    if (navs.length < 30) {
        return { daily: 0, weekly: 0, monthly: 0 };
    }

    // 日频年化（已有）
    const totalReturn = (navs[navs.length - 1].nav - navs[0].nav) / navs[0].nav;
    const dailyAnnual = Math.pow(1 + totalReturn, 252 / navs.length) - 1;

    // 周频收益（每5天采样）
    const weeklyNavs = navs.filter((_, i) => i % 5 === 0 || i === navs.length - 1);
    const weeklyReturn = weeklyNavs.length > 1 ?
        (weeklyNavs[weeklyNavs.length - 1].nav - weeklyNavs[0].nav) / weeklyNavs[0].nav : 0;
    const weeklyAnnual = Math.pow(1 + weeklyReturn, 52 / weeklyNavs.length) - 1;

    // 月频收益（每21天采样）
    const monthlyNavs = navs.filter((_, i) => i % 21 === 0 || i === navs.length - 1);
    const monthlyReturn = monthlyNavs.length > 1 ?
        (monthlyNavs[monthlyNavs.length - 1].nav - monthlyNavs[0].nav) / monthlyNavs[0].nav : 0;
    const monthlyAnnual = Math.pow(1 + monthlyReturn, 12 / monthlyNavs.length) - 1;

    return {
        daily: dailyAnnual,
        weekly: weeklyAnnual,
        monthly: monthlyAnnual,
        consistency: Math.min(dailyAnnual, weeklyAnnual, monthlyAnnual) /
                     Math.max(dailyAnnual, weeklyAnnual, monthlyAnnual, 0.0001)
    };
}

/**
 * 计算牛熊切换收益
 * 分析策略在上涨和下跌市场中的表现
 *
 * @param {Array} dailyReturns - 策略日收益率
 * @param {Array} benchmarkReturns - 基准日收益率
 * @returns {Object} 牛熊市场表现
 */
function calcBullBearReturns(dailyReturns, benchmarkReturns) {
    const sReturns = dailyReturns.map(r => typeof r === 'object' ? r.return : r);
    const bReturns = benchmarkReturns.map(r => typeof r === 'object' ? r.return : r);

    const len = Math.min(sReturns.length, bReturns.length);
    if (len < 20) {
        return { bullReturn: 0, bearReturn: 0, bullWinRate: 0, bearWinRate: 0 };
    }

    let bullDays = [], bearDays = [];
    let bullStrategyReturns = [], bearStrategyReturns = [];

    for (let i = 0; i < len; i++) {
        if (bReturns[i] > 0) {
            bullDays.push(bReturns[i]);
            bullStrategyReturns.push(sReturns[i]);
        } else if (bReturns[i] < 0) {
            bearDays.push(bReturns[i]);
            bearStrategyReturns.push(sReturns[i]);
        }
    }

    // 牛市收益
    const bullReturn = bullStrategyReturns.length > 0 ?
        bullStrategyReturns.reduce((acc, r) => acc * (1 + r), 1) - 1 : 0;
    const bullWinRate = bullStrategyReturns.length > 0 ?
        bullStrategyReturns.filter(r => r > 0).length / bullStrategyReturns.length : 0;

    // 熊市收益
    const bearReturn = bearStrategyReturns.length > 0 ?
        bearStrategyReturns.reduce((acc, r) => acc * (1 + r), 1) - 1 : 0;
    const bearWinRate = bearStrategyReturns.length > 0 ?
        bearStrategyReturns.filter(r => r > 0).length / bearStrategyReturns.length : 0;

    return {
        bullReturn,
        bearReturn,
        bullWinRate,
        bearWinRate,
        bullDays: bullDays.length,
        bearDays: bearDays.length,
        marketTiming: bullReturn > 0 && bearReturn > 0 ? '全天候' :
                      bullReturn > 0 ? '牛市策略' : bearReturn > 0 ? '熊市策略' : '需改进'
    };
}

/**
 * 计算实盘vs回测偏差（模拟）
 * 注意：真实偏差需要实盘数据，这里提供估算框架
 *
 * @param {Object} result - 回测结果
 * @returns {Object} 偏差估算
 */
function calcLiveVsBacktestDeviation(result) {
    // 估算各类偏差来源
    const slippageImpact = 0.001 * result.trades.length;  // 假设每笔0.1%滑点
    const timingImpact = 0.0005 * result.trades.length;   // 执行时机偏差
    const costImpact = result.totalTradingCost / result.initialCash;

    const totalEstimatedDeviation = slippageImpact + timingImpact + costImpact;

    return {
        estimatedDeviation: totalEstimatedDeviation,
        slippageImpact,
        timingImpact,
        costImpact,
        adjustedReturn: (result.navs[result.navs.length - 1].nav / result.navs[0].nav - 1) - totalEstimatedDeviation
    };
}

/**
 * 计算风控触发统计
 *
 * @param {Array} trades - 交易记录
 * @param {Array} navs - 净值序列
 * @param {Object} riskParams - 风控参数
 * @returns {Object} 风控触发统计
 */
function calcRiskControlTriggers(trades, navs, riskParams = {}) {
    const { maxDrawdownLimit = 0.2, maxDailyLoss = 0.05 } = riskParams;

    // 止损触发次数
    const stopLossCount = trades.filter(t => t.exitType === 'STOP_LOSS').length;

    // 最大回撤触发
    let maxDDTriggers = 0;
    let peak = navs[0].nav;
    for (let i = 1; i < navs.length; i++) {
        if (navs[i].nav > peak) peak = navs[i].nav;
        const dd = (peak - navs[i].nav) / peak;
        if (dd >= maxDrawdownLimit) maxDDTriggers++;
    }

    // 单日亏损触发
    let dailyLossTriggers = 0;
    for (let i = 1; i < navs.length; i++) {
        const dailyReturn = (navs[i].nav - navs[i-1].nav) / navs[i-1].nav;
        if (dailyReturn <= -maxDailyLoss) dailyLossTriggers++;
    }

    return {
        stopLossCount,
        maxDrawdownTriggers: maxDDTriggers,
        dailyLossTriggers,
        totalTriggers: stopLossCount + maxDDTriggers + dailyLossTriggers,
        triggerRatio: (stopLossCount + maxDDTriggers + dailyLossTriggers) / navs.length
    };
}

/**
 * 计算资金曲线偏离度
 * 测量实际净值曲线与理想直线的偏离程度
 *
 * @param {Array} navs - 净值序列
 * @returns {Object} 偏离度统计
 */
function calcEquityCurveDeviation(navs) {
    if (navs.length < 10) {
        return { deviation: 0, r2: 0, smoothness: 0 };
    }

    const n = navs.length;
    const startNav = navs[0].nav;
    const endNav = navs[n - 1].nav;

    // 理想直线：从起点到终点的线性增长
    const idealSlope = (endNav - startNav) / (n - 1);

    // 计算偏离
    let totalDeviation = 0;
    let ssTotal = 0;
    let ssResidual = 0;
    const meanNav = navs.reduce((sum, n) => sum + n.nav, 0) / n;

    for (let i = 0; i < n; i++) {
        const idealNav = startNav + idealSlope * i;
        const deviation = Math.abs(navs[i].nav - idealNav) / idealNav;
        totalDeviation += deviation;

        ssTotal += Math.pow(navs[i].nav - meanNav, 2);
        ssResidual += Math.pow(navs[i].nav - idealNav, 2);
    }

    const avgDeviation = totalDeviation / n;
    const r2 = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

    // 平滑度：相邻两天收益的相关性
    let smoothness = 0;
    if (n > 2) {
        const returns = [];
        for (let i = 1; i < n; i++) {
            returns.push((navs[i].nav - navs[i-1].nav) / navs[i-1].nav);
        }
        // 计算相邻收益的自相关
        let autoCorr = 0;
        for (let i = 1; i < returns.length; i++) {
            autoCorr += returns[i] * returns[i-1];
        }
        smoothness = Math.abs(autoCorr / (returns.length - 1));
    }

    return {
        deviation: avgDeviation,
        r2,  // R² 越接近1越线性
        smoothness,
        isSmooth: avgDeviation < 0.05 && r2 > 0.9
    };
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

    // ===== 新增指标 - 第三批 =====

    // Pain Index
    const painIndex = calcPainIndex(navs);

    // Pain Ratio
    const painRatio = calcPainRatio(annualReturn, painIndex);

    // 最大连续亏损/盈利天数
    const consecutiveDays = calcMaxConsecutiveLossDays(dailyReturns);

    // 95%最大回撤
    const drawdown95 = calcDrawdown95(navs);

    // 收益一致性
    const returnConsistency = calcReturnConsistency(monthlyReturns);

    // 滚动收益稳定性
    const rollingStability = calcRollingReturnStability(navs, 252);

    // 利润因子
    const profitFactor = calcProfitFactor(trades);

    // SQN
    const sqnStats = calcSQN(trades);

    // 平均R倍数
    const avgRMultiple = calcAvgRMultiple(trades);

    // 凯利比例
    const kellyRatio = calcKellyRatio(tradeStats.winRate, tradeStats.profitLossRatio);

    // 最长盈利/亏损周期
    const longestPeriod = calcLongestProfitLossPeriod(navs);

    // 回撤持续时间统计
    const drawdownDurationStats = calcDrawdownDurationStats(navs);

    // 风险调整交易统计
    const riskAdjustedTradeStats = calcRiskAdjustedTradeStats(trades, initialCash);

    // R倍数分布
    const rMultipleDistribution = calcRMultipleDistribution(trades);

    // Treynor比率和M²（需要基准数据）
    let treynorRatio = null;
    let m2 = null;
    let benchmarkVolatility = null;

    if (marketData && marketData.length > 0) {
        benchmarkVolatility = calcBenchmarkVolatility(marketData);
        treynorRatio = calcTreynorRatio(annualReturn, beta);
        m2 = calcM2(sharpeRatio, benchmarkVolatility);
    }

    // ===== 新增指标 - 第四批 =====

    // 波动率偏度
    const volatilitySkew = calcVolatilitySkew(dailyReturns);

    // 不同无风险利率的夏普比率
    const sharpeRatio4Pct = calcSharpeWithRf(annualReturn, annualVolatility, 0.04);

    // Jensen's Alpha
    let jensensAlpha = null;
    let annualExcessReturn = null;
    if (marketData && marketData.length > 0 && benchmarkStats) {
        jensensAlpha = calcJensensAlpha(annualReturn, benchmarkStats.annualReturn, beta);
        annualExcessReturn = calcAnnualExcessReturn(annualReturn, benchmarkStats.annualReturn);
    }

    // 年化换手率
    const annualTurnover = calcAnnualTurnover(trades, avgNav, tradingDays);

    // 单次调仓换手
    const singleRebalanceTurnover = calcSingleRebalanceTurnover(trades, avgNav);

    // 交易成本率
    const tradingCostRate = calcTradingCostRate(result.totalTradingCost || 0, initialCash);

    // 滑点率
    const slippageStats = calcSlippageRate(trades, 0);

    // 市场冲击成本
    const marketImpact = marketData ? calcMarketImpact(trades, marketData) : { avgImpact: 0, maxImpact: 0, impactCost: 0 };

    // 策略容量
    const strategyCapacity = marketData ? calcStrategyCapacity(trades, marketData) : { capacityYi: 0, avgDailyVolume: 0 };

    // 日均成交额占比
    const volumeRatioStats = marketData ? calcVolumeRatio(trades, marketData) : { avgRatio: 0, maxRatio: 0, minRatio: 0 };

    // 流动性分数
    const liquidityScore = marketData ? calcLiquidityScore(marketData) : { score: 0, avgSpread: 0, avgVolume: 0, volumeStability: 0 };

    // 持仓集中度（单标的策略）
    const concentration = calcConcentration(null);

    // 流通市值下限
    const avgTradeSize = trades.length > 0 ?
        trades.reduce((sum, t) => sum + (t.cost || 0), 0) / trades.length : 0;
    const marketCapFloor = marketData ? calcMarketCapFloor(marketData, avgTradeSize) : { floorYi: 0, currentEstimate: 0 };

    // 年化衰减率
    const decayRate = calcAnnualDecayRate(navs);

    // 样本内外收益比
    const inOutSampleRatio = calcInOutSampleRatio(navs);

    // Walk-Forward收益
    const walkForwardStats = calcWalkForwardReturn(navs);

    // 蒙特卡洛模拟（减少模拟次数以提高性能）
    const monteCarloStats = calcMonteCarloWinRate(dailyReturns, 500);

    // 参数稳定性评估
    const parameterStability = calcParameterStability({
        sharpeRatio,
        winRate: tradeStats.winRate,
        profitLossRatio: tradeStats.profitLossRatio,
        maxDrawdown: drawdownInfo.maxDrawdown
    });

    // 策略寿命估算
    const strategyLifespan = calcStrategyLifespan(decayRate, parameterStability);

    // 多周期年化收益
    const multiPeriodReturns = calcMultiPeriodReturns(navs);

    // 牛熊切换收益
    let bullBearReturns = { bullReturn: 0, bearReturn: 0, bullWinRate: 0, bearWinRate: 0, marketTiming: '-' };
    if (marketData && marketData.length > 0) {
        const benchmarkReturns = calcBenchmarkDailyReturns(marketData);
        bullBearReturns = calcBullBearReturns(dailyReturns, benchmarkReturns);
    }

    // 实盘vs回测偏差估算
    const liveVsBacktestDeviation = calcLiveVsBacktestDeviation(result);

    // 风控触发统计
    const riskControlTriggers = calcRiskControlTriggers(trades, navs);

    // 资金曲线偏离度
    const equityCurveDeviation = calcEquityCurveDeviation(navs);

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
        drawdown95,
        painIndex,

        // ===== 回撤持续时间 =====
        avgDrawdownDuration: drawdownDurationStats.avgDrawdownDuration,
        maxDrawdownDuration: drawdownDurationStats.maxDrawdownDuration,
        drawdownCount: drawdownDurationStats.drawdownCount,

        // ===== 最大单日涨跌 =====
        maxDailyGain: maxDailyReturn.maxGain,
        maxDailyGainDate: maxDailyReturn.maxGainDate,
        maxDailyLoss: maxDailyReturn.maxLoss,
        maxDailyLossDate: maxDailyReturn.maxLossDate,

        // ===== 连续盈亏天数 =====
        maxConsecutiveLossDays: consecutiveDays.maxLossDays,
        maxConsecutiveWinDays: consecutiveDays.maxWinDays,

        // ===== 最长盈亏周期 =====
        longestProfitPeriod: longestPeriod.longestProfitPeriod,
        longestLossPeriod: longestPeriod.longestLossPeriod,
        profitPeriodStart: longestPeriod.profitPeriodStart,
        profitPeriodEnd: longestPeriod.profitPeriodEnd,
        lossPeriodStart: longestPeriod.lossPeriodStart,
        lossPeriodEnd: longestPeriod.lossPeriodEnd,

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
        painRatio,
        treynorRatio,
        m2,

        // ===== 交易统计 =====
        ...tradeStats,

        // ===== 交易质量指标 =====
        profitFactor,
        sqn: sqnStats.sqn,
        avgRMultiple,
        kellyRatio,
        maxR: rMultipleDistribution.maxR,
        minR: rMultipleDistribution.minR,

        // ===== 风险调整交易统计 =====
        avgTradeReturn: riskAdjustedTradeStats.avgTradeReturn,
        tradeReturnStdDev: riskAdjustedTradeStats.tradeReturnStdDev,
        tradeReturnSharpe: riskAdjustedTradeStats.tradeReturnSharpe,

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

        // ===== 稳定性指标 =====
        returnConsistency,
        rollingReturnStability: rollingStability.stability,
        avgRollingReturn: rollingStability.avgRollingReturn,

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
        benchmarkVolatility,

        // ===== 滚动指标 =====
        rollingSharpe,

        // ===== 回撤事件 =====
        drawdownPeriods,

        // ===== 日收益率序列（用于导出）=====
        dailyReturns,

        // ===== 第四批新增指标 =====

        // ----- 波动率分析 -----
        volatilitySkew,                    // 波动率偏度（上涨/下跌波动比）
        sharpeRatio4Pct,                   // Sharpe（4%无风险利率）

        // ----- Jensen's Alpha -----
        jensensAlpha,                      // Jensen's Alpha（CAPM超额收益）
        annualExcessReturn,                // 年化超额收益

        // ----- 换手率指标 -----
        annualTurnover,                    // 年化换手率
        avgRebalanceTurnover: singleRebalanceTurnover.avgTurnover,   // 平均单次换手
        maxRebalanceTurnover: singleRebalanceTurnover.maxTurnover,   // 最大单次换手

        // ----- 交易成本指标 -----
        tradingCostRate,                   // 交易成本率
        configuredSlippage: slippageStats.configuredSlippage,       // 配置滑点率
        estimatedSlippage: slippageStats.estimatedSlippage,         // 估算总滑点

        // ----- 市场冲击与容量 -----
        avgMarketImpact: marketImpact.avgImpact,                    // 平均市场冲击
        maxMarketImpact: marketImpact.maxImpact,                    // 最大市场冲击
        strategyCapacityYi: strategyCapacity.capacityYi,            // 策略容量（亿元）
        avgDailyVolume: strategyCapacity.avgDailyVolume,            // 日均成交额

        // ----- 成交额占比 -----
        avgVolumeRatio: volumeRatioStats.avgRatio,                  // 平均成交额占比
        maxVolumeRatio: volumeRatioStats.maxRatio,                  // 最大成交额占比

        // ----- 流动性指标 -----
        liquidityScore: liquidityScore.score,                       // 流动性分数(0-100)
        avgSpread: liquidityScore.avgSpread,                        // 平均价差
        volumeStability: liquidityScore.volumeStability,            // 成交量稳定性

        // ----- 持仓集中度 -----
        hhi: concentration.hhi,                                     // HHI指数
        top10Ratio: concentration.top10Ratio,                       // 前10持仓占比
        effectiveN: concentration.effectiveN,                       // 有效持仓数
        isConcentrated: concentration.isConcentrated,               // 是否高集中度

        // ----- 市值下限 -----
        marketCapFloorYi: marketCapFloor.floorYi,                   // 流通市值下限（亿）
        currentMarketCapYi: marketCapFloor.currentEstimate,         // 当前估算市值（亿）

        // ----- 策略衰减分析 -----
        decayRate: decayRate.decayRate,                             // 年化衰减率
        firstHalfReturn: decayRate.firstHalfReturn,                 // 前半段年化
        secondHalfReturn: decayRate.secondHalfReturn,               // 后半段年化
        isDecaying: decayRate.isDecaying,                           // 是否衰减

        // ----- 样本内外分析 -----
        inOutSampleRatio: inOutSampleRatio.ratio,                   // 样本内外收益比
        inSampleReturn: inOutSampleRatio.inSampleReturn,            // 样本内收益
        outSampleReturn: inOutSampleRatio.outSampleReturn,          // 样本外收益
        isOverfit: inOutSampleRatio.isOverfit,                      // 是否过拟合

        // ----- Walk-Forward分析 -----
        walkForwardAvgReturn: walkForwardStats.avgReturn,           // WF平均收益
        walkForwardConsistency: walkForwardStats.consistency,       // WF一致性
        walkForwardPeriods: walkForwardStats.periods,               // WF周期数

        // ----- 蒙特卡洛模拟 -----
        monteCarloWinRate: monteCarloStats.winRate,                 // MC胜率
        monteCarloPercentile: monteCarloStats.percentile,           // MC百分位
        isStatisticallySignificant: monteCarloStats.isSignificant,  // 统计显著性

        // ----- 参数稳定性 -----
        parameterStabilityScore: parameterStability.stabilityScore, // 参数稳定性分数
        isStable: parameterStability.isStable,                      // 是否稳定
        riskLevel: parameterStability.riskLevel,                    // 风险等级

        // ----- 策略寿命估算 -----
        estimatedLifespanMonths: strategyLifespan.estimatedMonths,  // 估算寿命（月）
        isShortLived: strategyLifespan.isShortLived,                // 是否短命
        lifespanConfidence: strategyLifespan.confidence,            // 置信度

        // ----- 多周期年化 -----
        dailyAnnualReturn: multiPeriodReturns.daily,                // 日频年化
        weeklyAnnualReturn: multiPeriodReturns.weekly,              // 周频年化
        monthlyAnnualReturn: multiPeriodReturns.monthly,            // 月频年化
        multiPeriodConsistency: multiPeriodReturns.consistency,     // 多周期一致性

        // ----- 牛熊市表现 -----
        bullReturn: bullBearReturns.bullReturn,                     // 牛市收益
        bearReturn: bullBearReturns.bearReturn,                     // 熊市收益
        bullWinRate: bullBearReturns.bullWinRate,                   // 牛市胜率
        bearWinRate: bullBearReturns.bearWinRate,                   // 熊市胜率
        bullDays: bullBearReturns.bullDays,                         // 牛市天数
        bearDays: bullBearReturns.bearDays,                         // 熊市天数
        marketTiming: bullBearReturns.marketTiming,                 // 市场择时能力

        // ----- 实盘vs回测偏差 -----
        estimatedLiveDeviation: liveVsBacktestDeviation.estimatedDeviation,  // 估算偏差
        slippageImpact: liveVsBacktestDeviation.slippageImpact,              // 滑点影响
        timingImpact: liveVsBacktestDeviation.timingImpact,                  // 时机影响
        adjustedReturn: liveVsBacktestDeviation.adjustedReturn,              // 调整后收益

        // ----- 风控触发统计 -----
        stopLossTriggers: riskControlTriggers.stopLossCount,                 // 止损触发次数
        maxDrawdownTriggers: riskControlTriggers.maxDrawdownTriggers,        // 最大回撤触发
        dailyLossTriggers: riskControlTriggers.dailyLossTriggers,            // 单日亏损触发
        totalRiskTriggers: riskControlTriggers.totalTriggers,                // 总风控触发
        riskTriggerRatio: riskControlTriggers.triggerRatio,                  // 风控触发比例

        // ----- 资金曲线偏离度 -----
        equityCurveDeviation: equityCurveDeviation.deviation,                // 曲线偏离度
        equityCurveR2: equityCurveDeviation.r2,                              // R²拟合度
        equityCurveSmoothness: equityCurveDeviation.smoothness,              // 曲线平滑度
        isEquityCurveSmooth: equityCurveDeviation.isSmooth                   // 是否平滑
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
    // 第二批导出
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
    // 第三批导出
    calcTreynorRatio,
    calcM2,
    calcPainIndex,
    calcPainRatio,
    calcMaxConsecutiveLossDays,
    calcDrawdown95,
    calcReturnConsistency,
    calcRollingReturnStability,
    calcProfitFactor,
    calcSQN,
    calcAvgRMultiple,
    calcKellyRatio,
    calcLongestProfitLossPeriod,
    calcBenchmarkVolatility,
    calcRMultipleDistribution,
    calcDrawdownDurationStats,
    calcRiskAdjustedTradeStats,
    // 第四批导出
    calcVolatilitySkew,
    calcSharpeWithRf,
    calcJensensAlpha,
    calcAnnualExcessReturn,
    calcAnnualTurnover,
    calcSingleRebalanceTurnover,
    calcTradingCostRate,
    calcSlippageRate,
    calcMarketImpact,
    calcStrategyCapacity,
    calcVolumeRatio,
    calcLiquidityScore,
    calcConcentration,
    calcMarketCapFloor,
    calcAnnualDecayRate,
    calcInOutSampleRatio,
    calcWalkForwardReturn,
    calcMonteCarloWinRate,
    calcParameterStability,
    calcStrategyLifespan,
    calcMultiPeriodReturns,
    calcBullBearReturns,
    calcLiveVsBacktestDeviation,
    calcRiskControlTriggers,
    calcEquityCurveDeviation,
    generateMetrics
};
