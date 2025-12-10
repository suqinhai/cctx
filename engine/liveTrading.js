// engine/liveTrading.js
// ============================================
// 实盘交易引擎 - 连接策略、行情和券商
// ============================================
//
// 功能：
// 1. 实时获取行情数据
// 2. 运行策略生成交易信号
// 3. 通过券商接口执行交易
// 4. 风险控制和仓位管理
// 5. A股交易规则验证
// 6. 熔断机制和异常处理
//
// 使用方法：
//   const { LiveTradingEngine } = require('./engine/liveTrading');
//   const engine = new LiveTradingEngine(config);
//   await engine.start();
//

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

// 引入新增模块
const { AShareRules, rules: aShareRules, TradingSession, StockStatus } = require('../utils/aShareRules');
const { CircuitBreaker, CircuitLevel, CircuitReason } = require('../utils/circuitBreaker');
const { ErrorHandler, TradingError, ErrorType, ErrorSeverity, setupGlobalErrorHandling } = require('../utils/errorHandler');

/**
 * 实盘交易引擎
 */
class LiveTradingEngine extends EventEmitter {
    constructor(config = {}) {
        super();

        // ========== 基本配置 ==========
        this.config = {
            // 交易标的
            symbols: config.symbols || [],

            // 策略类
            StrategyClass: config.StrategyClass,
            strategyConfig: config.strategyConfig || {},

            // 行情配置
            quoteSource: config.quoteSource || 'sina',
            quoteInterval: config.quoteInterval || 3000,

            // 风控配置
            maxPositionRatio: config.maxPositionRatio || 0.8,    // 最大仓位比例
            maxSingleRatio: config.maxSingleRatio || 0.3,       // 单标的最大比例
            maxDailyLoss: config.maxDailyLoss || 0.05,          // 单日最大亏损
            maxDrawdown: config.maxDrawdown || 0.15,            // 最大回撤
            stopLossEnabled: config.stopLossEnabled !== false,  // 是否启用止损

            // 交易时间配置
            tradingStartTime: config.tradingStartTime || '09:30',
            tradingEndTime: config.tradingEndTime || '15:00',
            lunchBreakStart: config.lunchBreakStart || '11:30',
            lunchBreakEnd: config.lunchBreakEnd || '13:00',

            // 日志配置
            logDir: config.logDir || path.join(__dirname, '../logs'),
            enableLogging: config.enableLogging !== false,

            ...config
        };

        // ========== 模块引用 ==========
        this.broker = null;           // 券商接口
        this.quoteManager = null;     // 行情管理器
        this.strategies = new Map();  // 策略实例 symbol -> strategy

        // ========== 新增模块 ==========
        this.aShareRules = aShareRules;  // A股交易规则
        this.circuitBreaker = new CircuitBreaker(config.circuitBreakerConfig || {});
        this.errorHandler = new ErrorHandler({
            logDir: this.config.logDir,
            ...config.errorHandlerConfig
        });

        // 设置全局异常处理
        setupGlobalErrorHandling(this.errorHandler);

        // 监听熔断事件
        this._setupCircuitBreakerListeners();

        // 监听异常处理事件
        this._setupErrorHandlerListeners();

        // ========== 运行状态 ==========
        this.running = false;
        this.paused = false;
        this.startTime = null;
        this.dailyStartNav = null;

        // ========== 历史数据缓存 ==========
        this.historyData = new Map();  // symbol -> K线数据数组
        this.historyLength = config.historyLength || 100;  // 保留多少根K线

        // ========== 订单管理 ==========
        this.pendingOrders = new Map();  // 待处理订单
        this.todayOrders = [];           // 今日订单记录
        this.todayTrades = [];           // 今日成交记录

        // ========== 风控状态 ==========
        this.riskStatus = {
            dailyPnL: 0,           // 当日盈亏
            currentDrawdown: 0,    // 当前回撤
            peakNav: 0,            // 历史最高净值
            tradingEnabled: true,  // 是否允许交易
            riskAlerts: []         // 风险警报
        };

        // 确保日志目录存在
        this._ensureLogDir();
    }

    _ensureLogDir() {
        if (!fs.existsSync(this.config.logDir)) {
            fs.mkdirSync(this.config.logDir, { recursive: true });
        }
    }

    /**
     * 设置熔断器监听
     */
    _setupCircuitBreakerListeners() {
        this.circuitBreaker.on('circuitTriggered', ({ level, reason, triggers, previousLevel, cooldownEndTime }) => {
            this.log('WARN', '熔断触发', { level, reason, previousLevel });

            // 根据熔断级别采取行动
            if (level === CircuitLevel.SUSPENDED || level === CircuitLevel.HALTED) {
                this.riskStatus.tradingEnabled = false;
                this.emit('circuitBreaker', { level, reason, cooldownEndTime });

                // 如果是停止级别，暂停引擎
                if (level === CircuitLevel.HALTED) {
                    this.pause();
                }
            }
        });

        this.circuitBreaker.on('circuitRecovered', ({ level, previousLevel, manual }) => {
            this.log('INFO', '熔断恢复', { level, previousLevel, manual });

            // 恢复交易
            if (level === CircuitLevel.NORMAL || level === CircuitLevel.WARNING || level === CircuitLevel.RESTRICTED) {
                this.riskStatus.tradingEnabled = true;
                this.emit('circuitRecovered', { level, previousLevel });
            }
        });
    }

    /**
     * 设置异常处理器监听
     */
    _setupErrorHandlerListeners() {
        this.errorHandler.on('error', ({ error, strategy, severity }) => {
            // 记录到风险状态
            this.riskStatus.riskAlerts.push({
                type: error.type,
                message: error.message,
                severity,
                time: new Date().toISOString()
            });

            // 只保留最近20条
            if (this.riskStatus.riskAlerts.length > 20) {
                this.riskStatus.riskAlerts = this.riskStatus.riskAlerts.slice(-20);
            }
        });

        this.errorHandler.on('alert', (alert) => {
            this.emit('errorAlert', alert);
        });

        this.errorHandler.on('pauseRequested', ({ error }) => {
            this.log('WARN', '异常处理请求暂停', { error: error.message });
            this.pause();
        });

        this.errorHandler.on('stopRequested', ({ error }) => {
            this.log('ERROR', '异常处理请求停止', { error: error.message });
            this.stop();
        });
    }

    /**
     * 设置券商接口
     */
    setBroker(broker) {
        this.broker = broker;

        // 监听券商事件
        broker.on('orderFilled', (order, trade) => {
            this.onOrderFilled(order, trade);
        });

        broker.on('orderCancelled', (order) => {
            this.onOrderCancelled(order);
        });

        broker.on('orderRejected', (order, reason) => {
            this.onOrderRejected(order, reason);
        });

        this.log('INFO', '券商接口已设置', { brokerType: broker.constructor.name });
    }

    /**
     * 设置行情管理器
     */
    setQuoteManager(manager) {
        this.quoteManager = manager;

        // 将行情管理器注入券商（用于计算市值等）
        if (this.broker && typeof this.broker.setQuoteManager === 'function') {
            this.broker.setQuoteManager(manager);
        }

        this.log('INFO', '行情管理器已设置');
    }

    /**
     * 初始化策略
     */
    initStrategies() {
        const { StrategyClass, strategyConfig, symbols } = this.config;

        if (!StrategyClass) {
            throw new Error('未配置策略类');
        }

        // 为每个标的创建策略实例
        symbols.forEach(symbol => {
            const strategy = new StrategyClass(strategyConfig);
            this.strategies.set(symbol, strategy);
            this.historyData.set(symbol, []);
        });

        this.log('INFO', '策略初始化完成', {
            strategyName: StrategyClass.name,
            symbols: symbols
        });
    }

    /**
     * 启动引擎
     */
    async start() {
        if (this.running) {
            this.log('WARN', '引擎已在运行中');
            return;
        }

        try {
            // 检查必要组件
            if (!this.broker) {
                throw new Error('未设置券商接口');
            }
            if (!this.quoteManager) {
                throw new Error('未设置行情管理器');
            }

            // 连接券商
            await this.broker.connect();

            // 初始化策略
            this.initStrategies();

            // 获取账户信息
            const account = await this.broker.getAccount();
            this.dailyStartNav = account.totalAssets;
            this.riskStatus.peakNav = Math.max(this.riskStatus.peakNav, account.totalAssets);

            // 订阅行情
            this.quoteManager.subscribe(this.config.symbols, (quotes) => {
                this.onQuoteUpdate(quotes);
            });

            // 设置运行状态
            this.running = true;
            this.startTime = new Date();

            this.log('INFO', '实盘交易引擎已启动', {
                symbols: this.config.symbols,
                account: account
            });

            this.emit('started', { account, symbols: this.config.symbols });

            // 启动定时任务
            this._startScheduledTasks();

        } catch (error) {
            this.log('ERROR', '启动失败', { error: error.message });
            throw error;
        }
    }

    /**
     * 停止引擎
     */
    async stop() {
        if (!this.running) {
            return;
        }

        this.running = false;

        // 停止行情订阅
        if (this.quoteManager) {
            this.quoteManager.stopPolling();
        }

        // 撤销所有未成交订单
        await this.cancelAllPendingOrders();

        // 断开券商连接
        if (this.broker) {
            await this.broker.disconnect();
        }

        // 停止定时任务
        this._stopScheduledTasks();

        this.log('INFO', '实盘交易引擎已停止');
        this.emit('stopped');
    }

    /**
     * 暂停交易
     */
    pause() {
        this.paused = true;
        this.log('INFO', '交易已暂停');
        this.emit('paused');
    }

    /**
     * 恢复交易
     */
    resume() {
        this.paused = false;
        this.log('INFO', '交易已恢复');
        this.emit('resumed');
    }

    /**
     * 行情更新处理
     */
    async onQuoteUpdate(quotes) {
        if (!this.running || this.paused) return;

        // 检查是否在交易时间
        if (!this.isTradingTime()) {
            return;
        }

        // 处理每个标的
        for (const [symbol, quote] of Object.entries(quotes)) {
            try {
                await this.processSymbol(symbol, quote);
            } catch (error) {
                this.log('ERROR', '处理标的失败', { symbol, error: error.message });
            }
        }

        // 更新风控状态
        await this.updateRiskStatus();
    }

    /**
     * 处理单个标的
     */
    async processSymbol(symbol, quote) {
        const strategy = this.strategies.get(symbol);
        if (!strategy) return;

        // 更新历史数据
        this.updateHistoryData(symbol, quote);

        // 获取历史数据
        const history = this.historyData.get(symbol);
        if (history.length < 20) {
            // 历史数据不足，跳过
            return;
        }

        // 获取当前持仓
        const position = await this.broker.getPosition(symbol);
        const account = await this.broker.getAccount();

        // 计算当前净值
        const nav = account.totalAssets;

        // 调用策略
        const signal = strategy.onBar({
            data: history,
            i: history.length - 1,
            cash: account.available,
            position: position ? position.shares : 0,
            nav: nav,
            quote: quote  // 传入实时行情
        });

        // 处理信号
        if (signal) {
            await this.handleSignal(symbol, signal, quote, account, position);
        }

        // 检查止损
        if (this.config.stopLossEnabled && position && position.shares > 0) {
            await this.checkStopLoss(symbol, quote, position);
        }
    }

    /**
     * 更新历史数据
     */
    updateHistoryData(symbol, quote) {
        const history = this.historyData.get(symbol);
        if (!history) return;

        // 获取当前日期
        const today = new Date().toISOString().split('T')[0];

        // 检查是否是同一天的数据
        if (history.length > 0) {
            const lastBar = history[history.length - 1];
            if (lastBar.date === today) {
                // 更新今日K线
                lastBar.high = Math.max(lastBar.high, quote.price);
                lastBar.low = Math.min(lastBar.low, quote.price);
                lastBar.close = quote.price;
                lastBar.volume = quote.volume;
                return;
            }
        }

        // 添加新K线
        const newBar = {
            date: today,
            open: quote.open || quote.price,
            high: quote.high || quote.price,
            low: quote.low || quote.price,
            close: quote.price,
            volume: quote.volume || 0
        };

        history.push(newBar);

        // 保持历史数据长度
        while (history.length > this.config.historyLength) {
            history.shift();
        }
    }

    /**
     * 处理交易信号
     */
    async handleSignal(symbol, signal, quote, account, position) {
        // 1. 风控检查
        if (!this.riskStatus.tradingEnabled) {
            this.log('WARN', '风控限制，信号被忽略', { symbol, signal: signal.type });
            return;
        }

        // 2. 熔断检查
        const circuitStatus = this.circuitBreaker.check({
            dailyPnL: this.riskStatus.dailyPnL,
            weeklyPnL: this.riskStatus.weeklyPnL || 0,
            monthlyPnL: this.riskStatus.monthlyPnL || 0,
            currentDrawdown: this.riskStatus.currentDrawdown
        });

        if (!circuitStatus.canTrade) {
            this.log('WARN', '熔断限制，信号被忽略', { symbol, level: circuitStatus.level });
            return;
        }

        // 3. A股交易时段检查
        const session = this.aShareRules.getTradingSession();
        const orderCheck = this.aShareRules.canPlaceOrder();
        if (!orderCheck.canOrder) {
            this.log('WARN', '非交易时段，信号被忽略', { symbol, session, reason: orderCheck.reason });
            return;
        }

        const price = quote.price;

        if (signal.type === 'BUY' && (!position || position.shares === 0)) {
            // 4. A股买入检查
            const buyCheck = this.aShareRules.checkBuyable(symbol, quote.name, quote);
            if (!buyCheck.canBuy) {
                this.log('WARN', '买入检查未通过', { symbol, reasons: buyCheck.reasons });
                return;
            }
            if (buyCheck.reasons.length > 0) {
                this.log('INFO', '买入警告', { symbol, warnings: buyCheck.reasons });
            }

            // 5. 检查熔断限制的仓位上限
            if (!circuitStatus.canOpenPosition) {
                this.log('WARN', '熔断限制，不能开新仓', { symbol, level: circuitStatus.level });
                return;
            }

            // 买入信号
            await this.executeBuy(symbol, signal, quote, account, circuitStatus);

        } else if (signal.type === 'SELL' && position && position.shares > 0) {
            // 6. A股卖出检查
            const sellCheck = this.aShareRules.checkSellable(symbol, position, quote);
            if (!sellCheck.canSell) {
                this.log('WARN', '卖出检查未通过', { symbol, reasons: sellCheck.reasons });
                return;
            }

            // 卖出信号
            await this.executeSell(symbol, signal, quote, position);
        }
    }

    /**
     * 执行买入
     */
    async executeBuy(symbol, signal, quote, account, circuitStatus = null) {
        try {
            const price = signal.entryPrice || quote.ask1 || quote.price;
            let shares = signal.shares || 0;

            // 1. 获取熔断限制的仓位上限
            const circuitPositionLimit = circuitStatus ? circuitStatus.positionLimit : this.config.maxPositionRatio;
            const circuitSingleLimit = circuitStatus ? circuitStatus.singleTradeLimit : this.config.maxSingleRatio;

            // 2. 检查单标的仓位限制（取熔断和配置的较小值）
            const singleLimit = Math.min(this.config.maxSingleRatio, circuitSingleLimit);
            const maxAmount = account.totalAssets * singleLimit;
            const maxShares = Math.floor(maxAmount / price / 100) * 100;
            shares = Math.min(shares, maxShares);

            // 3. 检查总仓位限制（取熔断和配置的较小值）
            const positionLimit = Math.min(this.config.maxPositionRatio, circuitPositionLimit);
            const currentPositionValue = account.marketValue;
            const maxPositionValue = account.totalAssets * positionLimit;
            const availableForBuy = maxPositionValue - currentPositionValue;
            const maxSharesByPosition = Math.floor(availableForBuy / price / 100) * 100;
            shares = Math.min(shares, maxSharesByPosition);

            // 4. 检查可用资金（预留手续费）
            const fees = this.aShareRules.calculateFees('BUY', shares * price);
            const requiredCash = shares * price + fees.totalFee;
            if (requiredCash > account.available) {
                shares = Math.floor((account.available - 50) / price / 100) * 100; // 预留50元手续费
            }

            // 5. A股数量验证
            const quantityCheck = this.aShareRules.validateQuantity(symbol, shares, false);
            if (!quantityCheck.valid) {
                this.log('WARN', '买入数量验证失败', { symbol, reason: quantityCheck.reason });
                shares = quantityCheck.adjustedQuantity;
            }

            // 6. 获取最小交易单位
            const minUnit = this.aShareRules.getMinTradeUnit(symbol);
            if (shares < minUnit) {
                this.log('WARN', `买入股数不足${minUnit}股，取消订单`, { symbol, shares });
                return;
            }

            // 7. 价格精度调整
            const adjustedPrice = this.aShareRules.adjustPrice(price);

            // 8. 提交订单
            const order = {
                code: symbol,
                side: 'BUY',
                type: 'LIMIT',
                price: adjustedPrice,
                quantity: shares,
                stopPrice: signal.stopPrice
            };

            const result = await this.broker.submitOrder(order);

            if (result.success) {
                // 记录成功
                this.circuitBreaker.recordOrderSuccess();

                this.pendingOrders.set(result.orderId, {
                    ...order,
                    orderId: result.orderId,
                    signal: signal,
                    submitTime: new Date().toISOString()
                });

                this.todayOrders.push({
                    orderId: result.orderId,
                    ...order,
                    submitTime: new Date().toISOString()
                });

                this.log('INFO', '买入订单已提交', {
                    orderId: result.orderId,
                    symbol,
                    price: adjustedPrice,
                    shares
                });

                this.emit('orderSubmitted', { orderId: result.orderId, order });
            } else {
                // 记录拒绝
                this.circuitBreaker.recordRejection();
                this.log('WARN', '买入订单提交失败', { symbol, reason: result.message });
            }
        } catch (error) {
            // 异常处理
            await this.errorHandler.handle(
                new TradingError(ErrorType.ORDER_FAILED, `买入订单异常: ${error.message}`, {
                    severity: ErrorSeverity.HIGH,
                    context: { symbol, signal },
                    originalError: error
                })
            );
        }
    }

    /**
     * 执行卖出
     */
    async executeSell(symbol, signal, quote, position) {
        try {
            const price = signal.exitPrice || quote.bid1 || quote.price;
            let shares = position.availableShares;  // 使用可卖数量

            // 1. A股卖出数量验证（卖出时可以卖零股）
            const quantityCheck = this.aShareRules.validateQuantity(symbol, shares, true);
            shares = quantityCheck.adjustedQuantity;

            if (shares <= 0) {
                this.log('WARN', '无可卖股数', { symbol, availableShares: position.availableShares });
                return;
            }

            // 2. 价格精度调整
            const adjustedPrice = this.aShareRules.adjustPrice(price);

            const order = {
                code: symbol,
                side: 'SELL',
                type: 'LIMIT',
                price: adjustedPrice,
                quantity: shares
            };

            const result = await this.broker.submitOrder(order);

            if (result.success) {
                // 记录成功
                this.circuitBreaker.recordOrderSuccess();

                this.pendingOrders.set(result.orderId, {
                    ...order,
                    orderId: result.orderId,
                    signal: signal,
                    submitTime: new Date().toISOString()
                });

                this.todayOrders.push({
                    orderId: result.orderId,
                    ...order,
                    submitTime: new Date().toISOString()
                });

                this.log('INFO', '卖出订单已提交', {
                    orderId: result.orderId,
                    symbol,
                    price: adjustedPrice,
                    shares
                });

                this.emit('orderSubmitted', { orderId: result.orderId, order });
            } else {
                // 记录拒绝
                this.circuitBreaker.recordRejection();
                this.log('WARN', '卖出订单提交失败', { symbol, reason: result.message });
            }
        } catch (error) {
            // 异常处理
            await this.errorHandler.handle(
                new TradingError(ErrorType.ORDER_FAILED, `卖出订单异常: ${error.message}`, {
                    severity: ErrorSeverity.HIGH,
                    context: { symbol, signal },
                    originalError: error
                })
            );
        }
    }

    /**
     * 检查止损
     */
    async checkStopLoss(symbol, quote, position) {
        // 获取策略中设置的止损价
        const strategy = this.strategies.get(symbol);
        if (!strategy || !strategy.stopPrice) return;

        const stopPrice = strategy.stopPrice;
        const currentPrice = quote.price;

        if (currentPrice <= stopPrice) {
            this.log('WARN', '触发止损', {
                symbol,
                currentPrice,
                stopPrice,
                lossPercent: ((currentPrice - position.avgPrice) / position.avgPrice * 100).toFixed(2) + '%'
            });

            // 市价卖出
            const order = {
                code: symbol,
                side: 'SELL',
                type: 'MARKET',
                quantity: position.availableShares
            };

            const result = await this.broker.submitOrder(order);
            if (result.success) {
                this.emit('stopLossTriggered', { symbol, stopPrice, currentPrice });
            }
        }
    }

    /**
     * 订单成交回调
     */
    onOrderFilled(order, trade) {
        this.pendingOrders.delete(order.orderId);
        this.todayTrades.push(trade);

        // 记录到熔断器（用于连续亏损统计）
        if (trade.pnl !== undefined) {
            this.circuitBreaker.recordTrade(trade);
        }

        this.log('INFO', '订单成交', {
            orderId: order.orderId,
            symbol: order.code,
            side: order.side,
            price: trade.price,
            quantity: trade.quantity,
            pnl: trade.pnl
        });

        this.emit('orderFilled', { order, trade });
    }

    /**
     * 订单取消回调
     */
    onOrderCancelled(order) {
        this.pendingOrders.delete(order.orderId);

        this.log('INFO', '订单已取消', { orderId: order.orderId });
        this.emit('orderCancelled', { order });
    }

    /**
     * 订单拒绝回调
     */
    onOrderRejected(order, reason) {
        this.pendingOrders.delete(order.orderId);

        // 记录到熔断器（用于连续拒绝统计）
        this.circuitBreaker.recordRejection();

        this.log('WARN', '订单被拒绝', { orderId: order.orderId, reason });
        this.emit('orderRejected', { order, reason });
    }

    /**
     * 撤销所有未成交订单
     */
    async cancelAllPendingOrders() {
        const orderIds = Array.from(this.pendingOrders.keys());

        for (const orderId of orderIds) {
            try {
                await this.broker.cancelOrder(orderId);
            } catch (error) {
                this.log('ERROR', '撤单失败', { orderId, error: error.message });
            }
        }
    }

    /**
     * 更新风控状态
     */
    async updateRiskStatus() {
        try {
            const account = await this.broker.getAccount();
            const currentNav = account.totalAssets;

            // 更新当日盈亏
            this.riskStatus.dailyPnL = (currentNav - this.dailyStartNav) / this.dailyStartNav;

            // 更新最高净值和回撤
            if (currentNav > this.riskStatus.peakNav) {
                this.riskStatus.peakNav = currentNav;
            }
            this.riskStatus.currentDrawdown = (this.riskStatus.peakNav - currentNav) / this.riskStatus.peakNav;

            // 检查风控规则
            let tradingEnabled = true;
            const alerts = [];

            // 单日亏损检查
            if (this.riskStatus.dailyPnL <= -this.config.maxDailyLoss) {
                tradingEnabled = false;
                alerts.push(`单日亏损超限: ${(this.riskStatus.dailyPnL * 100).toFixed(2)}%`);
            }

            // 最大回撤检查
            if (this.riskStatus.currentDrawdown >= this.config.maxDrawdown) {
                tradingEnabled = false;
                alerts.push(`回撤超限: ${(this.riskStatus.currentDrawdown * 100).toFixed(2)}%`);
            }

            // 更新状态
            const wasEnabled = this.riskStatus.tradingEnabled;
            this.riskStatus.tradingEnabled = tradingEnabled;
            this.riskStatus.riskAlerts = alerts;

            // 如果状态变化，发送事件
            if (wasEnabled && !tradingEnabled) {
                this.log('WARN', '风控触发，交易已暂停', { alerts });
                this.emit('riskAlert', { alerts, riskStatus: this.riskStatus });
            }

        } catch (error) {
            this.log('ERROR', '更新风控状态失败', { error: error.message });
        }
    }

    /**
     * 判断是否在交易时间
     */
    isTradingTime() {
        const now = new Date();
        const day = now.getDay();

        // 周末不交易
        if (day === 0 || day === 6) return false;

        const timeStr = now.toTimeString().substring(0, 5);  // HH:MM

        // 上午交易时段
        if (timeStr >= this.config.tradingStartTime &&
            timeStr < this.config.lunchBreakStart) {
            return true;
        }

        // 下午交易时段
        if (timeStr >= this.config.lunchBreakEnd &&
            timeStr < this.config.tradingEndTime) {
            return true;
        }

        return false;
    }

    /**
     * 启动定时任务
     */
    _startScheduledTasks() {
        // 每天收盘后重置日盈亏
        this._dailyResetTimer = setInterval(() => {
            const now = new Date();
            const timeStr = now.toTimeString().substring(0, 5);

            if (timeStr === '15:05') {
                this.dailyReset();
            }
        }, 60000);  // 每分钟检查

        // 如果使用模拟交易，每天开盘前更新T+1
        this._t1UpdateTimer = setInterval(() => {
            const now = new Date();
            const timeStr = now.toTimeString().substring(0, 5);

            if (timeStr === '09:25' && this.broker.updateAvailableShares) {
                this.broker.updateAvailableShares();
                this.log('INFO', 'T+1可卖数量已更新');
            }
        }, 60000);
    }

    /**
     * 停止定时任务
     */
    _stopScheduledTasks() {
        if (this._dailyResetTimer) {
            clearInterval(this._dailyResetTimer);
            this._dailyResetTimer = null;
        }
        if (this._t1UpdateTimer) {
            clearInterval(this._t1UpdateTimer);
            this._t1UpdateTimer = null;
        }
    }

    /**
     * 每日重置
     */
    async dailyReset() {
        const account = await this.broker.getAccount();

        // 记录每日收盘状态
        this.log('INFO', '每日结算', {
            date: new Date().toISOString().split('T')[0],
            nav: account.totalAssets,
            dailyPnL: this.riskStatus.dailyPnL,
            trades: this.todayTrades.length,
            orders: this.todayOrders.length
        });

        // 重置日统计
        this.dailyStartNav = account.totalAssets;
        this.riskStatus.dailyPnL = 0;
        this.riskStatus.tradingEnabled = true;
        this.riskStatus.riskAlerts = [];
        this.todayOrders = [];
        this.todayTrades = [];

        this.emit('dailyReset', { nav: account.totalAssets });
    }

    /**
     * 获取当前状态
     */
    async getStatus() {
        const account = await this.broker.getAccount();
        const positions = await this.broker.getPositions();

        return {
            running: this.running,
            paused: this.paused,
            startTime: this.startTime,
            account,
            positions,
            riskStatus: this.riskStatus,
            pendingOrders: Array.from(this.pendingOrders.values()),
            todayOrders: this.todayOrders,
            todayTrades: this.todayTrades
        };
    }

    /**
     * 记录日志
     */
    log(level, message, data = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            ...data
        };

        console.log(`[${timestamp}] [${level}] [LiveTrading] ${message}`, data);

        if (this.config.enableLogging) {
            const logFile = path.join(
                this.config.logDir,
                `live_${new Date().toISOString().split('T')[0]}.log`
            );
            fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
        }
    }
}

// ========== 导出 ==========
module.exports = {
    LiveTradingEngine
};
