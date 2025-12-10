// utils/circuitBreaker.js
// ============================================
// 风控熔断模块
// ============================================
//
// 功能：
// 1. 多级熔断机制（警告->限制->暂停->停止）
// 2. 自动恢复机制
// 3. 熔断事件记录和通知
// 4. 冷却期管理
//

const EventEmitter = require('events');

/**
 * 熔断级别
 */
const CircuitLevel = {
    NORMAL: 'NORMAL',           // 正常
    WARNING: 'WARNING',         // 警告（可继续交易，但记录警告）
    RESTRICTED: 'RESTRICTED',   // 限制（降低仓位限制）
    SUSPENDED: 'SUSPENDED',     // 暂停（暂停新开仓，允许平仓）
    HALTED: 'HALTED'           // 停止（完全停止交易）
};

/**
 * 熔断触发原因
 */
const CircuitReason = {
    // 亏损相关
    DAILY_LOSS: 'DAILY_LOSS',           // 日亏损
    WEEKLY_LOSS: 'WEEKLY_LOSS',         // 周亏损
    MONTHLY_LOSS: 'MONTHLY_LOSS',       // 月亏损
    MAX_DRAWDOWN: 'MAX_DRAWDOWN',       // 最大回撤
    CONSECUTIVE_LOSS: 'CONSECUTIVE_LOSS', // 连续亏损

    // 交易异常
    TRADE_FREQUENCY: 'TRADE_FREQUENCY', // 交易过于频繁
    ORDER_REJECTION: 'ORDER_REJECTION', // 订单连续拒绝
    EXECUTION_ERROR: 'EXECUTION_ERROR', // 执行错误

    // 市场异常
    MARKET_VOLATILITY: 'MARKET_VOLATILITY', // 市场波动过大
    PRICE_ANOMALY: 'PRICE_ANOMALY',     // 价格异常
    LIQUIDITY_CRISIS: 'LIQUIDITY_CRISIS', // 流动性危机

    // 系统异常
    CONNECTION_ERROR: 'CONNECTION_ERROR', // 连接错误
    DATA_ERROR: 'DATA_ERROR',           // 数据错误
    SYSTEM_ERROR: 'SYSTEM_ERROR',       // 系统错误

    // 人工干预
    MANUAL: 'MANUAL'                    // 人工触发
};

/**
 * 熔断管理器
 */
class CircuitBreaker extends EventEmitter {
    constructor(config = {}) {
        super();

        // ========== 熔断阈值配置 ==========
        this.thresholds = {
            // 日亏损阈值
            dailyLoss: {
                warning: config.dailyLossWarning || 0.02,      // 2% 警告
                restricted: config.dailyLossRestricted || 0.03, // 3% 限制
                suspended: config.dailyLossSuspended || 0.05,   // 5% 暂停
                halted: config.dailyLossHalted || 0.08          // 8% 停止
            },
            // 周亏损阈值
            weeklyLoss: {
                warning: config.weeklyLossWarning || 0.05,
                restricted: config.weeklyLossRestricted || 0.08,
                suspended: config.weeklyLossSuspended || 0.10,
                halted: config.weeklyLossHalted || 0.15
            },
            // 月亏损阈值
            monthlyLoss: {
                warning: config.monthlyLossWarning || 0.08,
                restricted: config.monthlyLossRestricted || 0.12,
                suspended: config.monthlyLossSuspended || 0.15,
                halted: config.monthlyLossHalted || 0.20
            },
            // 回撤阈值
            drawdown: {
                warning: config.drawdownWarning || 0.08,
                restricted: config.drawdownRestricted || 0.12,
                suspended: config.drawdownSuspended || 0.15,
                halted: config.drawdownHalted || 0.20
            },
            // 连续亏损次数
            consecutiveLoss: {
                warning: config.consecutiveLossWarning || 3,
                restricted: config.consecutiveLossRestricted || 5,
                suspended: config.consecutiveLossSuspended || 7,
                halted: config.consecutiveLossHalted || 10
            },
            // 交易频率（每小时）
            tradeFrequency: {
                warning: config.tradeFrequencyWarning || 5,
                restricted: config.tradeFrequencyRestricted || 8,
                suspended: config.tradeFrequencySuspended || 10,
                halted: config.tradeFrequencyHalted || 15
            },
            // 订单拒绝次数（连续）
            orderRejection: {
                warning: config.orderRejectionWarning || 2,
                restricted: config.orderRejectionRestricted || 3,
                suspended: config.orderRejectionSuspended || 5,
                halted: config.orderRejectionHalted || 8
            },
            // 市场波动率（日内振幅）
            marketVolatility: {
                warning: config.marketVolatilityWarning || 0.05,
                restricted: config.marketVolatilityRestricted || 0.08,
                suspended: config.marketVolatilitySuspended || 0.10,
                halted: config.marketVolatilityHalted || 0.15
            }
        };

        // ========== 限制参数 ==========
        this.restrictions = {
            // 各级别的仓位上限
            positionLimits: {
                [CircuitLevel.NORMAL]: config.normalPositionLimit || 0.8,
                [CircuitLevel.WARNING]: config.warningPositionLimit || 0.6,
                [CircuitLevel.RESTRICTED]: config.restrictedPositionLimit || 0.3,
                [CircuitLevel.SUSPENDED]: 0,  // 暂停不能新开仓
                [CircuitLevel.HALTED]: 0
            },
            // 各级别的单笔上限
            singleTradeLimits: {
                [CircuitLevel.NORMAL]: config.normalSingleLimit || 0.3,
                [CircuitLevel.WARNING]: config.warningSingleLimit || 0.2,
                [CircuitLevel.RESTRICTED]: config.restrictedSingleLimit || 0.1,
                [CircuitLevel.SUSPENDED]: 0,
                [CircuitLevel.HALTED]: 0
            }
        };

        // ========== 冷却期配置（毫秒）==========
        this.cooldownPeriods = {
            [CircuitLevel.WARNING]: config.warningCooldown || 30 * 60 * 1000,      // 30分钟
            [CircuitLevel.RESTRICTED]: config.restrictedCooldown || 2 * 60 * 60 * 1000, // 2小时
            [CircuitLevel.SUSPENDED]: config.suspendedCooldown || 24 * 60 * 60 * 1000,  // 24小时
            [CircuitLevel.HALTED]: config.haltedCooldown || 7 * 24 * 60 * 60 * 1000     // 7天
        };

        // ========== 状态变量 ==========
        this.state = {
            currentLevel: CircuitLevel.NORMAL,
            lastTriggeredAt: null,
            lastTriggeredReason: null,
            triggerHistory: [],
            cooldownEndTime: null,
            consecutiveLosses: 0,
            consecutiveRejections: 0,
            hourlyTradeCount: 0,
            lastHourReset: Date.now()
        };

        // 自动降级检查
        this._startAutoRecoveryCheck();
    }

    /**
     * 检查并更新熔断状态
     * @param {Object} metrics - 当前指标
     * @returns {Object} 熔断检查结果
     */
    check(metrics) {
        const {
            dailyPnL = 0,
            weeklyPnL = 0,
            monthlyPnL = 0,
            currentDrawdown = 0,
            consecutiveLosses = this.state.consecutiveLosses,
            hourlyTrades = this.state.hourlyTradeCount,
            consecutiveRejections = this.state.consecutiveRejections,
            marketVolatility = 0
        } = metrics;

        const triggers = [];
        let maxLevel = CircuitLevel.NORMAL;

        // 检查各类指标
        const checks = [
            { value: Math.abs(dailyPnL), thresholds: this.thresholds.dailyLoss, reason: CircuitReason.DAILY_LOSS, name: '日亏损' },
            { value: Math.abs(weeklyPnL), thresholds: this.thresholds.weeklyLoss, reason: CircuitReason.WEEKLY_LOSS, name: '周亏损' },
            { value: Math.abs(monthlyPnL), thresholds: this.thresholds.monthlyLoss, reason: CircuitReason.MONTHLY_LOSS, name: '月亏损' },
            { value: currentDrawdown, thresholds: this.thresholds.drawdown, reason: CircuitReason.MAX_DRAWDOWN, name: '回撤' },
            { value: consecutiveLosses, thresholds: this.thresholds.consecutiveLoss, reason: CircuitReason.CONSECUTIVE_LOSS, name: '连续亏损' },
            { value: hourlyTrades, thresholds: this.thresholds.tradeFrequency, reason: CircuitReason.TRADE_FREQUENCY, name: '交易频率' },
            { value: consecutiveRejections, thresholds: this.thresholds.orderRejection, reason: CircuitReason.ORDER_REJECTION, name: '订单拒绝' },
            { value: marketVolatility, thresholds: this.thresholds.marketVolatility, reason: CircuitReason.MARKET_VOLATILITY, name: '市场波动' }
        ];

        for (const check of checks) {
            // 只检查亏损（负数转正数）
            if (check.reason === CircuitReason.DAILY_LOSS ||
                check.reason === CircuitReason.WEEKLY_LOSS ||
                check.reason === CircuitReason.MONTHLY_LOSS) {
                if (dailyPnL > 0 || weeklyPnL > 0 || monthlyPnL > 0) {
                    continue;  // 盈利不触发
                }
            }

            const level = this._getLevel(check.value, check.thresholds);
            if (level !== CircuitLevel.NORMAL) {
                triggers.push({
                    reason: check.reason,
                    name: check.name,
                    level,
                    value: check.value,
                    threshold: check.thresholds[level.toLowerCase()]
                });

                if (this._compareLevels(level, maxLevel) > 0) {
                    maxLevel = level;
                }
            }
        }

        // 更新状态
        const previousLevel = this.state.currentLevel;
        if (this._compareLevels(maxLevel, previousLevel) > 0) {
            this._triggerCircuit(maxLevel, triggers[0]?.reason || CircuitReason.SYSTEM_ERROR, triggers);
        }

        return {
            level: this.state.currentLevel,
            triggers,
            canTrade: this.canTrade(),
            canOpenPosition: this.canOpenPosition(),
            positionLimit: this.getPositionLimit(),
            singleTradeLimit: this.getSingleTradeLimit()
        };
    }

    /**
     * 根据值获取熔断级别
     */
    _getLevel(value, thresholds) {
        if (value >= thresholds.halted) return CircuitLevel.HALTED;
        if (value >= thresholds.suspended) return CircuitLevel.SUSPENDED;
        if (value >= thresholds.restricted) return CircuitLevel.RESTRICTED;
        if (value >= thresholds.warning) return CircuitLevel.WARNING;
        return CircuitLevel.NORMAL;
    }

    /**
     * 比较熔断级别
     */
    _compareLevels(level1, level2) {
        const order = {
            [CircuitLevel.NORMAL]: 0,
            [CircuitLevel.WARNING]: 1,
            [CircuitLevel.RESTRICTED]: 2,
            [CircuitLevel.SUSPENDED]: 3,
            [CircuitLevel.HALTED]: 4
        };
        return order[level1] - order[level2];
    }

    /**
     * 触发熔断
     */
    _triggerCircuit(level, reason, triggers) {
        const previousLevel = this.state.currentLevel;

        this.state.currentLevel = level;
        this.state.lastTriggeredAt = new Date();
        this.state.lastTriggeredReason = reason;
        this.state.cooldownEndTime = new Date(Date.now() + this.cooldownPeriods[level]);

        // 记录历史
        this.state.triggerHistory.push({
            level,
            reason,
            triggers,
            timestamp: new Date().toISOString(),
            previousLevel
        });

        // 只保留最近100条记录
        if (this.state.triggerHistory.length > 100) {
            this.state.triggerHistory = this.state.triggerHistory.slice(-100);
        }

        // 发送事件
        this.emit('circuitTriggered', {
            level,
            reason,
            triggers,
            previousLevel,
            cooldownEndTime: this.state.cooldownEndTime
        });

        console.log(`\n🔴 熔断触发: ${previousLevel} -> ${level}`);
        console.log(`   原因: ${reason}`);
        console.log(`   冷却至: ${this.state.cooldownEndTime.toLocaleString()}`);
    }

    /**
     * 手动触发熔断
     */
    manualTrigger(level, reason = CircuitReason.MANUAL) {
        this._triggerCircuit(level, reason, [{ reason, name: '人工触发', level }]);
    }

    /**
     * 手动恢复
     */
    manualRecover(targetLevel = CircuitLevel.NORMAL) {
        const previousLevel = this.state.currentLevel;

        if (this._compareLevels(targetLevel, previousLevel) >= 0) {
            console.log('目标级别不低于当前级别，无法恢复');
            return false;
        }

        this.state.currentLevel = targetLevel;
        this.state.cooldownEndTime = null;

        this.emit('circuitRecovered', {
            level: targetLevel,
            previousLevel,
            manual: true
        });

        console.log(`\n🟢 熔断恢复: ${previousLevel} -> ${targetLevel} (手动)`);
        return true;
    }

    /**
     * 启动自动恢复检查
     */
    _startAutoRecoveryCheck() {
        setInterval(() => {
            // 重置每小时计数
            if (Date.now() - this.state.lastHourReset > 3600000) {
                this.state.hourlyTradeCount = 0;
                this.state.lastHourReset = Date.now();
            }

            // 检查冷却期
            if (this.state.cooldownEndTime && new Date() >= this.state.cooldownEndTime) {
                this._autoRecover();
            }
        }, 60000); // 每分钟检查
    }

    /**
     * 自动恢复（降级）
     */
    _autoRecover() {
        const previousLevel = this.state.currentLevel;
        let newLevel = CircuitLevel.NORMAL;

        // 逐级恢复
        switch (previousLevel) {
            case CircuitLevel.HALTED:
                newLevel = CircuitLevel.SUSPENDED;
                break;
            case CircuitLevel.SUSPENDED:
                newLevel = CircuitLevel.RESTRICTED;
                break;
            case CircuitLevel.RESTRICTED:
                newLevel = CircuitLevel.WARNING;
                break;
            case CircuitLevel.WARNING:
                newLevel = CircuitLevel.NORMAL;
                break;
            default:
                return;
        }

        this.state.currentLevel = newLevel;
        this.state.cooldownEndTime = newLevel !== CircuitLevel.NORMAL
            ? new Date(Date.now() + this.cooldownPeriods[newLevel])
            : null;

        this.emit('circuitRecovered', {
            level: newLevel,
            previousLevel,
            manual: false
        });

        console.log(`\n🟡 熔断自动恢复: ${previousLevel} -> ${newLevel}`);
    }

    /**
     * 记录交易
     */
    recordTrade(trade) {
        this.state.hourlyTradeCount++;

        if (trade.pnl < 0) {
            this.state.consecutiveLosses++;
        } else if (trade.pnl > 0) {
            this.state.consecutiveLosses = 0;
        }
    }

    /**
     * 记录订单拒绝
     */
    recordRejection() {
        this.state.consecutiveRejections++;
    }

    /**
     * 记录订单成功
     */
    recordOrderSuccess() {
        this.state.consecutiveRejections = 0;
    }

    /**
     * 是否可以交易
     */
    canTrade() {
        return this.state.currentLevel !== CircuitLevel.HALTED;
    }

    /**
     * 是否可以开新仓位
     */
    canOpenPosition() {
        return this.state.currentLevel === CircuitLevel.NORMAL ||
               this.state.currentLevel === CircuitLevel.WARNING ||
               this.state.currentLevel === CircuitLevel.RESTRICTED;
    }

    /**
     * 是否可以平仓
     */
    canClosePosition() {
        return this.state.currentLevel !== CircuitLevel.HALTED;
    }

    /**
     * 获取当前仓位上限
     */
    getPositionLimit() {
        return this.restrictions.positionLimits[this.state.currentLevel];
    }

    /**
     * 获取当前单笔上限
     */
    getSingleTradeLimit() {
        return this.restrictions.singleTradeLimits[this.state.currentLevel];
    }

    /**
     * 获取当前状态
     */
    getStatus() {
        return {
            level: this.state.currentLevel,
            lastTriggeredAt: this.state.lastTriggeredAt,
            lastTriggeredReason: this.state.lastTriggeredReason,
            cooldownEndTime: this.state.cooldownEndTime,
            cooldownRemaining: this.state.cooldownEndTime
                ? Math.max(0, this.state.cooldownEndTime - new Date())
                : 0,
            consecutiveLosses: this.state.consecutiveLosses,
            consecutiveRejections: this.state.consecutiveRejections,
            hourlyTradeCount: this.state.hourlyTradeCount,
            canTrade: this.canTrade(),
            canOpenPosition: this.canOpenPosition(),
            positionLimit: this.getPositionLimit(),
            singleTradeLimit: this.getSingleTradeLimit(),
            triggerCount: this.state.triggerHistory.length
        };
    }

    /**
     * 获取触发历史
     */
    getTriggerHistory(limit = 20) {
        return this.state.triggerHistory.slice(-limit);
    }

    /**
     * 重置状态（慎用）
     */
    reset() {
        this.state = {
            currentLevel: CircuitLevel.NORMAL,
            lastTriggeredAt: null,
            lastTriggeredReason: null,
            triggerHistory: [],
            cooldownEndTime: null,
            consecutiveLosses: 0,
            consecutiveRejections: 0,
            hourlyTradeCount: 0,
            lastHourReset: Date.now()
        };

        this.emit('circuitReset');
        console.log('🔄 熔断状态已重置');
    }
}

// ========== 导出 ==========
module.exports = {
    CircuitLevel,
    CircuitReason,
    CircuitBreaker
};
