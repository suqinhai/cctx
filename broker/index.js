// broker/index.js
// ============================================
// 券商交易接口模块
// ============================================
//
// 支持的交易方式：
// 1. 模拟交易 - 用于测试（默认）
// 2. 同花顺交易 - 通过同花顺客户端
// 3. QMT/Ptrade - 券商量化接口（需要开通）
// 4. 东方财富 - 通过东财客户端
//
// 注意：真实交易需要自行申请券商接口权限
//

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

// ========== 订单状态枚举 ==========
const OrderStatus = {
    PENDING: 'PENDING',           // 待提交
    SUBMITTED: 'SUBMITTED',       // 已提交
    PARTIAL_FILLED: 'PARTIAL_FILLED', // 部分成交
    FILLED: 'FILLED',             // 完全成交
    CANCELLED: 'CANCELLED',       // 已撤单
    REJECTED: 'REJECTED',         // 已拒绝
    EXPIRED: 'EXPIRED'            // 已过期
};

// ========== 订单方向枚举 ==========
const OrderSide = {
    BUY: 'BUY',
    SELL: 'SELL'
};

// ========== 订单类型枚举 ==========
const OrderType = {
    MARKET: 'MARKET',             // 市价单
    LIMIT: 'LIMIT',               // 限价单
    LIMIT_MAKER: 'LIMIT_MAKER'    // 只做maker
};

/**
 * 券商交易基类
 * 所有具体券商实现都继承此类
 */
class BaseBroker extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = config;
        this.connected = false;
        this.account = null;

        // 订单管理
        this.orders = new Map();        // orderId -> order
        this.positions = new Map();     // code -> position

        // 日志
        this.logDir = config.logDir || path.join(__dirname, '../logs');
        this._ensureLogDir();
    }

    _ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    /**
     * 生成订单ID
     */
    generateOrderId() {
        return `ORD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

        console.log(`[${timestamp}] [${level}] ${message}`, data);

        // 写入日志文件
        const logFile = path.join(this.logDir, `trade_${new Date().toISOString().split('T')[0]}.log`);
        fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    }

    // ========== 以下方法需要子类实现 ==========

    async connect() {
        throw new Error('connect() must be implemented');
    }

    async disconnect() {
        throw new Error('disconnect() must be implemented');
    }

    async getAccount() {
        throw new Error('getAccount() must be implemented');
    }

    async getPositions() {
        throw new Error('getPositions() must be implemented');
    }

    async submitOrder(order) {
        throw new Error('submitOrder() must be implemented');
    }

    async cancelOrder(orderId) {
        throw new Error('cancelOrder() must be implemented');
    }

    async getOrderStatus(orderId) {
        throw new Error('getOrderStatus() must be implemented');
    }
}

/**
 * 模拟交易券商
 * 用于测试和验证策略，无需真实资金
 */
class SimulatedBroker extends BaseBroker {
    constructor(config = {}) {
        super(config);

        // 模拟账户
        this.account = {
            cash: config.initialCash || 100000,
            frozenCash: 0,
            totalAssets: config.initialCash || 100000,
            available: config.initialCash || 100000,
            marketValue: 0
        };

        // 交易成本
        this.commission = config.commission || 0.0003;  // 万三
        this.stampTax = config.stampTax || 0.001;       // 千一
        this.minCommission = config.minCommission || 5; // 最低5元

        // 订单簿
        this.pendingOrders = [];

        // 成交记录
        this.trades = [];

        // 实时行情引用（需要外部注入）
        this.quoteManager = null;
    }

    /**
     * 设置行情管理器
     */
    setQuoteManager(manager) {
        this.quoteManager = manager;
    }

    /**
     * 连接（模拟）
     */
    async connect() {
        this.connected = true;
        this.log('INFO', '模拟交易连接成功');
        this.emit('connected');
        return true;
    }

    /**
     * 断开连接
     */
    async disconnect() {
        this.connected = false;
        this.log('INFO', '模拟交易已断开');
        this.emit('disconnected');
        return true;
    }

    /**
     * 获取账户信息
     */
    async getAccount() {
        // 更新市值
        let marketValue = 0;
        for (const [code, pos] of this.positions) {
            const quote = this.quoteManager?.getCachedQuote(code);
            if (quote) {
                pos.currentPrice = quote.price;
                pos.marketValue = pos.shares * quote.price;
                pos.profit = pos.marketValue - pos.cost;
                pos.profitPercent = (pos.profit / pos.cost * 100).toFixed(2);
                marketValue += pos.marketValue;
            }
        }

        this.account.marketValue = marketValue;
        this.account.totalAssets = this.account.cash + marketValue;
        this.account.available = this.account.cash - this.account.frozenCash;

        return { ...this.account };
    }

    /**
     * 获取持仓
     */
    async getPositions() {
        const positions = [];
        for (const [code, pos] of this.positions) {
            if (pos.shares > 0) {
                positions.push({ ...pos });
            }
        }
        return positions;
    }

    /**
     * 获取指定股票持仓
     */
    async getPosition(code) {
        return this.positions.get(code) || null;
    }

    /**
     * 提交订单
     */
    async submitOrder(order) {
        // 验证订单
        const validation = this.validateOrder(order);
        if (!validation.valid) {
            this.log('WARN', '订单验证失败', { reason: validation.reason, order });
            return {
                success: false,
                orderId: null,
                message: validation.reason
            };
        }

        // 生成订单ID
        const orderId = this.generateOrderId();

        // 创建订单对象
        const newOrder = {
            orderId,
            code: order.code,
            side: order.side,
            type: order.type || OrderType.LIMIT,
            price: order.price,
            quantity: order.quantity,
            status: OrderStatus.SUBMITTED,
            filledQuantity: 0,
            avgPrice: 0,
            createTime: new Date().toISOString(),
            updateTime: new Date().toISOString(),
            message: ''
        };

        // 冻结资金/持仓
        if (order.side === OrderSide.BUY) {
            const frozenAmount = order.price * order.quantity * (1 + this.commission);
            this.account.frozenCash += frozenAmount;
            newOrder.frozenAmount = frozenAmount;
        }

        // 保存订单
        this.orders.set(orderId, newOrder);

        this.log('INFO', '订单已提交', { orderId, order: newOrder });
        this.emit('orderSubmitted', newOrder);

        // 模拟成交（延迟执行）
        setTimeout(() => this.simulateExecution(orderId), 100);

        return {
            success: true,
            orderId,
            message: '订单已提交'
        };
    }

    /**
     * 验证订单
     */
    validateOrder(order) {
        // 检查必要字段
        if (!order.code || !order.side || !order.quantity) {
            return { valid: false, reason: '订单缺少必要字段' };
        }

        // 检查数量（A股必须100股整数倍）
        if (order.quantity % 100 !== 0) {
            return { valid: false, reason: 'A股交易数量必须为100股整数倍' };
        }

        // 检查买入资金
        if (order.side === OrderSide.BUY) {
            const requiredCash = order.price * order.quantity * (1 + this.commission);
            if (requiredCash > this.account.available) {
                return { valid: false, reason: `资金不足，需要 ${requiredCash.toFixed(2)}，可用 ${this.account.available.toFixed(2)}` };
            }
        }

        // 检查卖出持仓
        if (order.side === OrderSide.SELL) {
            const position = this.positions.get(order.code);
            const availableShares = position ? position.availableShares : 0;
            if (order.quantity > availableShares) {
                return { valid: false, reason: `可卖数量不足，需要 ${order.quantity}，可用 ${availableShares}` };
            }
        }

        return { valid: true };
    }

    /**
     * 模拟成交
     */
    async simulateExecution(orderId) {
        const order = this.orders.get(orderId);
        if (!order || order.status !== OrderStatus.SUBMITTED) return;

        // 获取当前价格
        let executePrice = order.price;
        if (this.quoteManager) {
            const quote = await this.quoteManager.getStockQuote(order.code);
            if (quote) {
                // 模拟滑点
                if (order.side === OrderSide.BUY) {
                    executePrice = Math.max(order.price, quote.ask1 || quote.price);
                } else {
                    executePrice = Math.min(order.price, quote.bid1 || quote.price);
                }
            }
        }

        // 检查价格是否能成交
        // 买入：委托价 >= 卖一价
        // 卖出：委托价 <= 买一价
        const canExecute = true; // 简化处理，默认都能成交

        if (canExecute) {
            // 完全成交
            order.status = OrderStatus.FILLED;
            order.filledQuantity = order.quantity;
            order.avgPrice = executePrice;
            order.updateTime = new Date().toISOString();

            // 计算费用
            const amount = executePrice * order.quantity;
            let commission = amount * this.commission;
            commission = Math.max(commission, this.minCommission);
            const stampTax = order.side === OrderSide.SELL ? amount * this.stampTax : 0;
            const totalFee = commission + stampTax;

            // 更新账户
            if (order.side === OrderSide.BUY) {
                // 买入
                this.account.frozenCash -= order.frozenAmount || 0;
                this.account.cash -= (amount + totalFee);

                // 更新持仓
                let position = this.positions.get(order.code);
                if (!position) {
                    position = {
                        code: order.code,
                        name: '',
                        shares: 0,
                        availableShares: 0,
                        cost: 0,
                        avgPrice: 0,
                        currentPrice: executePrice,
                        marketValue: 0,
                        profit: 0,
                        profitPercent: 0
                    };
                    this.positions.set(order.code, position);
                }

                const totalCost = position.cost + amount + totalFee;
                const totalShares = position.shares + order.quantity;
                position.shares = totalShares;
                position.cost = totalCost;
                position.avgPrice = totalCost / totalShares;
                // 注意：T+1制度，今日买入明日可卖
                // position.availableShares 不增加

            } else {
                // 卖出
                this.account.cash += (amount - totalFee);

                // 更新持仓
                const position = this.positions.get(order.code);
                if (position) {
                    position.shares -= order.quantity;
                    position.availableShares -= order.quantity;
                    position.cost -= position.avgPrice * order.quantity;

                    if (position.shares <= 0) {
                        this.positions.delete(order.code);
                    }
                }
            }

            // 记录成交
            const trade = {
                tradeId: `TRD_${Date.now()}`,
                orderId,
                code: order.code,
                side: order.side,
                price: executePrice,
                quantity: order.quantity,
                amount,
                commission,
                stampTax,
                totalFee,
                time: new Date().toISOString()
            };
            this.trades.push(trade);

            this.log('INFO', '订单成交', { orderId, trade });
            this.emit('orderFilled', order, trade);

        } else {
            order.status = OrderStatus.PENDING;
            order.message = '等待成交';
        }

        this.orders.set(orderId, order);
    }

    /**
     * 撤销订单
     */
    async cancelOrder(orderId) {
        const order = this.orders.get(orderId);
        if (!order) {
            return { success: false, message: '订单不存在' };
        }

        if (order.status === OrderStatus.FILLED || order.status === OrderStatus.CANCELLED) {
            return { success: false, message: '订单已成交或已撤销' };
        }

        // 解冻资金
        if (order.side === OrderSide.BUY && order.frozenAmount) {
            this.account.frozenCash -= order.frozenAmount;
        }

        order.status = OrderStatus.CANCELLED;
        order.updateTime = new Date().toISOString();

        this.log('INFO', '订单已撤销', { orderId });
        this.emit('orderCancelled', order);

        return { success: true, message: '撤销成功' };
    }

    /**
     * 获取订单状态
     */
    async getOrderStatus(orderId) {
        const order = this.orders.get(orderId);
        return order || null;
    }

    /**
     * 获取今日订单
     */
    async getTodayOrders() {
        const today = new Date().toISOString().split('T')[0];
        const orders = [];
        for (const [id, order] of this.orders) {
            if (order.createTime.startsWith(today)) {
                orders.push({ ...order });
            }
        }
        return orders;
    }

    /**
     * 获取今日成交
     */
    async getTodayTrades() {
        const today = new Date().toISOString().split('T')[0];
        return this.trades.filter(t => t.time.startsWith(today));
    }

    /**
     * 更新可卖数量（模拟T+1）
     * 应在每日开盘前调用
     */
    updateAvailableShares() {
        for (const [code, pos] of this.positions) {
            pos.availableShares = pos.shares;
        }
        this.log('INFO', 'T+1: 可卖数量已更新');
    }

    /**
     * 重置账户（用于测试）
     */
    reset(initialCash = 100000) {
        this.account = {
            cash: initialCash,
            frozenCash: 0,
            totalAssets: initialCash,
            available: initialCash,
            marketValue: 0
        };
        this.orders.clear();
        this.positions.clear();
        this.trades = [];
        this.log('INFO', '账户已重置', { initialCash });
    }
}

/**
 * 同花顺交易接口（框架）
 * 注意：实际使用需要安装同花顺客户端并配置
 */
class THSBroker extends BaseBroker {
    constructor(config = {}) {
        super(config);

        this.clientPath = config.clientPath || 'C:\\同花顺软件\\同花顺\\xiadan.exe';
        this.account = config.account || '';
        this.password = config.password || '';
    }

    async connect() {
        // 实际实现需要：
        // 1. 启动同花顺客户端
        // 2. 自动登录
        // 3. 建立通信
        this.log('WARN', '同花顺接口需要配置客户端路径和账户信息');
        throw new Error('同花顺接口暂未实现，请使用模拟交易或参考文档配置');
    }

    async disconnect() {
        this.connected = false;
    }

    async getAccount() {
        throw new Error('未连接');
    }

    async getPositions() {
        throw new Error('未连接');
    }

    async submitOrder(order) {
        throw new Error('未连接');
    }

    async cancelOrder(orderId) {
        throw new Error('未连接');
    }

    async getOrderStatus(orderId) {
        throw new Error('未连接');
    }
}

/**
 * 东方财富交易接口（框架）
 */
class EastMoneyBroker extends BaseBroker {
    constructor(config = {}) {
        super(config);
    }

    async connect() {
        this.log('WARN', '东方财富接口需要配置');
        throw new Error('东方财富接口暂未实现');
    }

    async disconnect() {
        this.connected = false;
    }

    async getAccount() {
        throw new Error('未连接');
    }

    async getPositions() {
        throw new Error('未连接');
    }

    async submitOrder(order) {
        throw new Error('未连接');
    }

    async cancelOrder(orderId) {
        throw new Error('未连接');
    }

    async getOrderStatus(orderId) {
        throw new Error('未连接');
    }
}

// ========== 导出 ==========
module.exports = {
    // 枚举
    OrderStatus,
    OrderSide,
    OrderType,

    // 类
    BaseBroker,
    SimulatedBroker,
    THSBroker,
    EastMoneyBroker,

    // 工厂方法
    createBroker(type = 'simulated', config = {}) {
        switch (type.toLowerCase()) {
            case 'simulated':
            case 'sim':
                return new SimulatedBroker(config);
            case 'ths':
            case '同花顺':
                return new THSBroker(config);
            case 'eastmoney':
            case '东方财富':
                return new EastMoneyBroker(config);
            default:
                throw new Error(`不支持的券商类型: ${type}`);
        }
    }
};
