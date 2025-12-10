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
    const STOCK_CODE = '000001';

    // 回测数据天数
    // 获取最近多少个交易日的数据
    const DAYS = 500;

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
    const metrics = generateMetrics(result);

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

    // ----- 收益指标 -----
    console.log("║ 【收益指标】                                                   ║");
    console.log(`║   总收益率: ${formatPercent(metrics.totalReturn).padEnd(50)}║`);
    console.log(`║   年化收益率: ${formatPercent(metrics.annualReturn).padEnd(48)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 风险指标 -----
    console.log("║ 【风险指标】                                                   ║");
    console.log(`║   年化波动率: ${formatPercent(metrics.annualVolatility).padEnd(48)}║`);
    console.log(`║   最大回撤: ${formatPercent(metrics.maxDrawdown).padEnd(50)}║`);
    console.log(`║   回撤峰值日: ${(metrics.drawdownPeakDate || '-').padEnd(48)}║`);
    console.log(`║   回撤谷值日: ${(metrics.drawdownTroughDate || '-').padEnd(48)}║`);
    console.log(`║   回撤恢复日: ${String(metrics.drawdownRecoveryDate || '-').padEnd(48)}║`);
    console.log(`║   回撤持续天数: ${String(metrics.drawdownDays || '-').padEnd(46)}║`);
    console.log(`║   恢复所需天数: ${String(metrics.recoveryDays !== null ? metrics.recoveryDays : '未恢复').padEnd(46)}║`);

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 风险调整收益 -----
    console.log("║ 【风险调整收益】                                               ║");
    console.log(`║   夏普比率 (Sharpe): ${formatRatio(metrics.sharpeRatio).padEnd(41)}║`);
    console.log(`║   索提诺比率 (Sortino): ${formatRatio(metrics.sortinoRatio).padEnd(38)}║`);
    console.log(`║   卡尔玛比率 (Calmar): ${formatRatio(metrics.calmarRatio).padEnd(39)}║`);

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

    // ----- 极值统计 -----
    console.log("║ 【极值统计】                                                   ║");
    console.log(`║   最大单笔盈利: ${formatNumber(metrics.maxWin)} (${formatPercent(metrics.maxWinPct)})`.padEnd(65) + "║");
    console.log(`║   最大单笔亏损: ${formatNumber(metrics.maxLoss)} (${formatPercent(metrics.maxLossPct)})`.padEnd(65) + "║");
    console.log(`║   平均持仓天数: ${metrics.avgHoldingDays.toFixed(1)}`.padEnd(65) + "║");

    console.log("╠════════════════════════════════════════════════════════════════╣");

    // ----- 文件输出 -----
    console.log("║ 【报告文件】                                                   ║");
    console.log(`║   净值曲线: report/nav.csv                                     ║`);
    console.log(`║   成交记录: report/trades.csv                                  ║`);
    console.log(`║   滚动夏普: report/rolling_sharpe.csv                          ║`);
    console.log(`║   回撤恢复: report/drawdown_periods.csv                        ║`);

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
