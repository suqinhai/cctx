// runLive.js
// ============================================
// 实盘交易运行示例
// ============================================
//
// 使用方法：
//   node runLive.js                    # 默认模拟交易
//   node runLive.js --mode=simulated   # 模拟交易
//   node runLive.js --mode=ths         # 同花顺交易（需配置）
//
// 注意：
//   实盘交易有风险，请先使用模拟模式充分测试
//

const path = require('path');
const fs = require('fs');

// ========== 引入模块 ==========
const { LiveTradingEngine } = require('./engine/liveTrading');
const { RealtimeQuoteManager } = require('./realtime');
const { createBroker, SimulatedBroker } = require('./broker');
const { RiskControlManager, RiskLevel } = require('./utils/riskControl');
const MaAtr = require('./strategies/maAtr');

// ========== 配置区域 ==========
const CONFIG = {
    // 交易标的（可以是多只股票）
    symbols: ['000001', '600519'],  // 平安银行、贵州茅台

    // 策略配置
    StrategyClass: MaAtr,
    strategyConfig: {
        fast: 5,           // 5日快速均线
        slow: 20,          // 20日慢速均线
        atrPeriod: 14,     // 14日ATR
        atrMultiplier: 2.5, // 止损距离
        riskPct: 0.02      // 每笔风险2%
    },

    // 券商配置
    brokerType: 'simulated',  // simulated, ths, eastmoney
    initialCash: 100000,      // 初始资金（模拟模式）

    // 行情配置
    quoteSource: 'sina',      // sina, tencent
    quoteInterval: 3000,      // 行情刷新间隔（毫秒）

    // 风控配置
    riskConfig: {
        maxPositionRatio: 0.8,      // 最大总仓位80%
        maxSingleStockRatio: 0.3,   // 单标的最大30%
        maxDailyLoss: 0.03,         // 单日最大亏损3%
        maxDrawdown: 0.10,          // 最大回撤10%
        maxDailyTrades: 5,          // 每日最多5笔交易
        defaultStopLoss: 0.08       // 默认止损8%
    },

    // 交易时间
    tradingStartTime: '09:30',
    tradingEndTime: '15:00',
    lunchBreakStart: '11:30',
    lunchBreakEnd: '13:00'
};

// ========== 解析命令行参数 ==========
function parseArgs() {
    const args = process.argv.slice(2);
    const config = { ...CONFIG };

    args.forEach(arg => {
        if (arg.startsWith('--mode=')) {
            config.brokerType = arg.split('=')[1];
        }
        if (arg.startsWith('--symbols=')) {
            config.symbols = arg.split('=')[1].split(',');
        }
        if (arg.startsWith('--cash=')) {
            config.initialCash = parseFloat(arg.split('=')[1]);
        }
    });

    return config;
}

// ========== 主程序 ==========
async function main() {
    const config = parseArgs();

    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    实盘交易系统启动                            ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log(`║  交易模式: ${config.brokerType.padEnd(51)}║`);
    console.log(`║  交易标的: ${config.symbols.join(', ').padEnd(51)}║`);
    console.log(`║  初始资金: ${String(config.initialCash).padEnd(51)}║`);
    console.log(`║  行情源: ${config.quoteSource.padEnd(53)}║`);
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');

    // ========== 1. 创建风控管理器 ==========
    console.log('[1/5] 初始化风控模块...');
    const riskManager = new RiskControlManager(config.riskConfig);

    // 监听风控事件
    riskManager.on('riskAlert', ({ alerts, state }) => {
        console.log('\n⚠️  风险警报:');
        alerts.forEach(alert => {
            console.log(`    [${alert.level}] ${alert.message}`);
        });
        if (!state.tradingEnabled) {
            console.log('    ❌ 交易已暂停');
        }
    });

    riskManager.on('stopLossUpdated', ({ symbol, oldStopPrice, newStopPrice }) => {
        console.log(`📉 移动止损更新: ${symbol} ${oldStopPrice.toFixed(2)} -> ${newStopPrice.toFixed(2)}`);
    });

    // ========== 2. 创建券商接口 ==========
    console.log('[2/5] 创建券商接口...');
    let broker;

    try {
        broker = createBroker(config.brokerType, {
            initialCash: config.initialCash,
            commission: 0.0003,  // 万三
            stampTax: 0.001,     // 千一
            minCommission: 5     // 最低5元
        });
    } catch (error) {
        console.error(`❌ 券商创建失败: ${error.message}`);
        console.log('使用模拟交易模式...');
        broker = new SimulatedBroker({ initialCash: config.initialCash });
    }

    // ========== 3. 创建行情管理器 ==========
    console.log('[3/5] 创建行情管理器...');
    const quoteManager = new RealtimeQuoteManager({
        dataSource: config.quoteSource,
        pollInterval: config.quoteInterval
    });

    // 监听行情错误
    quoteManager.on('error', (error) => {
        console.error('行情错误:', error.message);
    });

    // ========== 4. 创建交易引擎 ==========
    console.log('[4/5] 创建交易引擎...');
    const engine = new LiveTradingEngine({
        symbols: config.symbols,
        StrategyClass: config.StrategyClass,
        strategyConfig: config.strategyConfig,
        maxPositionRatio: config.riskConfig.maxPositionRatio,
        maxSingleRatio: config.riskConfig.maxSingleStockRatio,
        maxDailyLoss: config.riskConfig.maxDailyLoss,
        maxDrawdown: config.riskConfig.maxDrawdown,
        stopLossEnabled: true,
        tradingStartTime: config.tradingStartTime,
        tradingEndTime: config.tradingEndTime,
        lunchBreakStart: config.lunchBreakStart,
        lunchBreakEnd: config.lunchBreakEnd
    });

    // 设置券商和行情
    engine.setBroker(broker);
    engine.setQuoteManager(quoteManager);

    // ========== 5. 监听交易事件 ==========
    console.log('[5/5] 注册事件监听...');

    engine.on('started', ({ account, symbols }) => {
        console.log('\n✅ 交易引擎已启动');
        console.log(`   账户资产: ${account.totalAssets.toFixed(2)}`);
        console.log(`   可用资金: ${account.available.toFixed(2)}`);
        console.log(`   监控标的: ${symbols.join(', ')}`);
    });

    engine.on('orderSubmitted', ({ orderId, order }) => {
        const side = order.side === 'BUY' ? '买入' : '卖出';
        console.log(`\n📝 订单提交: [${orderId}] ${side} ${order.code} ${order.quantity}股 @ ${order.price.toFixed(2)}`);
    });

    engine.on('orderFilled', ({ order, trade }) => {
        const side = order.side === 'BUY' ? '买入' : '卖出';
        const pnl = trade.pnl ? (trade.pnl >= 0 ? `+${trade.pnl.toFixed(2)}` : trade.pnl.toFixed(2)) : '';
        console.log(`\n✅ 订单成交: [${order.orderId}] ${side} ${order.code} ${trade.quantity}股 @ ${trade.price.toFixed(2)} ${pnl}`);

        // 记录到风控
        riskManager.recordTrade(trade);
    });

    engine.on('orderCancelled', ({ order }) => {
        console.log(`\n❌ 订单取消: [${order.orderId}]`);
    });

    engine.on('orderRejected', ({ order, reason }) => {
        console.log(`\n⚠️ 订单拒绝: [${order.orderId}] ${reason}`);
    });

    engine.on('stopLossTriggered', ({ symbol, stopPrice, currentPrice }) => {
        console.log(`\n🛑 止损触发: ${symbol} 止损价 ${stopPrice.toFixed(2)} 当前价 ${currentPrice.toFixed(2)}`);
    });

    engine.on('riskAlert', ({ alerts, riskStatus }) => {
        console.log('\n⚠️  引擎风险警报:');
        alerts.forEach(msg => console.log(`    ${msg}`));
    });

    engine.on('dailyReset', ({ nav }) => {
        console.log(`\n📅 每日重置完成，当前净值: ${nav.toFixed(2)}`);
    });

    engine.on('stopped', () => {
        console.log('\n🔴 交易引擎已停止');
    });

    // ========== 启动引擎 ==========
    try {
        await engine.start();
    } catch (error) {
        console.error('❌ 启动失败:', error.message);
        process.exit(1);
    }

    // ========== 状态显示定时器 ==========
    const statusInterval = setInterval(async () => {
        try {
            const status = await engine.getStatus();
            const riskStatus = riskManager.getStatus();

            // 只在交易时间显示状态
            if (engine.isTradingTime()) {
                console.log('\n─────────────────────────────────────────');
                console.log(`⏰ ${new Date().toLocaleTimeString()}`);
                console.log(`💰 总资产: ${status.account.totalAssets.toFixed(2)} | 可用: ${status.account.available.toFixed(2)} | 市值: ${status.account.marketValue.toFixed(2)}`);
                console.log(`📊 日盈亏: ${(status.riskStatus.dailyPnL * 100).toFixed(2)}% | 回撤: ${(status.riskStatus.currentDrawdown * 100).toFixed(2)}%`);
                console.log(`📈 风险等级: ${riskStatus.riskLevel} | 交易状态: ${riskStatus.tradingEnabled ? '正常' : '暂停'}`);

                if (status.positions.length > 0) {
                    console.log('持仓:');
                    status.positions.forEach(pos => {
                        const pnlSign = pos.profit >= 0 ? '+' : '';
                        console.log(`   ${pos.code}: ${pos.shares}股 成本${pos.avgPrice.toFixed(2)} 现价${pos.currentPrice.toFixed(2)} ${pnlSign}${pos.profitPercent}%`);
                    });
                }
            }
        } catch (error) {
            // 忽略状态获取错误
        }
    }, 60000);  // 每分钟显示一次状态

    // ========== 优雅退出处理 ==========
    const shutdown = async () => {
        console.log('\n\n正在关闭交易系统...');
        clearInterval(statusInterval);
        await engine.stop();
        quoteManager.destroy();
        console.log('交易系统已关闭，再见！');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);   // Ctrl+C
    process.on('SIGTERM', shutdown);  // kill命令

    // ========== 命令行交互 ==========
    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  交互命令:');
    console.log('    status  - 显示当前状态');
    console.log('    pause   - 暂停交易');
    console.log('    resume  - 恢复交易');
    console.log('    orders  - 显示今日订单');
    console.log('    trades  - 显示今日成交');
    console.log('    quit    - 退出系统');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    // 标准输入处理
    if (process.stdin.isTTY) {
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.on('line', async (input) => {
            const cmd = input.trim().toLowerCase();

            switch (cmd) {
                case 'status':
                    const status = await engine.getStatus();
                    console.log('\n当前状态:');
                    console.log(`  运行中: ${status.running}`);
                    console.log(`  暂停: ${status.paused}`);
                    console.log(`  总资产: ${status.account.totalAssets.toFixed(2)}`);
                    console.log(`  今日订单: ${status.todayOrders.length}`);
                    console.log(`  今日成交: ${status.todayTrades.length}`);
                    break;

                case 'pause':
                    engine.pause();
                    console.log('✋ 交易已暂停');
                    break;

                case 'resume':
                    engine.resume();
                    console.log('▶️ 交易已恢复');
                    break;

                case 'orders':
                    const orders = (await engine.getStatus()).todayOrders;
                    if (orders.length === 0) {
                        console.log('今日无订单');
                    } else {
                        console.log('\n今日订单:');
                        orders.forEach(o => {
                            console.log(`  [${o.orderId}] ${o.side} ${o.code} ${o.quantity}股 @ ${o.price}`);
                        });
                    }
                    break;

                case 'trades':
                    const trades = (await engine.getStatus()).todayTrades;
                    if (trades.length === 0) {
                        console.log('今日无成交');
                    } else {
                        console.log('\n今日成交:');
                        trades.forEach(t => {
                            console.log(`  ${t.time} ${t.side} ${t.code} ${t.quantity}股 @ ${t.price}`);
                        });
                    }
                    break;

                case 'quit':
                case 'exit':
                    await shutdown();
                    break;

                default:
                    if (cmd) {
                        console.log('未知命令，输入 status/pause/resume/orders/trades/quit');
                    }
            }
        });
    }
}

// ========== 运行 ==========
main().catch(error => {
    console.error('程序异常:', error);
    process.exit(1);
});
