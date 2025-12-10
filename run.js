// run.js
const fs = require("fs");
const path = require("path");
const backtest = require("./engine/backtest");
const MaAtr = require("./strategies/maAtr");
// 引入刚才写的 data/index.js
const { getStockHistory } = require("./data/index");

(async () => {
    // ---------------- 配置区域 ----------------
    const STOCK_CODE = '000001'; // 万科A
    const DAYS = 500;            // 回测最近 500 天
    // -----------------------------------------

    console.log(`🚀 开始拉取 [${STOCK_CODE}] 最近 ${DAYS} 天数据...`);
    
    // 1. 获取在线数据
    const data = await getStockHistory(STOCK_CODE, DAYS);

    // 2. 检查数据是否有效
    if (!data || data.length === 0) {
        console.log("❌ 数据获取失败，请检查网络或股票代码。");
        return;
    }
    console.log(`✅ 获取成功! 样本数: ${data.length} 条 (最新日期: ${data[data.length-1].date})`);

    // 3. 开始回测
    // 注意：A股一手是 100 股，如果股价 100 元，至少需要 10000 本金，建议本金设大一点
    const result = backtest(data, MaAtr, {
        initialCash: 100000, 
        strategyConfig: {
            fast: 5,           // 均线参数可以针对 A 股微调
            slow: 20,
            atrPeriod: 14,
            atrMultiplier: 2.5,
            riskPct: 0.02
        }
    });

    // 4. 生成报告 (CSV)
    const reportDir = path.join(__dirname, "report");
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir);

    const navCsv = ["date,nav"];
    result.navs.forEach(n => {
        navCsv.push(`${n.date},${n.nav.toFixed(4)}`);
    });
    fs.writeFileSync(path.join(reportDir, "nav.csv"), navCsv.join("\n"));

    // 5. 计算并打印业绩
    const navs = result.navs;
    const totalRet = (navs[navs.length - 1].nav - navs[0].nav) / navs[0].nav;
    
    // 简单计算最大回撤
    let peak = -Infinity, mdd = 0;
    navs.forEach(n => {
        if (n.nav > peak) peak = n.nav;
        const dd = (peak - n.nav) / peak;
        if (dd > mdd) mdd = dd;
    });

    console.log("\n------ 回测结果 ------");
    console.log(`标的: ${STOCK_CODE}`);
    console.log(`总收益率: ${(totalRet * 100).toFixed(2)}%`);
    console.log(`最大回撤: ${(mdd * 100).toFixed(2)}%`);
    console.log(`净值文件: report/nav.csv`);
    console.log("----------------------");
})();