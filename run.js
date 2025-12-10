// run.js
// ============================================
// 主程序入口 - 运行回测并输出完整业绩报告  
// ============================================
//
// 使用方法：
//   node run.js
//
// 功能：
// 1. 从腾讯财经API获取A股历史数据
// 2. 使用MA+ATR策略进行回测
// 3. 计算并输出完整业绩指标
// 4. 生成净值曲线、成交记录、滚动夏普等CSV文件
//

// ========== 引入依赖模块 ==========
const fs = require("fs");       // Node.js 文件系统模块，用于写入报告文件
const path = require("path");   // Node.js 路径模块，用于处理文件路径

// 引入自定义模块
const backtest = require("./engine/backtest");        // 回测引擎
const MaAtr = require("./strategies/maAtr");          // MA+ATR 策略
const { getStockHistory } = require("./data/index");  // 数据获取函数
const { generateMetrics } = require("./utils/metrics"); // 业绩指标计算

// ========== 主程序（使用 IIFE + async/await） ==========
// IIFE: Immediately Invoked Function Expression（立即执行函数表达式）
// 用于在顶层使用 async/await 语法
(async () => {
    // ========== 配置区域 ==========
    // 在这里修改要回测的股票和参数

    // 股票代码（6位数字）
    // 例如：'000001'=平安银行, '600519'=贵州茅台, '300750'=宁德时代
    const STOCK_CODE = '600383';

    // 回测数据天数
    // 获取最近多少个交易日的数据
    const DAYS = 365 * 5;

    // ========== 第一步：获取历史数据 ==========
    console.log(`🚀 开始拉取 [${STOCK_CODE}] 最近 ${DAYS} 天数据...`);

    // 调用数据模块获取K线数据
    // 这是一个异步操作，需要等待网络请求完成
    const data = await getStockHistory(STOCK_CODE, DAYS);

    // ========== 第二步：数据有效性检查 ==========
    // 如果数据获取失败（网络错误或股票代码错误），提前退出
    if (!data || data.length === 0) {
        console.log("❌ 数据获取失败，请检查网络或股票代码。");
        return;  // 退出程序
    }

    // 打印数据获取成功信息
    // data[data.length - 1] 是最新的一根K线
    console.log(`✅ 获取成功! 样本数: ${data.length} 条 (最新日期: ${data[data.length - 1].date})`);

    // ========== 第三步：执行回测 ==========
    // 调用回测引擎，传入：数据、策略类、配置参数
    const result = backtest(data, MaAtr, {
        initialCash: 100000,  // 初始资金10万元
        strategyConfig: {
            fast: 5,           // 5日快速均线（比默认10更灵敏）
            slow: 20,          // 20日慢速均线
            atrPeriod: 14,     // 14日ATR
            atrMultiplier: 2.5, // 止损距离 = 2.5倍ATR
            riskPct: 0.02      // 每笔交易风险2%（比默认1%更激进）
        }
    });

    // ========== 第四步：计算完整业绩指标 ==========
    // 传入市场数据用于计算Alpha/Beta等基准对比指标
    const metrics = generateMetrics(result, data);

    // ========== 第五步：生成报告文件 ==========
    // 创建 report 目录（如果不存在）
    const reportDir = path.join(__dirname, "report");
    if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir);
    }

    // ----- 5.1 生成净值曲线 CSV -----
    const navCsv = ["date,nav"];
    result.navs.forEach(n => {
        navCsv.push(`${n.date},${n.nav.toFixed(4)}`);
    });
    fs.writeFileSync(path.join(reportDir, "nav.csv"), navCsv.join("\n"));

    // ----- 5.2 生成成交记录 CSV -----
    if (result.trades.length > 0) {
        const tradesCsv = [
            "交易编号,入场日期,入场价格,股数,止损价,出场日期,出场价格,出场类型,盈亏金额,盈亏比例,持仓天数"
        ];
        result.trades.forEach(t => {
            tradesCsv.push([
                t.tradeNo,
                t.entryDate,
                t.entryPrice.toFixed(2),
                t.shares,
                t.stopPrice ? t.stopPrice.toFixed(2) : '-',
                t.exitDate,
                t.exitPrice ? t.exitPrice.toFixed(2) : '-',
                t.exitType === 'STOP_LOSS' ? '止损' : t.exitType === 'SIGNAL' ? '信号' : '未平仓',
                t.pnl ? t.pnl.toFixed(2) : '-',
                t.pnlPct ? (t.pnlPct * 100).toFixed(2) + '%' : '-',
                t.holdingDays || '-'
            ].join(","));
        });
        fs.writeFileSync(path.join(reportDir, "trades.csv"), tradesCsv.join("\n"));
    }

    // ----- 5.3 生成滚动夏普 CSV -----
    if (metrics.rollingSharpe.length > 0) {
        const sharpeCsv = ["date,rolling_sharpe_60d"];
        metrics.rollingSharpe.forEach(s => {
            sharpeCsv.push(`${s.date},${s.sharpe.toFixed(4)}`);
        });
        fs.writeFileSync(path.join(reportDir, "rolling_sharpe.csv"), sharpeCsv.join("\n"));
    }

    // ----- 5.4 生成回撤恢复期 CSV -----
    if (metrics.drawdownPeriods.length > 0) {
        const ddCsv = ["峰值日期,谷值日期,最大回撤,恢复日期,回撤天数,恢复天数"];
        metrics.drawdownPeriods.forEach(p => {
            ddCsv.push([
                p.peakDate,
                p.troughDate,
                (p.maxDrawdown * 100).toFixed(2) + '%',
                p.recoveryDate,
                p.drawdownDays,
                p.recoveryDays !== null ? p.recoveryDays : '未恢复'
            ].join(","));
        });
        fs.writeFileSync(path.join(reportDir, "drawdown_periods.csv"), ddCsv.join("\n"));
    }

    // ----- 5.5 生成月度收益 CSV -----
    if (metrics.monthlyReturns.length > 0) {
        const monthlyCsv = ["月份,收益率,期初净值,期末净值"];
        metrics.monthlyReturns.forEach(m => {
            monthlyCsv.push([
                m.month,
                (m.return * 100).toFixed(2) + '%',
                m.startNav.toFixed(2),
                m.endNav.toFixed(2)
            ].join(","));
        });
        fs.writeFileSync(path.join(reportDir, "monthly_returns.csv"), monthlyCsv.join("\n"));
    }

    // ----- 5.6 生成年度收益 CSV -----
    if (metrics.yearlyReturns.length > 0) {
        const yearlyCsv = ["年份,收益率,期初净值,期末净值"];
        metrics.yearlyReturns.forEach(y => {
            yearlyCsv.push([
                y.year,
                (y.return * 100).toFixed(2) + '%',
                y.startNav.toFixed(2),
                y.endNav.toFixed(2)
            ].join(","));
        });
        fs.writeFileSync(path.join(reportDir, "yearly_returns.csv"), yearlyCsv.join("\n"));
    }

    // ----- 5.7 生成季度收益 CSV -----
    if (metrics.quarterlyReturns && metrics.quarterlyReturns.length > 0) {
        const quarterlyCsv = ["季度,收益率,期初净值,期末净值"];
        metrics.quarterlyReturns.forEach(q => {
            quarterlyCsv.push([
                q.quarter,
                (q.return * 100).toFixed(2) + '%',
                q.startNav.toFixed(2),
                q.endNav.toFixed(2)
            ].join(","));
        });
        fs.writeFileSync(path.join(reportDir, "quarterly_returns.csv"), quarterlyCsv.join("\n"));
    }

    // ========== 第六步：打印完整业绩报告 ==========
    console.log("\n");
    console.log("╔════════════════════════════════════════════════════════════════╗");
    console.log("║                       📊 回测业绩报告                          ║");
    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 基本信息 -----
    console.log("║ 【基本信息】                                                   ║");
    console.log(`║   标的代码: ${STOCK_CODE.padEnd(50)}║`);
    console.log(`║   回测区间: ${data[0].date} ~ ${data[data.length - 1].date}              ║`);
    console.log(`║   交易日数: ${String(metrics.tradingDays).padEnd(50)}║`);
    console.log(`║   初始资金: ${formatNumber(result.initialCash).padEnd(50)}║`);
    console.log(`║   期末净值: ${formatNumber(result.navs[result.navs.length - 1].nav).padEnd(50)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 交易成本 -----
    console.log("║ 【交易成本】                                                   ║");
    console.log(`║   总手续费: ${formatNumber(result.totalCommission).padEnd(50)}║`);
    console.log(`║   总印花税: ${formatNumber(result.totalStampTax).padEnd(50)}║`);
    console.log(`║   总交易成本: ${formatNumber(result.totalTradingCost).padEnd(48)}║`);
    console.log(`║   成本占比: ${formatPercent(result.totalTradingCost / result.initialCash).padEnd(50)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 收益指标 -----
    console.log("║ 【收益指标】                                                   ║");
    console.log(`║   总收益率: ${formatPercent(metrics.totalReturn).padEnd(50)}║`);
    console.log(`║   年化收益率: ${formatPercent(metrics.annualReturn).padEnd(48)}║`);
    console.log(`║   日均收益率: ${formatPercent(metrics.dailyAvgReturn).padEnd(48)}║`);
    console.log(`║   收益率中位数: ${formatPercent(metrics.medianReturn).padEnd(46)}║`);
    console.log(`║   历史最高收益: ${formatPercent(metrics.peakReturn)} (${metrics.peakReturnDate || '-'})`.padEnd(62) + "║");
    console.log(`║   超额收益率: ${formatPercent(metrics.excessReturn).padEnd(48)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 风险指标 -----
    console.log("║ 【风险指标】                                                   ║");
    console.log(`║   年化波动率: ${formatPercent(metrics.annualVolatility).padEnd(48)}║`);
    console.log(`║   下行波动率: ${formatPercent(metrics.downsideVolatility).padEnd(48)}║`);
    console.log(`║   收益率标准差: ${formatPercent(metrics.returnStdDev).padEnd(46)}║`);
    console.log(`║   最大回撤: ${formatPercent(metrics.maxDrawdown).padEnd(50)}║`);
    console.log(`║   95%回撤: ${formatPercent(metrics.drawdown95).padEnd(51)}║`);
    console.log(`║   平均回撤: ${formatPercent(metrics.averageDrawdown).padEnd(50)}║`);
    console.log(`║   Pain Index: ${formatPercent(metrics.painIndex).padEnd(48)}║`);
    console.log(`║   水下时间比例: ${formatPercent(metrics.underwaterRatio).padEnd(46)}║`);
    console.log(`║   回撤峰值日: ${(metrics.drawdownPeakDate || '-').padEnd(48)}║`);
    console.log(`║   回撤谷值日: ${(metrics.drawdownTroughDate || '-').padEnd(48)}║`);
    console.log(`║   回撤恢复日: ${String(metrics.drawdownRecoveryDate || '-').padEnd(48)}║`);
    console.log(`║   回撤持续天数: ${String(metrics.drawdownDays || '-').padEnd(46)}║`);
    console.log(`║   恢复所需天数: ${String(metrics.recoveryDays !== null ? metrics.recoveryDays : '未恢复').padEnd(46)}║`);
    console.log(`║   平均回撤持续: ${String(metrics.avgDrawdownDuration ? metrics.avgDrawdownDuration.toFixed(1) : '-').padEnd(46)}║`);
    console.log(`║   最长回撤持续: ${String(metrics.maxDrawdownDuration || '-').padEnd(46)}║`);
    console.log(`║   回撤次数: ${String(metrics.drawdownCount || '-').padEnd(50)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 最大单日涨跌 -----
    console.log("║ 【最大单日涨跌】                                               ║");
    console.log(`║   最大单日盈利: ${formatPercent(metrics.maxDailyGain)} (${metrics.maxDailyGainDate || '-'})`.padEnd(62) + "║");
    console.log(`║   最大单日亏损: ${formatPercent(metrics.maxDailyLoss)} (${metrics.maxDailyLossDate || '-'})`.padEnd(62) + "║");
    console.log(`║   最大连续盈利天数: ${String(metrics.maxConsecutiveWinDays || 0).padEnd(42)}║`);
    console.log(`║   最大连续亏损天数: ${String(metrics.maxConsecutiveLossDays || 0).padEnd(42)}║`);
    console.log(`║   最长盈利周期: ${String(metrics.longestProfitPeriod || 0)} 天`.padEnd(53) + "║");
    console.log(`║   最长亏损周期: ${String(metrics.longestLossPeriod || 0)} 天`.padEnd(53) + "║");

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 风险调整收益 -----
    console.log("║ 【风险调整收益】                                               ║");
    console.log(`║   夏普比率 (Sharpe): ${formatRatio(metrics.sharpeRatio).padEnd(41)}║`);
    console.log(`║   索提诺比率 (Sortino): ${formatRatio(metrics.sortinoRatio).padEnd(38)}║`);
    console.log(`║   卡尔玛比率 (Calmar): ${formatRatio(metrics.calmarRatio).padEnd(39)}║`);
    console.log(`║   收益回撤比: ${formatRatio(metrics.returnDrawdownRatio).padEnd(48)}║`);
    console.log(`║   Omega比率: ${formatRatio(metrics.omegaRatio).padEnd(49)}║`);
    console.log(`║   Gain-to-Pain: ${formatRatio(metrics.gainToPainRatio).padEnd(45)}║`);
    console.log(`║   Tail比率: ${formatRatio(metrics.tailRatio).padEnd(50)}║`);
    console.log(`║   Sterling比率: ${formatRatio(metrics.sterlingRatio).padEnd(46)}║`);
    console.log(`║   Burke比率: ${formatRatio(metrics.burkeRatio).padEnd(49)}║`);
    console.log(`║   Pain比率: ${formatRatio(metrics.painRatio).padEnd(50)}║`);
    console.log(`║   Treynor比率: ${formatRatio(metrics.treynorRatio).padEnd(47)}║`);
    console.log(`║   M² (Modigliani): ${formatPercent(metrics.m2).padEnd(43)}║`);
    console.log(`║   Ulcer Index: ${formatRatio(metrics.ulcerIndex).padEnd(47)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- VaR风险指标 -----
    console.log("║ 【VaR风险指标】                                                ║");
    console.log(`║   VaR(95%): ${formatPercent(metrics.var95).padEnd(50)}║`);
    console.log(`║   VaR(99%): ${formatPercent(metrics.var99).padEnd(50)}║`);
    console.log(`║   CVaR(95%): ${formatPercent(metrics.cvar95).padEnd(49)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 交易统计 -----
    console.log("║ 【交易统计】                                                   ║");
    console.log(`║   总交易次数: ${String(metrics.totalTrades).padEnd(48)}║`);
    console.log(`║   盈利次数: ${String(metrics.winTrades).padEnd(50)}║`);
    console.log(`║   亏损次数: ${String(metrics.loseTrades).padEnd(50)}║`);
    console.log(`║   胜率: ${formatPercent(metrics.winRate).padEnd(54)}║`);
    console.log(`║   止损出场次数: ${String(metrics.stopLossCount).padEnd(46)}║`);
    console.log(`║   信号出场次数: ${String(metrics.signalExitCount).padEnd(46)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 盈亏分析 -----
    console.log("║ 【盈亏分析】                                                   ║");
    console.log(`║   平均盈利金额: ${formatNumber(metrics.avgWin).padEnd(46)}║`);
    console.log(`║   平均亏损金额: ${formatNumber(metrics.avgLoss).padEnd(46)}║`);
    console.log(`║   平均盈利比例: ${formatPercent(metrics.avgWinPct).padEnd(46)}║`);
    console.log(`║   平均亏损比例: ${formatPercent(metrics.avgLossPct).padEnd(46)}║`);
    console.log(`║   盈亏比: ${formatRatio(metrics.profitLossRatio).padEnd(52)}║`);
    console.log(`║   单笔期望值: ${formatNumber(metrics.expectancy).padEnd(48)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 交易质量指标 -----
    console.log("║ 【交易质量指标】                                               ║");
    console.log(`║   利润因子: ${formatRatio(metrics.profitFactor).padEnd(50)}║`);
    console.log(`║   系统质量数(SQN): ${formatRatio(metrics.sqn).padEnd(43)}║`);
    console.log(`║   平均R倍数: ${formatRatio(metrics.avgRMultiple).padEnd(49)}║`);
    console.log(`║   最大R倍数: ${formatRatio(metrics.maxR).padEnd(49)}║`);
    console.log(`║   最小R倍数: ${formatRatio(metrics.minR).padEnd(49)}║`);
    console.log(`║   凯利比例: ${formatPercent(metrics.kellyRatio).padEnd(50)}║`);
    console.log(`║   交易收益夏普: ${formatRatio(metrics.tradeReturnSharpe).padEnd(46)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 连续盈亏 -----
    console.log("║ 【连续盈亏统计】                                               ║");
    console.log(`║   最大连续盈利次数: ${String(metrics.maxConsecutiveWins).padEnd(42)}║`);
    console.log(`║   最大连续亏损次数: ${String(metrics.maxConsecutiveLosses).padEnd(42)}║`);
    console.log(`║   最大连续亏损金额: ${formatNumber(metrics.maxConsecutiveLossAmount).padEnd(42)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 极值统计 -----
    console.log("║ 【极值统计】                                                   ║");
    console.log(`║   最大单笔盈利: ${formatNumber(metrics.maxWin)} (${formatPercent(metrics.maxWinPct)})`.padEnd(65) + "║");
    console.log(`║   最大单笔亏损: ${formatNumber(metrics.maxLoss)} (${formatPercent(metrics.maxLossPct)})`.padEnd(65) + "║");
    console.log(`║   平均持仓天数: ${metrics.avgHoldingDays.toFixed(1)}`.padEnd(65) + "║");

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 盈亏天数 -----
    console.log("║ 【盈亏天数统计】                                               ║");
    console.log(`║   盈利天数: ${String(metrics.profitDays).padEnd(50)}║`);
    console.log(`║   亏损天数: ${String(metrics.lossDays).padEnd(50)}║`);
    console.log(`║   持平天数: ${String(metrics.flatDays).padEnd(50)}║`);
    console.log(`║   盈利天数占比: ${formatPercent(metrics.profitDaysRatio).padEnd(46)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 交易频率 -----
    console.log("║ 【交易频率】                                                   ║");
    console.log(`║   年均交易次数: ${metrics.tradesPerYear.toFixed(1).padEnd(46)}║`);
    console.log(`║   月均交易次数: ${metrics.tradesPerMonth.toFixed(1).padEnd(46)}║`);
    console.log(`║   平均交易间隔: ${metrics.avgDaysBetweenTrades.toFixed(1)} 天`.padEnd(57) + "║");
    console.log(`║   资金利用率: ${formatPercent(metrics.capitalUtilization).padEnd(48)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 收益分布特征 -----
    console.log("║ 【收益分布特征】                                               ║");
    console.log(`║   偏度 (Skewness): ${formatRatio(metrics.skewness).padEnd(43)}║`);
    console.log(`║   峰度 (Kurtosis): ${formatRatio(metrics.kurtosis).padEnd(43)}║`);
    console.log(`║   月度胜率: ${formatPercent(metrics.monthlyWinRate).padEnd(50)}║`);
    console.log(`║   周度胜率: ${formatPercent(metrics.weeklyWinRate).padEnd(50)}║`);
    console.log(`║   正收益天数占比: ${formatPercent(metrics.positiveReturnRatio).padEnd(44)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 稳定性指标 -----
    console.log("║ 【稳定性指标】                                                 ║");
    console.log(`║   收益一致性: ${formatPercent(metrics.returnConsistency).padEnd(48)}║`);
    console.log(`║   滚动收益稳定性: ${formatPercent(metrics.rollingReturnStability).padEnd(44)}║`);
    console.log(`║   平均滚动收益: ${formatPercent(metrics.avgRollingReturn).padEnd(46)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 持仓天数统计 -----
    console.log("║ 【持仓天数统计】                                               ║");
    console.log(`║   最长持仓天数: ${String(metrics.maxHoldingDays || '-').padEnd(46)}║`);
    console.log(`║   最短持仓天数: ${String(metrics.minHoldingDays || '-').padEnd(46)}║`);
    console.log(`║   平均持仓天数: ${metrics.avgHoldingDays ? metrics.avgHoldingDays.toFixed(1) : '-'}`.padEnd(65) + "║");

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 资金效率 -----
    console.log("║ 【资金效率】                                                   ║");
    console.log(`║   单笔最大投入: ${formatNumber(metrics.maxTradeSize).padEnd(46)}║`);
    console.log(`║   换手率: ${formatRatio(metrics.turnoverRate).padEnd(52)}║`);
    console.log(`║   空仓天数: ${String(metrics.emptyDays || '-').padEnd(50)}║`);
    console.log(`║   空仓比例: ${formatPercent(metrics.emptyRatio).padEnd(50)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 月度极值 -----
    console.log("║ 【月度极值】                                                   ║");
    console.log(`║   最佳月份: ${(metrics.bestMonth || '-').padEnd(50)}║`);
    console.log(`║   最佳月收益: ${formatPercent(metrics.bestMonthReturn).padEnd(48)}║`);
    console.log(`║   最差月份: ${(metrics.worstMonth || '-').padEnd(50)}║`);
    console.log(`║   最差月收益: ${formatPercent(metrics.worstMonthReturn).padEnd(48)}║`);
    console.log(`║   最大连续盈利月数: ${String(metrics.maxConsecutiveWinMonths || 0).padEnd(42)}║`);
    console.log(`║   最大连续亏损月数: ${String(metrics.maxConsecutiveLossMonths || 0).padEnd(42)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 去除极端值收益 -----
    console.log("║ 【去除极端值收益】(排除最好/最差各5天)                         ║");
    console.log(`║   调整后总收益: ${formatPercent(metrics.trimmedTotalReturn).padEnd(46)}║`);
    console.log(`║   调整后日均收益: ${formatPercent(metrics.trimmedAvgReturn).padEnd(44)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- Alpha/Beta分析 -----
    console.log("║ 【Alpha/Beta分析】(相对买入持有基准)                           ║");
    if (metrics.benchmarkStats) {
        console.log(`║   基准总收益率: ${formatPercent(metrics.benchmarkStats.totalReturn).padEnd(46)}║`);
        console.log(`║   基准年化收益: ${formatPercent(metrics.benchmarkStats.annualReturn).padEnd(46)}║`);
    }
    console.log(`║   Alpha: ${formatPercent(metrics.alpha).padEnd(53)}║`);
    console.log(`║   Beta: ${formatRatio(metrics.beta).padEnd(54)}║`);
    console.log(`║   信息比率 (IR): ${formatRatio(metrics.informationRatio).padEnd(45)}║`);
    console.log(`║   相关系数: ${formatRatio(metrics.correlation).padEnd(50)}║`);
    console.log(`║   Jensen's Alpha: ${formatPercent(metrics.jensensAlpha).padEnd(44)}║`);
    console.log(`║   年化超额收益: ${formatPercent(metrics.annualExcessReturn).padEnd(46)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 波动率分析 -----
    console.log("║ 【波动率分析】                                                 ║");
    console.log(`║   波动率偏度: ${formatRatio(metrics.volatilitySkew).padEnd(48)}║`);
    console.log(`║   Sharpe(4%无风险): ${formatRatio(metrics.sharpeRatio4Pct).padEnd(42)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 换手率与成本 -----
    console.log("║ 【换手率与成本】                                               ║");
    console.log(`║   年化换手率: ${formatRatio(metrics.annualTurnover).padEnd(48)}║`);
    console.log(`║   平均单次换手: ${formatPercent(metrics.avgRebalanceTurnover).padEnd(46)}║`);
    console.log(`║   最大单次换手: ${formatPercent(metrics.maxRebalanceTurnover).padEnd(46)}║`);
    console.log(`║   交易成本率: ${formatPercent(metrics.tradingCostRate).padEnd(48)}║`);
    console.log(`║   估算总滑点: ${formatPercent(metrics.estimatedSlippage).padEnd(48)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 市场冲击与容量 -----
    console.log("║ 【市场冲击与容量】                                             ║");
    console.log(`║   平均市场冲击: ${formatPercent(metrics.avgMarketImpact).padEnd(46)}║`);
    console.log(`║   最大市场冲击: ${formatPercent(metrics.maxMarketImpact).padEnd(46)}║`);
    console.log(`║   策略容量: ${formatNumber(metrics.strategyCapacityYi)} 亿元`.padEnd(58) + "║");
    console.log(`║   日均成交额: ${formatNumber(metrics.avgDailyVolume / 100000000)} 亿元`.padEnd(56) + "║");
    console.log(`║   平均成交额占比: ${formatPercent(metrics.avgVolumeRatio).padEnd(44)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 流动性指标 -----
    console.log("║ 【流动性指标】                                                 ║");
    console.log(`║   流动性分数: ${formatRatio(metrics.liquidityScore)} / 100`.padEnd(56) + "║");
    console.log(`║   平均价差: ${formatPercent(metrics.avgSpread).padEnd(50)}║`);
    console.log(`║   成交量稳定性: ${formatPercent(metrics.volumeStability).padEnd(46)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 持仓集中度 -----
    console.log("║ 【持仓集中度】                                                 ║");
    console.log(`║   HHI指数: ${formatRatio(metrics.hhi).padEnd(51)}║`);
    console.log(`║   前10持仓占比: ${formatPercent(metrics.top10Ratio).padEnd(46)}║`);
    console.log(`║   有效持仓数: ${formatRatio(metrics.effectiveN).padEnd(48)}║`);
    console.log(`║   高集中度: ${metrics.isConcentrated ? '是' : '否'}`.padEnd(62) + "║");
    console.log(`║   流通市值下限: ${formatNumber(metrics.marketCapFloorYi)} 亿元`.padEnd(54) + "║");

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 策略稳健性 -----
    console.log("║ 【策略稳健性】                                                 ║");
    console.log(`║   年化衰减率: ${formatPercent(metrics.decayRate).padEnd(48)}║`);
    console.log(`║   前半段年化: ${formatPercent(metrics.firstHalfReturn).padEnd(48)}║`);
    console.log(`║   后半段年化: ${formatPercent(metrics.secondHalfReturn).padEnd(48)}║`);
    console.log(`║   策略衰减: ${metrics.isDecaying ? '是' : '否'}`.padEnd(62) + "║");
    console.log(`║   样本内外比: ${formatRatio(metrics.inOutSampleRatio).padEnd(48)}║`);
    console.log(`║   样本内收益: ${formatPercent(metrics.inSampleReturn).padEnd(48)}║`);
    console.log(`║   样本外收益: ${formatPercent(metrics.outSampleReturn).padEnd(48)}║`);
    console.log(`║   过拟合风险: ${metrics.isOverfit ? '是' : '否'}`.padEnd(60) + "║");

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- Walk-Forward分析 -----
    console.log("║ 【Walk-Forward分析】                                           ║");
    console.log(`║   WF平均收益: ${formatPercent(metrics.walkForwardAvgReturn).padEnd(48)}║`);
    console.log(`║   WF一致性: ${formatPercent(metrics.walkForwardConsistency).padEnd(50)}║`);
    console.log(`║   WF周期数: ${String(metrics.walkForwardPeriods || 0).padEnd(50)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 蒙特卡洛模拟 -----
    console.log("║ 【蒙特卡洛模拟】                                               ║");
    console.log(`║   MC胜率: ${formatPercent(metrics.monteCarloWinRate).padEnd(52)}║`);
    console.log(`║   MC百分位: ${formatPercent(metrics.monteCarloPercentile).padEnd(50)}║`);
    console.log(`║   统计显著: ${metrics.isStatisticallySignificant ? '是 (95%置信)' : '否'}`.padEnd(56) + "║");

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 参数稳定性 -----
    console.log("║ 【参数稳定性】                                                 ║");
    console.log(`║   稳定性分数: ${String(metrics.parameterStabilityScore || 0).padEnd(48)}║`);
    console.log(`║   参数稳定: ${metrics.isStable ? '是' : '否'}`.padEnd(62) + "║");
    console.log(`║   风险等级: ${String(metrics.riskLevel || '-').padEnd(50)}║`);
    console.log(`║   估算寿命: ${String(metrics.estimatedLifespanMonths || 0)} 个月`.padEnd(54) + "║");
    console.log(`║   寿命置信度: ${String(metrics.lifespanConfidence || '-').padEnd(48)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 多周期年化 -----
    console.log("║ 【多周期年化】                                                 ║");
    console.log(`║   日频年化: ${formatPercent(metrics.dailyAnnualReturn).padEnd(50)}║`);
    console.log(`║   周频年化: ${formatPercent(metrics.weeklyAnnualReturn).padEnd(50)}║`);
    console.log(`║   月频年化: ${formatPercent(metrics.monthlyAnnualReturn).padEnd(50)}║`);
    console.log(`║   多周期一致性: ${formatPercent(metrics.multiPeriodConsistency).padEnd(46)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 牛熊市表现 -----
    console.log("║ 【牛熊市表现】                                                 ║");
    console.log(`║   牛市收益: ${formatPercent(metrics.bullReturn).padEnd(50)}║`);
    console.log(`║   熊市收益: ${formatPercent(metrics.bearReturn).padEnd(50)}║`);
    console.log(`║   牛市胜率: ${formatPercent(metrics.bullWinRate).padEnd(50)}║`);
    console.log(`║   熊市胜率: ${formatPercent(metrics.bearWinRate).padEnd(50)}║`);
    console.log(`║   牛市天数: ${String(metrics.bullDays || 0).padEnd(50)}║`);
    console.log(`║   熊市天数: ${String(metrics.bearDays || 0).padEnd(50)}║`);
    console.log(`║   市场择时: ${String(metrics.marketTiming || '-').padEnd(50)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 实盘偏差估算 -----
    console.log("║ 【实盘偏差估算】                                               ║");
    console.log(`║   估算总偏差: ${formatPercent(metrics.estimatedLiveDeviation).padEnd(48)}║`);
    console.log(`║   滑点影响: ${formatPercent(metrics.slippageImpact).padEnd(50)}║`);
    console.log(`║   时机影响: ${formatPercent(metrics.timingImpact).padEnd(50)}║`);
    console.log(`║   调整后收益: ${formatPercent(metrics.adjustedReturn).padEnd(48)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 风控触发统计 -----
    console.log("║ 【风控触发统计】                                               ║");
    console.log(`║   止损触发次数: ${String(metrics.stopLossTriggers || 0).padEnd(46)}║`);
    console.log(`║   最大回撤触发: ${String(metrics.maxDrawdownTriggers || 0).padEnd(46)}║`);
    console.log(`║   单日亏损触发: ${String(metrics.dailyLossTriggers || 0).padEnd(46)}║`);
    console.log(`║   总风控触发: ${String(metrics.totalRiskTriggers || 0).padEnd(48)}║`);
    console.log(`║   风控触发比例: ${formatPercent(metrics.riskTriggerRatio).padEnd(46)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 资金曲线质量 -----
    console.log("║ 【资金曲线质量】                                               ║");
    console.log(`║   曲线偏离度: ${formatPercent(metrics.equityCurveDeviation).padEnd(48)}║`);
    console.log(`║   R²拟合度: ${formatRatio(metrics.equityCurveR2).padEnd(50)}║`);
    console.log(`║   曲线平滑度: ${formatRatio(metrics.equityCurveSmoothness).padEnd(48)}║`);
    console.log(`║   曲线平滑: ${metrics.isEquityCurveSmooth ? '是' : '否'}`.padEnd(62) + "║");

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 文件输出 -----
    console.log("║ 【报告文件】                                                   ║");
    console.log(`║   净值曲线: report/nav.csv                                     ║`);
    console.log(`║   成交记录: report/trades.csv                                  ║`);
    console.log(`║   滚动夏普: report/rolling_sharpe.csv                          ║`);
    console.log(`║   回撤恢复: report/drawdown_periods.csv                        ║`);
    console.log(`║   月度收益: report/monthly_returns.csv                         ║`);
    console.log(`║   季度收益: report/quarterly_returns.csv                       ║`);
    console.log(`║   年度收益: report/yearly_returns.csv                          ║`);

    console.log("╚════════════════════════════════════════════════════════════════╝");

    // ----- 打印成交记录摘要 -----
    if (result.trades.length > 0) {
        console.log("\n📋 成交记录明细（最近10笔）:");
        console.log("┌─────┬────────────┬─────────┬────────┬────────────┬─────────┬────────┬──────────┬─────────┐");
        console.log("│ 编号│  入场日期  │ 入场价  │  股数  │  出场日期  │ 出场价  │ 类型   │ 盈亏金额 │ 盈亏比例│");
        console.log("├─────┼────────────┼─────────┼────────┼────────────┼─────────┼────────┼──────────┼─────────┤");

        // 只显示最近10笔
        const recentTrades = result.trades.slice(-10);
        recentTrades.forEach(t => {
            const exitType = t.exitType === 'STOP_LOSS' ? '止损' :
                t.exitType === 'SIGNAL' ? '信号' : '持仓';
            const pnlStr = t.pnl >= 0 ? `+${t.pnl.toFixed(0)}` : t.pnl.toFixed(0);
            const pnlPctStr = t.pnlPct >= 0 ?
                `+${(t.pnlPct * 100).toFixed(1)}%` :
                `${(t.pnlPct * 100).toFixed(1)}%`;

            console.log(`│ ${String(t.tradeNo).padStart(3)} │ ${t.entryDate} │ ${t.entryPrice.toFixed(2).padStart(7)} │ ${String(t.shares).padStart(6)} │ ${t.exitDate.substring(0, 10)} │ ${t.exitPrice.toFixed(2).padStart(7)} │ ${exitType.padEnd(6)} │ ${pnlStr.padStart(8)} │ ${pnlPctStr.padStart(7)} │`);
        });
        console.log("└─────┴────────────┴─────────┴────────┴────────────┴─────────┴────────┴──────────┴─────────┘");

        if (result.trades.length > 10) {
            console.log(`   ... 共 ${result.trades.length} 笔交易，完整记录请查看 report/trades.csv`);
        }
    }

    // ----- 滚动夏普统计 -----
    if (metrics.rollingSharpe.length > 0) {
        const sharpes = metrics.rollingSharpe.map(s => s.sharpe);
        const avgSharpe = sharpes.reduce((a, b) => a + b, 0) / sharpes.length;
        const maxSharpe = Math.max(...sharpes);
        const minSharpe = Math.min(...sharpes);

        console.log("\n📈 滚动夏普比率统计 (60日窗口):");
        console.log(`   平均值: ${avgSharpe.toFixed(2)} | 最大值: ${maxSharpe.toFixed(2)} | 最小值: ${minSharpe.toFixed(2)}`);
    }

    // ----- 回撤恢复期统计 -----
    if (metrics.drawdownPeriods.length > 0) {
        console.log(`\n📉 回撤事件统计 (>5%的回撤): 共 ${metrics.drawdownPeriods.length} 次`);
        const avgRecovery = metrics.drawdownPeriods
            .filter(p => p.recoveryDays !== null)
            .map(p => p.recoveryDays);
        if (avgRecovery.length > 0) {
            const avg = avgRecovery.reduce((a, b) => a + b, 0) / avgRecovery.length;
            console.log(`   平均恢复天数: ${avg.toFixed(1)} 天`);
        }
    }

    // ----- 月度收益统计 -----
    if (metrics.monthlyReturns.length > 0) {
        console.log("\n📅 月度收益分布:");
        const positiveMonths = metrics.monthlyReturns.filter(m => m.return > 0);
        const negativeMonths = metrics.monthlyReturns.filter(m => m.return < 0);
        const monthReturns = metrics.monthlyReturns.map(m => m.return);
        const avgMonthReturn = monthReturns.reduce((a, b) => a + b, 0) / monthReturns.length;
        const maxMonth = Math.max(...monthReturns);
        const minMonth = Math.min(...monthReturns);

        console.log(`   月度胜率: ${(positiveMonths.length / metrics.monthlyReturns.length * 100).toFixed(1)}% (${positiveMonths.length}/${metrics.monthlyReturns.length})`);
        console.log(`   平均月收益: ${(avgMonthReturn * 100).toFixed(2)}%`);
        console.log(`   最佳月收益: ${(maxMonth * 100).toFixed(2)}% | 最差月收益: ${(minMonth * 100).toFixed(2)}%`);
    }

    // ----- 年度收益统计 -----
    if (metrics.yearlyReturns.length > 0) {
        console.log("\n📆 年度收益分布:");
        metrics.yearlyReturns.forEach(y => {
            const sign = y.return >= 0 ? '+' : '';
            console.log(`   ${y.year}: ${sign}${(y.return * 100).toFixed(2)}%`);
        });
    }

    // ----- 季度收益统计 -----
    if (metrics.quarterlyReturns && metrics.quarterlyReturns.length > 0) {
        console.log("\n📊 季度收益分布:");
        const positiveQuarters = metrics.quarterlyReturns.filter(q => q.return > 0);
        const quarterReturns = metrics.quarterlyReturns.map(q => q.return);
        const avgQuarterReturn = quarterReturns.reduce((a, b) => a + b, 0) / quarterReturns.length;
        console.log(`   季度胜率: ${(positiveQuarters.length / metrics.quarterlyReturns.length * 100).toFixed(1)}% (${positiveQuarters.length}/${metrics.quarterlyReturns.length})`);
        console.log(`   平均季度收益: ${(avgQuarterReturn * 100).toFixed(2)}%`);
        metrics.quarterlyReturns.slice(-4).forEach(q => {
            const sign = q.return >= 0 ? '+' : '';
            console.log(`   ${q.quarter}: ${sign}${(q.return * 100).toFixed(2)}%`);
        });
    }

    console.log("\n✅ 回测完成!");
})();

// ========== 辅助函数 ==========

/**
 * 格式化百分比
 */
function formatPercent(value) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    const sign = value >= 0 ? '+' : '';
    return `${sign}${(value * 100).toFixed(2)}%`;
}

/**
 * 格式化数字
 */
function formatNumber(value) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    return value.toFixed(2);
}

/**
 * 格式化比率
 */
function formatRatio(value) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    if (value === Infinity) return '∞';
    if (value === -Infinity) return '-∞';
    return value.toFixed(2);
}
