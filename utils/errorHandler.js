// utils/errorHandler.js
// ============================================
// 异常处理模块
// ============================================
//
// 功能：
// 1. 统一异常分类和处理
// 2. 异常恢复策略
// 3. 重试机制
// 4. 异常日志和告警
// 5. 优雅降级
//

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

/**
 * 错误类型
 */
const ErrorType = {
    // 网络相关
    NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',         // 网络超时
    NETWORK_ERROR: 'NETWORK_ERROR',             // 网络错误
    CONNECTION_LOST: 'CONNECTION_LOST',         // 连接丢失

    // 数据相关
    DATA_PARSE_ERROR: 'DATA_PARSE_ERROR',       // 数据解析错误
    DATA_INVALID: 'DATA_INVALID',               // 数据无效
    DATA_MISSING: 'DATA_MISSING',               // 数据缺失
    DATA_STALE: 'DATA_STALE',                   // 数据过时

    // 交易相关
    ORDER_REJECTED: 'ORDER_REJECTED',           // 订单被拒绝
    ORDER_TIMEOUT: 'ORDER_TIMEOUT',             // 订单超时
    ORDER_FAILED: 'ORDER_FAILED',               // 订单失败
    INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',   // 资金不足
    INSUFFICIENT_SHARES: 'INSUFFICIENT_SHARES', // 持仓不足
    PRICE_LIMIT_HIT: 'PRICE_LIMIT_HIT',         // 触及涨跌停

    // 券商相关
    BROKER_DISCONNECTED: 'BROKER_DISCONNECTED', // 券商断开
    BROKER_ERROR: 'BROKER_ERROR',               // 券商错误
    BROKER_BUSY: 'BROKER_BUSY',                 // 券商繁忙
    BROKER_MAINTENANCE: 'BROKER_MAINTENANCE',   // 券商维护

    // 行情相关
    QUOTE_ERROR: 'QUOTE_ERROR',                 // 行情错误
    QUOTE_DELAYED: 'QUOTE_DELAYED',             // 行情延迟
    QUOTE_UNAVAILABLE: 'QUOTE_UNAVAILABLE',     // 行情不可用

    // 策略相关
    STRATEGY_ERROR: 'STRATEGY_ERROR',           // 策略错误
    SIGNAL_INVALID: 'SIGNAL_INVALID',           // 信号无效

    // 系统相关
    SYSTEM_ERROR: 'SYSTEM_ERROR',               // 系统错误
    MEMORY_ERROR: 'MEMORY_ERROR',               // 内存错误
    DISK_ERROR: 'DISK_ERROR',                   // 磁盘错误

    // 未知
    UNKNOWN: 'UNKNOWN'
};

/**
 * 错误严重程度
 */
const ErrorSeverity = {
    LOW: 'LOW',           // 低 - 可忽略，记录即可
    MEDIUM: 'MEDIUM',     // 中 - 需要处理，但不影响主流程
    HIGH: 'HIGH',         // 高 - 影响当前操作，需要重试或跳过
    CRITICAL: 'CRITICAL', // 致命 - 需要立即停止并告警
    FATAL: 'FATAL'        // 严重致命 - 系统级错误
};

/**
 * 恢复策略
 */
const RecoveryStrategy = {
    IGNORE: 'IGNORE',           // 忽略，继续执行
    RETRY: 'RETRY',             // 重试
    RETRY_BACKOFF: 'RETRY_BACKOFF', // 指数退避重试
    SKIP: 'SKIP',               // 跳过当前操作
    FALLBACK: 'FALLBACK',       // 使用备用方案
    PAUSE: 'PAUSE',             // 暂停操作
    STOP: 'STOP',               // 停止系统
    ALERT: 'ALERT'              // 告警通知
};

/**
 * 交易错误类
 */
class TradingError extends Error {
    constructor(type, message, options = {}) {
        super(message);
        this.name = 'TradingError';
        this.type = type;
        this.severity = options.severity || ErrorSeverity.MEDIUM;
        this.recoverable = options.recoverable !== false;
        this.context = options.context || {};
        this.timestamp = new Date();
        this.originalError = options.originalError || null;
    }

    toJSON() {
        return {
            name: this.name,
            type: this.type,
            message: this.message,
            severity: this.severity,
            recoverable: this.recoverable,
            context: this.context,
            timestamp: this.timestamp.toISOString(),
            stack: this.stack
        };
    }
}

/**
 * 异常处理器
 */
class ErrorHandler extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            // 日志配置
            logDir: config.logDir || path.join(__dirname, '../logs'),
            logToFile: config.logToFile !== false,
            logToConsole: config.logToConsole !== false,

            // 重试配置
            maxRetries: config.maxRetries || 3,
            retryDelay: config.retryDelay || 1000,
            retryBackoffMultiplier: config.retryBackoffMultiplier || 2,
            maxRetryDelay: config.maxRetryDelay || 30000,

            // 告警配置
            alertThreshold: config.alertThreshold || 5, // 同类错误超过此数量告警
            alertWindow: config.alertWindow || 300000,  // 告警窗口期（毫秒）

            // 自动恢复
            autoRecoverEnabled: config.autoRecoverEnabled !== false,

            ...config
        };

        // 错误计数器
        this.errorCounts = new Map();  // type -> [{ timestamp, error }]

        // 错误历史
        this.errorHistory = [];
        this.maxHistorySize = config.maxHistorySize || 1000;

        // 恢复策略映射
        this.recoveryStrategies = this._initRecoveryStrategies();

        // 确保日志目录存在
        this._ensureLogDir();
    }

    /**
     * 初始化恢复策略
     */
    _initRecoveryStrategies() {
        return {
            // 网络错误 - 重试
            [ErrorType.NETWORK_TIMEOUT]: {
                strategy: RecoveryStrategy.RETRY_BACKOFF,
                maxRetries: 3,
                severity: ErrorSeverity.MEDIUM
            },
            [ErrorType.NETWORK_ERROR]: {
                strategy: RecoveryStrategy.RETRY_BACKOFF,
                maxRetries: 3,
                severity: ErrorSeverity.MEDIUM
            },
            [ErrorType.CONNECTION_LOST]: {
                strategy: RecoveryStrategy.RETRY_BACKOFF,
                maxRetries: 5,
                severity: ErrorSeverity.HIGH
            },

            // 数据错误 - 跳过或使用缓存
            [ErrorType.DATA_PARSE_ERROR]: {
                strategy: RecoveryStrategy.SKIP,
                severity: ErrorSeverity.MEDIUM
            },
            [ErrorType.DATA_INVALID]: {
                strategy: RecoveryStrategy.SKIP,
                severity: ErrorSeverity.MEDIUM
            },
            [ErrorType.DATA_MISSING]: {
                strategy: RecoveryStrategy.FALLBACK,
                severity: ErrorSeverity.MEDIUM
            },
            [ErrorType.DATA_STALE]: {
                strategy: RecoveryStrategy.FALLBACK,
                severity: ErrorSeverity.LOW
            },

            // 交易错误
            [ErrorType.ORDER_REJECTED]: {
                strategy: RecoveryStrategy.SKIP,
                severity: ErrorSeverity.MEDIUM
            },
            [ErrorType.ORDER_TIMEOUT]: {
                strategy: RecoveryStrategy.RETRY,
                maxRetries: 2,
                severity: ErrorSeverity.HIGH
            },
            [ErrorType.ORDER_FAILED]: {
                strategy: RecoveryStrategy.SKIP,
                severity: ErrorSeverity.HIGH
            },
            [ErrorType.INSUFFICIENT_FUNDS]: {
                strategy: RecoveryStrategy.SKIP,
                severity: ErrorSeverity.MEDIUM
            },
            [ErrorType.INSUFFICIENT_SHARES]: {
                strategy: RecoveryStrategy.SKIP,
                severity: ErrorSeverity.MEDIUM
            },
            [ErrorType.PRICE_LIMIT_HIT]: {
                strategy: RecoveryStrategy.SKIP,
                severity: ErrorSeverity.LOW
            },

            // 券商错误
            [ErrorType.BROKER_DISCONNECTED]: {
                strategy: RecoveryStrategy.RETRY_BACKOFF,
                maxRetries: 10,
                severity: ErrorSeverity.CRITICAL
            },
            [ErrorType.BROKER_ERROR]: {
                strategy: RecoveryStrategy.RETRY,
                maxRetries: 3,
                severity: ErrorSeverity.HIGH
            },
            [ErrorType.BROKER_BUSY]: {
                strategy: RecoveryStrategy.RETRY_BACKOFF,
                maxRetries: 5,
                severity: ErrorSeverity.MEDIUM
            },
            [ErrorType.BROKER_MAINTENANCE]: {
                strategy: RecoveryStrategy.PAUSE,
                severity: ErrorSeverity.HIGH
            },

            // 行情错误
            [ErrorType.QUOTE_ERROR]: {
                strategy: RecoveryStrategy.FALLBACK,
                severity: ErrorSeverity.MEDIUM
            },
            [ErrorType.QUOTE_DELAYED]: {
                strategy: RecoveryStrategy.IGNORE,
                severity: ErrorSeverity.LOW
            },
            [ErrorType.QUOTE_UNAVAILABLE]: {
                strategy: RecoveryStrategy.RETRY_BACKOFF,
                maxRetries: 3,
                severity: ErrorSeverity.HIGH
            },

            // 策略错误
            [ErrorType.STRATEGY_ERROR]: {
                strategy: RecoveryStrategy.SKIP,
                severity: ErrorSeverity.HIGH
            },
            [ErrorType.SIGNAL_INVALID]: {
                strategy: RecoveryStrategy.SKIP,
                severity: ErrorSeverity.LOW
            },

            // 系统错误
            [ErrorType.SYSTEM_ERROR]: {
                strategy: RecoveryStrategy.STOP,
                severity: ErrorSeverity.CRITICAL
            },
            [ErrorType.MEMORY_ERROR]: {
                strategy: RecoveryStrategy.STOP,
                severity: ErrorSeverity.FATAL
            },
            [ErrorType.DISK_ERROR]: {
                strategy: RecoveryStrategy.ALERT,
                severity: ErrorSeverity.CRITICAL
            },

            // 未知错误
            [ErrorType.UNKNOWN]: {
                strategy: RecoveryStrategy.SKIP,
                severity: ErrorSeverity.HIGH
            }
        };
    }

    _ensureLogDir() {
        if (!fs.existsSync(this.config.logDir)) {
            fs.mkdirSync(this.config.logDir, { recursive: true });
        }
    }

    /**
     * 处理错误
     * @param {Error|TradingError} error - 错误对象
     * @param {Object} context - 上下文信息
     * @returns {Object} 处理结果
     */
    async handle(error, context = {}) {
        // 转换为 TradingError
        const tradingError = error instanceof TradingError
            ? error
            : this._wrapError(error, context);

        // 获取恢复策略
        const strategyConfig = this.recoveryStrategies[tradingError.type] ||
                              this.recoveryStrategies[ErrorType.UNKNOWN];

        // 记录错误
        this._recordError(tradingError);

        // 日志
        this._logError(tradingError);

        // 检查是否需要告警
        if (this._shouldAlert(tradingError)) {
            this._sendAlert(tradingError);
        }

        // 发送事件
        this.emit('error', {
            error: tradingError,
            strategy: strategyConfig.strategy,
            severity: tradingError.severity
        });

        // 执行恢复策略
        const result = await this._executeRecovery(tradingError, strategyConfig, context);

        return result;
    }

    /**
     * 包装普通错误为 TradingError
     */
    _wrapError(error, context) {
        // 根据错误信息推断类型
        let type = ErrorType.UNKNOWN;
        let severity = ErrorSeverity.MEDIUM;

        const message = error.message.toLowerCase();

        if (message.includes('timeout')) {
            type = ErrorType.NETWORK_TIMEOUT;
        } else if (message.includes('network') || message.includes('econnrefused') || message.includes('enotfound')) {
            type = ErrorType.NETWORK_ERROR;
        } else if (message.includes('parse') || message.includes('json')) {
            type = ErrorType.DATA_PARSE_ERROR;
        } else if (message.includes('insufficient') && message.includes('fund')) {
            type = ErrorType.INSUFFICIENT_FUNDS;
        } else if (message.includes('rejected')) {
            type = ErrorType.ORDER_REJECTED;
        } else if (message.includes('disconnect')) {
            type = ErrorType.BROKER_DISCONNECTED;
            severity = ErrorSeverity.CRITICAL;
        }

        return new TradingError(type, error.message, {
            severity,
            context,
            originalError: error
        });
    }

    /**
     * 记录错误
     */
    _recordError(error) {
        const now = Date.now();

        // 更新计数器
        if (!this.errorCounts.has(error.type)) {
            this.errorCounts.set(error.type, []);
        }
        const counts = this.errorCounts.get(error.type);
        counts.push({ timestamp: now, error });

        // 清理过期记录
        const windowStart = now - this.config.alertWindow;
        while (counts.length > 0 && counts[0].timestamp < windowStart) {
            counts.shift();
        }

        // 添加到历史
        this.errorHistory.push(error.toJSON());
        if (this.errorHistory.length > this.maxHistorySize) {
            this.errorHistory = this.errorHistory.slice(-this.maxHistorySize);
        }
    }

    /**
     * 记录日志
     */
    _logError(error) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: error.type,
            severity: error.severity,
            message: error.message,
            context: error.context,
            stack: error.stack
        };

        // 控制台输出
        if (this.config.logToConsole) {
            const severityIcon = {
                [ErrorSeverity.LOW]: '📝',
                [ErrorSeverity.MEDIUM]: '⚠️',
                [ErrorSeverity.HIGH]: '🔶',
                [ErrorSeverity.CRITICAL]: '🔴',
                [ErrorSeverity.FATAL]: '💀'
            };
            console.error(`${severityIcon[error.severity]} [${error.type}] ${error.message}`);
            if (error.severity === ErrorSeverity.CRITICAL || error.severity === ErrorSeverity.FATAL) {
                console.error('  上下文:', error.context);
            }
        }

        // 文件日志
        if (this.config.logToFile) {
            const logFile = path.join(
                this.config.logDir,
                `error_${new Date().toISOString().split('T')[0]}.log`
            );
            fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
        }
    }

    /**
     * 检查是否需要告警
     */
    _shouldAlert(error) {
        const counts = this.errorCounts.get(error.type) || [];
        return counts.length >= this.config.alertThreshold ||
               error.severity === ErrorSeverity.CRITICAL ||
               error.severity === ErrorSeverity.FATAL;
    }

    /**
     * 发送告警
     */
    _sendAlert(error) {
        const counts = this.errorCounts.get(error.type) || [];

        const alert = {
            type: 'ERROR_ALERT',
            errorType: error.type,
            severity: error.severity,
            message: error.message,
            count: counts.length,
            window: `${this.config.alertWindow / 60000} 分钟`,
            timestamp: new Date().toISOString()
        };

        console.log('\n🚨 ========== 错误告警 ==========');
        console.log(`   类型: ${error.type}`);
        console.log(`   严重程度: ${error.severity}`);
        console.log(`   消息: ${error.message}`);
        console.log(`   发生次数: ${counts.length} 次`);
        console.log('=================================\n');

        this.emit('alert', alert);

        // 这里可以扩展发送邮件、短信、微信等通知
    }

    /**
     * 执行恢复策略
     */
    async _executeRecovery(error, strategyConfig, context) {
        const { strategy, maxRetries = this.config.maxRetries } = strategyConfig;

        switch (strategy) {
            case RecoveryStrategy.IGNORE:
                return { action: 'ignored', continue: true };

            case RecoveryStrategy.RETRY:
                return await this._retryWithDelay(context.operation, maxRetries, this.config.retryDelay);

            case RecoveryStrategy.RETRY_BACKOFF:
                return await this._retryWithBackoff(context.operation, maxRetries);

            case RecoveryStrategy.SKIP:
                return { action: 'skipped', continue: true };

            case RecoveryStrategy.FALLBACK:
                if (context.fallback) {
                    try {
                        const result = await context.fallback();
                        return { action: 'fallback', continue: true, result };
                    } catch (fallbackError) {
                        return { action: 'fallback_failed', continue: false, error: fallbackError };
                    }
                }
                return { action: 'no_fallback', continue: false };

            case RecoveryStrategy.PAUSE:
                this.emit('pauseRequested', { error });
                return { action: 'paused', continue: false };

            case RecoveryStrategy.STOP:
                this.emit('stopRequested', { error });
                return { action: 'stopped', continue: false };

            case RecoveryStrategy.ALERT:
                this._sendAlert(error);
                return { action: 'alerted', continue: true };

            default:
                return { action: 'unknown', continue: false };
        }
    }

    /**
     * 固定延迟重试
     */
    async _retryWithDelay(operation, maxRetries, delay) {
        if (!operation) {
            return { action: 'no_operation', continue: false };
        }

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this._sleep(delay);
                const result = await operation();
                return { action: 'retry_success', continue: true, result, attempts: attempt };
            } catch (err) {
                if (attempt === maxRetries) {
                    return { action: 'retry_failed', continue: false, error: err, attempts: attempt };
                }
            }
        }
    }

    /**
     * 指数退避重试
     */
    async _retryWithBackoff(operation, maxRetries) {
        if (!operation) {
            return { action: 'no_operation', continue: false };
        }

        let delay = this.config.retryDelay;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this._sleep(delay);
                const result = await operation();
                return { action: 'retry_success', continue: true, result, attempts: attempt };
            } catch (err) {
                if (attempt === maxRetries) {
                    return { action: 'retry_failed', continue: false, error: err, attempts: attempt };
                }
                // 指数退避
                delay = Math.min(delay * this.config.retryBackoffMultiplier, this.config.maxRetryDelay);
            }
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 创建包装器，自动处理错误
     */
    wrap(fn, context = {}) {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                const result = await this.handle(error, {
                    ...context,
                    operation: () => fn(...args),
                    args
                });

                if (result.continue && result.result !== undefined) {
                    return result.result;
                }

                throw error;
            }
        };
    }

    /**
     * 获取错误统计
     */
    getStats() {
        const stats = {
            totalErrors: this.errorHistory.length,
            byType: {},
            bySeverity: {},
            recentErrors: this.errorHistory.slice(-10)
        };

        for (const error of this.errorHistory) {
            stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
            stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
        }

        return stats;
    }

    /**
     * 清空历史
     */
    clearHistory() {
        this.errorHistory = [];
        this.errorCounts.clear();
    }
}

// ========== 创建全局异常处理器 ==========
function setupGlobalErrorHandling(handler) {
    // 未捕获的 Promise 拒绝
    process.on('unhandledRejection', (reason, promise) => {
        console.error('未处理的 Promise 拒绝:', reason);
        handler.handle(new TradingError(ErrorType.SYSTEM_ERROR, `Unhandled Rejection: ${reason}`, {
            severity: ErrorSeverity.CRITICAL,
            context: { promise }
        }));
    });

    // 未捕获的异常
    process.on('uncaughtException', (error) => {
        console.error('未捕获的异常:', error);
        handler.handle(new TradingError(ErrorType.SYSTEM_ERROR, `Uncaught Exception: ${error.message}`, {
            severity: ErrorSeverity.FATAL,
            originalError: error
        }));
    });

    // 内存警告
    process.on('warning', (warning) => {
        if (warning.name === 'MaxListenersExceededWarning') {
            handler.handle(new TradingError(ErrorType.MEMORY_ERROR, warning.message, {
                severity: ErrorSeverity.HIGH
            }));
        }
    });
}

// ========== 导出 ==========
module.exports = {
    ErrorType,
    ErrorSeverity,
    RecoveryStrategy,
    TradingError,
    ErrorHandler,
    setupGlobalErrorHandling
};
