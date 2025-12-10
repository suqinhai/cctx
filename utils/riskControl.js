// utils/riskControl.js
// ============================================
// 风控模块 - 实盘交易风险控制
// ============================================
//
// 功能：
// 1. 仓位控制 - 限制单标的和总仓位
// 2. 止损控制 - 个股止损、组合止损
// 3. 回撤控制 - 最大回撤限制
// 4. 交易频率控制 - 防止过度交易
// 5. 异常检测 - 价格异常、流动性异常
//

const EventEmitter = require('events');

/**
 * 风险控制类型枚举
 */
const RiskType = {
    POSITION_LIMIT: 'POSITION_LIMIT',           // 仓位超限
    SINGLE_STOCK_LIMIT: 'SINGLE_STOCK_LIMIT',   // 单标的超限
    DAILY_LOSS_LIMIT: 'DAILY_LOSS_LIMIT',       // 日亏损超限
    DRAWDOWN_LIMIT: 'DRAWDOWN_LIMIT',           // 回撤超限
    STOP_LOSS: 'STOP_LOSS',                     // 止损触发
    TRADE_FREQUENCY: 'TRADE_FREQUENCY',         // 交易频率过高
    PRICE_ANOMALY: 'PRICE_ANOMALY',             // 价格异常
    LIQUIDITY_WARNING: 'LIQUIDITY_WARNING',     // 流动性警告
    VOLATILITY_WARNING: 'VOLATILITY_WARNING'    // 波动率警告
};

/**
 * 风险等级枚举
 */
const RiskLevel = {
    LOW: 'LOW',           // 低风险
    MEDIUM: 'MEDIUM',     // 中风险
    HIGH: 'HIGH',         // 高风险
    CRITICAL: 'CRITICAL'  // 极高风险
};

/**
 * 风险控制管理器
 */
class RiskControlManager extends EventEmitter {
    constructor(config = {}) {
        super();

        // ========== 风控参数配置 ==========
        this.config = {
            // 仓位控制
            maxPositionRatio: config.maxPositionRatio || 0.8,      // 最大总仓位
            maxSingleStockRatio: config.maxSingleStockRatio || 0.3, // 单标的最大仓位
            minCashReserve: config.minCashReserve || 0.1,          // 最低现金保留

            // 亏损控制
            maxDailyLoss: config.maxDailyLoss || 0.05,             // 单日最大亏损
            maxWeeklyLoss: config.maxWeeklyLoss || 0.10,           // 单周最大亏损
            maxMonthlyLoss: config.maxMonthlyLoss || 0.15,         // 单月最大亏损
            maxDrawdown: config.maxDrawdown || 0.20,               // 最大回撤

            // 止损设置
            defaultStopLoss: config.defaultStopLoss || 0.08,       // 默认止损比例
            trailingStopEnabled: config.trailingStopEnabled || false, // 是否启用移动止损
            trailingStopRatio: config.trailingStopRatio || 0.05,   // 移动止损比例

            // 交易频率控制
            maxDailyTrades: config.maxDailyTrades || 10,           // 每日最大交易次数
            maxHourlyTrades: config.maxHourlyTrades || 3,          // 每小时最大交易次数
            minTradeInterval: config.minTradeInterval || 300000,   // 最小交易间隔（毫秒）

            // 异常检测
            priceAnomalyThreshold: config.priceAnomalyThreshold || 0.05, // 价格异常阈值
            volumeAnomalyThreshold: config.volumeAnomalyThreshold || 3,  // 成交量异常倍数
            volatilityWarningThreshold: config.volatilityWarningThreshold || 0.03, // 波动率警告阈值

            // 流动性控制
            minDailyVolume: config.minDailyVolume || 10000000,     // 最低日成交额（元）
            maxVolumeRatio: config.maxVolumeRatio || 0.01,         // 最大成交占比

            ...config
        };

        // ========== 状态变量 ==========
        this.state = {
            // 净值追踪
            peakNav: 0,
            currentNav: 0,
            dailyStartNav: 0,
            weeklyStartNav: 0,
            monthlyStartNav: 0,

            // 盈亏追踪
            dailyPnL: 0,
            weeklyPnL: 0,
            monthlyPnL: 0,
            currentDrawdown: 0,

            // 交易追踪
            todayTradeCount: 0,
            hourlyTradeCount: 0,
            lastTradeTime: null,
            tradeHistory: [],

            // 风险状态
            riskLevel: RiskLevel.LOW,
            activeAlerts: [],
            tradingEnabled: true,
            pauseReason: null
        };

        // 止损价格跟踪
        this.stopPrices = new Map();  // symbol -> { stopPrice, entryPrice, highPrice }

        // 定时重置
        this._setupResetTimers();
    }

    /**
     * 设置定时重置
     */
    _setupResetTimers() {
        // 每小时重置小时交易计数
        setInterval(() => {
            this.state.hourlyTradeCount = 0;
        }, 3600000);

        // 每天重置日交易计数（收盘后）
        setInterval(() => {
            const now = new Date();
            const hour = now.getHours();
            const minute = now.getMinutes();

            if (hour === 15 && minute === 5) {
                this.resetDaily();
            }
        }, 60000);
    }

    /**
     * 日度重置
     */
    resetDaily() {
        this.state.dailyStartNav = this.state.currentNav;
        this.state.dailyPnL = 0;
        this.state.todayTradeCount = 0;
        this.state.hourlyTradeCount = 0;
        this.state.tradeHistory = [];

        // 如果因日亏损暂停，重新启用
        if (this.state.pauseReason === 'DAILY_LOSS_LIMIT') {
            this.state.tradingEnabled = true;
            this.state.pauseReason = null;
        }

        this.emit('dailyReset', { nav: this.state.currentNav });
    }

    /**
     * 周度重置
     */
    resetWeekly() {
        this.state.weeklyStartNav = this.state.currentNav;
        this.state.weeklyPnL = 0;

        if (this.state.pauseReason === 'WEEKLY_LOSS_LIMIT') {
            this.state.tradingEnabled = true;
            this.state.pauseReason = null;
        }

        this.emit('weeklyReset', { nav: this.state.currentNav });
    }

    /**
     * 月度重置
     */
    resetMonthly() {
        this.state.monthlyStartNav = this.state.currentNav;
        this.state.monthlyPnL = 0;

        if (this.state.pauseReason === 'MONTHLY_LOSS_LIMIT') {
            this.state.tradingEnabled = true;
            this.state.pauseReason = null;
        }

        this.emit('monthlyReset', { nav: this.state.currentNav });
    }

    /**
     * 更新净值
     */
    updateNav(nav) {
        this.state.currentNav = nav;

        // 初始化起始净值
        if (this.state.dailyStartNav === 0) {
            this.state.dailyStartNav = nav;
            this.state.weeklyStartNav = nav;
            this.state.monthlyStartNav = nav;
            this.state.peakNav = nav;
        }

        // 更新峰值
        if (nav > this.state.peakNav) {
            this.state.peakNav = nav;
        }

        // 计算盈亏
        this.state.dailyPnL = (nav - this.state.dailyStartNav) / this.state.dailyStartNav;
        this.state.weeklyPnL = (nav - this.state.weeklyStartNav) / this.state.weeklyStartNav;
        this.state.monthlyPnL = (nav - this.state.monthlyStartNav) / this.state.monthlyStartNav;
        this.state.currentDrawdown = (this.state.peakNav - nav) / this.state.peakNav;

        // 评估风险等级
        this._evaluateRiskLevel();

        // 检查风控规则
        this._checkRiskRules();
    }

    /**
     * 评估风险等级
     */
    _evaluateRiskLevel() {
        const { dailyPnL, currentDrawdown } = this.state;
        const { maxDailyLoss, maxDrawdown } = this.config;

        // 计算风险分数
        const dailyLossScore = Math.abs(dailyPnL) / maxDailyLoss;
        const drawdownScore = currentDrawdown / maxDrawdown;
        const maxScore = Math.max(dailyLossScore, drawdownScore);

        if (maxScore >= 1) {
            this.state.riskLevel = RiskLevel.CRITICAL;
        } else if (maxScore >= 0.8) {
            this.state.riskLevel = RiskLevel.HIGH;
        } else if (maxScore >= 0.5) {
            this.state.riskLevel = RiskLevel.MEDIUM;
        } else {
            this.state.riskLevel = RiskLevel.LOW;
        }
    }

    /**
     * 检查风控规则
     */
    _checkRiskRules() {
        const alerts = [];

        // 日亏损检查
        if (this.state.dailyPnL <= -this.config.maxDailyLoss) {
            alerts.push({
                type: RiskType.DAILY_LOSS_LIMIT,
                level: RiskLevel.CRITICAL,
                message: `日亏损超限: ${(this.state.dailyPnL * 100).toFixed(2)}%`,
                action: 'PAUSE_TRADING'
            });
            this.state.tradingEnabled = false;
            this.state.pauseReason = 'DAILY_LOSS_LIMIT';
        }

        // 周亏损检查
        if (this.state.weeklyPnL <= -this.config.maxWeeklyLoss) {
            alerts.push({
                type: RiskType.DAILY_LOSS_LIMIT,
                level: RiskLevel.CRITICAL,
                message: `周亏损超限: ${(this.state.weeklyPnL * 100).toFixed(2)}%`,
                action: 'PAUSE_TRADING'
            });
            this.state.tradingEnabled = false;
            this.state.pauseReason = 'WEEKLY_LOSS_LIMIT';
        }

        // 回撤检查
        if (this.state.currentDrawdown >= this.config.maxDrawdown) {
            alerts.push({
                type: RiskType.DRAWDOWN_LIMIT,
                level: RiskLevel.CRITICAL,
                message: `回撤超限: ${(this.state.currentDrawdown * 100).toFixed(2)}%`,
                action: 'PAUSE_TRADING'
            });
            this.state.tradingEnabled = false;
            this.state.pauseReason = 'DRAWDOWN_LIMIT';
        }

        // 更新警报
        this.state.activeAlerts = alerts;

        // 发送事件
        if (alerts.length > 0) {
            this.emit('riskAlert', { alerts, state: this.state });
        }
    }

    /**
     * 订单前风控检查
     * @param {Object} order - 订单信息
     * @param {Object} account - 账户信息
     * @param {Object} quote - 行情信息
     * @returns {Object} 检查结果 { passed, reason, adjustedOrder }
     */
    preOrderCheck(order, account, quote) {
        const result = { passed: true, reasons: [], adjustedOrder: { ...order } };

        // 1. 检查交易是否被暂停
        if (!this.state.tradingEnabled) {
            result.passed = false;
            result.reasons.push(`交易已暂停: ${this.state.pauseReason}`);
            return result;
        }

        // 2. 检查交易频率
        const frequencyCheck = this._checkTradeFrequency();
        if (!frequencyCheck.passed) {
            result.passed = false;
            result.reasons.push(frequencyCheck.reason);
            return result;
        }

        // 3. 仓位检查（仅买入）
        if (order.side === 'BUY') {
            const positionCheck = this._checkPositionLimit(order, account);
            if (!positionCheck.passed) {
                if (positionCheck.adjustedShares > 0) {
                    result.adjustedOrder.quantity = positionCheck.adjustedShares;
                    result.reasons.push(`仓位限制，调整股数: ${order.quantity} -> ${positionCheck.adjustedShares}`);
                } else {
                    result.passed = false;
                    result.reasons.push(positionCheck.reason);
                    return result;
                }
            }
        }

        // 4. 价格异常检查
        const priceCheck = this._checkPriceAnomaly(order, quote);
        if (!priceCheck.passed) {
            result.passed = false;
            result.reasons.push(priceCheck.reason);
            return result;
        }

        // 5. 流动性检查
        const liquidityCheck = this._checkLiquidity(order, quote);
        if (!liquidityCheck.passed) {
            result.reasons.push(liquidityCheck.reason);
            // 流动性警告不阻止交易，只记录
        }

        return result;
    }

    /**
     * 检查交易频率
     */
    _checkTradeFrequency() {
        const { maxDailyTrades, maxHourlyTrades, minTradeInterval } = this.config;

        // 日交易次数检查
        if (this.state.todayTradeCount >= maxDailyTrades) {
            return {
                passed: false,
                reason: `日交易次数超限: ${this.state.todayTradeCount}/${maxDailyTrades}`
            };
        }

        // 小时交易次数检查
        if (this.state.hourlyTradeCount >= maxHourlyTrades) {
            return {
                passed: false,
                reason: `小时交易次数超限: ${this.state.hourlyTradeCount}/${maxHourlyTrades}`
            };
        }

        // 最小交易间隔检查
        if (this.state.lastTradeTime) {
            const elapsed = Date.now() - this.state.lastTradeTime;
            if (elapsed < minTradeInterval) {
                const waitSeconds = Math.ceil((minTradeInterval - elapsed) / 1000);
                return {
                    passed: false,
                    reason: `交易间隔过短，请等待 ${waitSeconds} 秒`
                };
            }
        }

        return { passed: true };
    }

    /**
     * 检查仓位限制
     */
    _checkPositionLimit(order, account) {
        const { maxPositionRatio, maxSingleStockRatio, minCashReserve } = this.config;
        const orderValue = order.price * order.quantity;

        // 检查总仓位
        const currentPositionRatio = account.marketValue / account.totalAssets;
        const newPositionRatio = (account.marketValue + orderValue) / account.totalAssets;

        if (newPositionRatio > maxPositionRatio) {
            // 计算可买的最大股数
            const maxOrderValue = (maxPositionRatio - currentPositionRatio) * account.totalAssets;
            const adjustedShares = Math.floor(maxOrderValue / order.price / 100) * 100;

            return {
                passed: false,
                reason: `总仓位超限: ${(newPositionRatio * 100).toFixed(1)}% > ${maxPositionRatio * 100}%`,
                adjustedShares
            };
        }

        // 检查单标的仓位
        const singleRatio = orderValue / account.totalAssets;
        if (singleRatio > maxSingleStockRatio) {
            const maxOrderValue = maxSingleStockRatio * account.totalAssets;
            const adjustedShares = Math.floor(maxOrderValue / order.price / 100) * 100;

            return {
                passed: false,
                reason: `单标的仓位超限: ${(singleRatio * 100).toFixed(1)}% > ${maxSingleStockRatio * 100}%`,
                adjustedShares
            };
        }

        // 检查现金储备
        const remainingCash = account.available - orderValue * 1.003;
        const remainingCashRatio = remainingCash / account.totalAssets;

        if (remainingCashRatio < minCashReserve) {
            const maxOrderValue = account.available - minCashReserve * account.totalAssets;
            const adjustedShares = Math.floor(maxOrderValue / order.price / 1.003 / 100) * 100;

            return {
                passed: false,
                reason: `现金储备不足: 剩余 ${(remainingCashRatio * 100).toFixed(1)}%`,
                adjustedShares
            };
        }

        return { passed: true };
    }

    /**
     * 检查价格异常
     */
    _checkPriceAnomaly(order, quote) {
        const { priceAnomalyThreshold } = this.config;

        // 检查订单价格与当前价格偏差
        const priceDiff = Math.abs(order.price - quote.price) / quote.price;

        if (priceDiff > priceAnomalyThreshold) {
            return {
                passed: false,
                reason: `价格偏差过大: ${(priceDiff * 100).toFixed(2)}%`
            };
        }

        // 检查是否接近涨跌停
        if (quote.limitUp && quote.price >= quote.limitUp * 0.99) {
            return {
                passed: false,
                reason: '股价接近涨停，买入风险高'
            };
        }

        if (quote.limitDown && quote.price <= quote.limitDown * 1.01) {
            return {
                passed: false,
                reason: '股价接近跌停，卖出困难'
            };
        }

        return { passed: true };
    }

    /**
     * 检查流动性
     */
    _checkLiquidity(order, quote) {
        const { minDailyVolume, maxVolumeRatio } = this.config;
        const orderValue = order.price * order.quantity;

        // 检查日成交额
        const dailyAmount = quote.amount || (quote.volume * quote.price);
        if (dailyAmount < minDailyVolume) {
            return {
                passed: true,  // 警告但不阻止
                reason: `流动性警告: 日成交额 ${(dailyAmount / 10000).toFixed(0)} 万 < ${minDailyVolume / 10000} 万`
            };
        }

        // 检查订单占比
        const volumeRatio = orderValue / dailyAmount;
        if (volumeRatio > maxVolumeRatio) {
            return {
                passed: true,  // 警告但不阻止
                reason: `成交占比警告: ${(volumeRatio * 100).toFixed(2)}% > ${maxVolumeRatio * 100}%`
            };
        }

        return { passed: true };
    }

    /**
     * 设置止损价
     */
    setStopLoss(symbol, entryPrice, stopPrice = null) {
        if (!stopPrice) {
            // 使用默认止损
            stopPrice = entryPrice * (1 - this.config.defaultStopLoss);
        }

        this.stopPrices.set(symbol, {
            entryPrice,
            stopPrice,
            highPrice: entryPrice,
            trailingEnabled: this.config.trailingStopEnabled
        });

        return stopPrice;
    }

    /**
     * 更新止损价（用于移动止损）
     */
    updateStopLoss(symbol, currentPrice) {
        const stopInfo = this.stopPrices.get(symbol);
        if (!stopInfo) return null;

        // 更新最高价
        if (currentPrice > stopInfo.highPrice) {
            stopInfo.highPrice = currentPrice;

            // 移动止损
            if (stopInfo.trailingEnabled) {
                const newStopPrice = currentPrice * (1 - this.config.trailingStopRatio);
                if (newStopPrice > stopInfo.stopPrice) {
                    stopInfo.stopPrice = newStopPrice;
                    this.emit('stopLossUpdated', {
                        symbol,
                        oldStopPrice: stopInfo.stopPrice,
                        newStopPrice
                    });
                }
            }
        }

        return stopInfo.stopPrice;
    }

    /**
     * 检查是否触发止损
     */
    checkStopLoss(symbol, currentPrice) {
        const stopInfo = this.stopPrices.get(symbol);
        if (!stopInfo) return { triggered: false };

        if (currentPrice <= stopInfo.stopPrice) {
            return {
                triggered: true,
                stopPrice: stopInfo.stopPrice,
                entryPrice: stopInfo.entryPrice,
                lossPercent: (currentPrice - stopInfo.entryPrice) / stopInfo.entryPrice
            };
        }

        return { triggered: false };
    }

    /**
     * 清除止损
     */
    clearStopLoss(symbol) {
        this.stopPrices.delete(symbol);
    }

    /**
     * 记录交易
     */
    recordTrade(trade) {
        this.state.todayTradeCount++;
        this.state.hourlyTradeCount++;
        this.state.lastTradeTime = Date.now();
        this.state.tradeHistory.push({
            ...trade,
            time: new Date().toISOString()
        });
    }

    /**
     * 获取风控状态
     */
    getStatus() {
        return {
            ...this.state,
            config: this.config,
            stopPrices: Object.fromEntries(this.stopPrices)
        };
    }

    /**
     * 手动恢复交易
     */
    resumeTrading() {
        this.state.tradingEnabled = true;
        this.state.pauseReason = null;
        this.emit('tradingResumed');
    }

    /**
     * 手动暂停交易
     */
    pauseTrading(reason = 'MANUAL') {
        this.state.tradingEnabled = false;
        this.state.pauseReason = reason;
        this.emit('tradingPaused', { reason });
    }
}

// ========== 导出 ==========
module.exports = {
    RiskType,
    RiskLevel,
    RiskControlManager
};
