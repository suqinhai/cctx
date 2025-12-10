// utils/aShareRules.js
// ============================================
// A股交易规则模块
// ============================================
//
// 包含：
// 1. 交易时间规则
// 2. 涨跌停规则
// 3. 股票分类（主板/创业板/科创板/北交所）
// 4. 交易单位规则
// 5. 停复牌检测
// 6. 特殊交易日处理
//

/**
 * 股票板块类型
 */
const BoardType = {
    MAIN_SH: 'MAIN_SH',           // 上海主板 (60xxxx)
    MAIN_SZ: 'MAIN_SZ',           // 深圳主板 (00xxxx)
    GEM: 'GEM',                   // 创业板 (30xxxx)
    STAR: 'STAR',                 // 科创板 (68xxxx)
    BSE: 'BSE',                   // 北交所 (8xxxxx, 4xxxxx)
    B_SHARE_SH: 'B_SHARE_SH',     // 上海B股 (900xxx)
    B_SHARE_SZ: 'B_SHARE_SZ',     // 深圳B股 (200xxx)
    UNKNOWN: 'UNKNOWN'
};

/**
 * 股票状态
 */
const StockStatus = {
    NORMAL: 'NORMAL',             // 正常交易
    SUSPENDED: 'SUSPENDED',       // 停牌
    ST: 'ST',                     // ST股票
    ST_STAR: 'ST_STAR',           // *ST股票
    DELISTING: 'DELISTING',       // 退市整理
    NEW_LISTING: 'NEW_LISTING',   // 新股上市
    RESUMPTION: 'RESUMPTION'      // 复牌
};

/**
 * 交易时段
 */
const TradingSession = {
    PRE_MARKET: 'PRE_MARKET',           // 盘前 (09:15之前)
    CALL_AUCTION_OPEN: 'CALL_AUCTION_OPEN',   // 开盘集合竞价 (09:15-09:25)
    CALL_AUCTION_MATCH: 'CALL_AUCTION_MATCH', // 集合竞价撮合 (09:25-09:30)
    MORNING_TRADING: 'MORNING_TRADING', // 上午连续竞价 (09:30-11:30)
    LUNCH_BREAK: 'LUNCH_BREAK',         // 午休 (11:30-13:00)
    AFTERNOON_TRADING: 'AFTERNOON_TRADING', // 下午连续竞价 (13:00-14:57)
    CALL_AUCTION_CLOSE: 'CALL_AUCTION_CLOSE', // 收盘集合竞价 (14:57-15:00)
    AFTER_HOURS: 'AFTER_HOURS',         // 盘后 (15:00之后)
    CLOSED: 'CLOSED'                    // 休市
};

/**
 * A股交易规则类
 */
class AShareRules {
    constructor() {
        // 2024-2025年A股休市日（需要定期更新）
        this.holidays = new Set([
            // 2024年
            '2024-01-01', // 元旦
            '2024-02-09', '2024-02-10', '2024-02-11', '2024-02-12',
            '2024-02-13', '2024-02-14', '2024-02-15', '2024-02-16', '2024-02-17', // 春节
            '2024-04-04', '2024-04-05', '2024-04-06', // 清明
            '2024-05-01', '2024-05-02', '2024-05-03', '2024-05-04', '2024-05-05', // 劳动节
            '2024-06-08', '2024-06-09', '2024-06-10', // 端午
            '2024-09-15', '2024-09-16', '2024-09-17', // 中秋
            '2024-10-01', '2024-10-02', '2024-10-03', '2024-10-04',
            '2024-10-05', '2024-10-06', '2024-10-07', // 国庆
            // 2025年（需要根据实际公布更新）
            '2025-01-01', // 元旦
            '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31',
            '2025-02-01', '2025-02-02', '2025-02-03', '2025-02-04', // 春节
            '2025-04-04', '2025-04-05', '2025-04-06', // 清明
            '2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05', // 劳动节
            '2025-05-31', '2025-06-01', '2025-06-02', // 端午
            '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04',
            '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08' // 国庆+中秋
        ]);

        // 周末补班日（这些日子虽然是周末但开市）
        this.workdays = new Set([
            '2024-02-04', // 春节调休
            '2024-02-18', // 春节调休
            '2024-04-07', // 清明调休
            '2024-04-28', // 劳动节调休
            '2024-05-11', // 劳动节调休
            '2024-09-14', // 中秋调休
            '2024-09-29', // 国庆调休
            '2024-10-12', // 国庆调休
        ]);
    }

    /**
     * 判断股票板块类型
     * @param {string} code - 6位股票代码
     * @returns {string} 板块类型
     */
    getBoardType(code) {
        code = code.replace(/^(sh|sz|bj)/i, '');

        if (code.startsWith('60')) return BoardType.MAIN_SH;
        if (code.startsWith('00')) return BoardType.MAIN_SZ;
        if (code.startsWith('30')) return BoardType.GEM;
        if (code.startsWith('68')) return BoardType.STAR;
        if (code.startsWith('8') || code.startsWith('4')) return BoardType.BSE;
        if (code.startsWith('900')) return BoardType.B_SHARE_SH;
        if (code.startsWith('200')) return BoardType.B_SHARE_SZ;

        return BoardType.UNKNOWN;
    }

    /**
     * 获取涨跌停幅度
     * @param {string} code - 股票代码
     * @param {string} status - 股票状态（ST等）
     * @param {boolean} isFirstDay - 是否为上市首日
     * @returns {Object} { upLimit: 涨幅, downLimit: 跌幅 }
     */
    getPriceLimit(code, status = StockStatus.NORMAL, isFirstDay = false) {
        const boardType = this.getBoardType(code);

        // 上市首日特殊规则
        if (isFirstDay) {
            switch (boardType) {
                case BoardType.MAIN_SH:
                case BoardType.MAIN_SZ:
                    // 主板首日涨幅44%，跌幅36%（相对发行价）
                    return { upLimit: 0.44, downLimit: 0.36, noLimit: false };
                case BoardType.GEM:
                case BoardType.STAR:
                    // 创业板/科创板前5个交易日不设涨跌幅限制
                    return { upLimit: null, downLimit: null, noLimit: true };
                case BoardType.BSE:
                    // 北交所首日不设涨跌幅限制
                    return { upLimit: null, downLimit: null, noLimit: true };
            }
        }

        // ST股票
        if (status === StockStatus.ST || status === StockStatus.ST_STAR) {
            switch (boardType) {
                case BoardType.MAIN_SH:
                case BoardType.MAIN_SZ:
                    return { upLimit: 0.05, downLimit: 0.05, noLimit: false };
                case BoardType.GEM:
                case BoardType.STAR:
                    // 创业板/科创板ST也是20%
                    return { upLimit: 0.20, downLimit: 0.20, noLimit: false };
                case BoardType.BSE:
                    return { upLimit: 0.30, downLimit: 0.30, noLimit: false };
            }
        }

        // 正常交易日
        switch (boardType) {
            case BoardType.MAIN_SH:
            case BoardType.MAIN_SZ:
                return { upLimit: 0.10, downLimit: 0.10, noLimit: false };
            case BoardType.GEM:
            case BoardType.STAR:
                return { upLimit: 0.20, downLimit: 0.20, noLimit: false };
            case BoardType.BSE:
                return { upLimit: 0.30, downLimit: 0.30, noLimit: false };
            default:
                return { upLimit: 0.10, downLimit: 0.10, noLimit: false };
        }
    }

    /**
     * 计算涨跌停价格
     * @param {number} prevClose - 昨收价
     * @param {string} code - 股票代码
     * @param {string} status - 股票状态
     * @returns {Object} { limitUp: 涨停价, limitDown: 跌停价 }
     */
    calculatePriceLimits(prevClose, code, status = StockStatus.NORMAL) {
        const limits = this.getPriceLimit(code, status);

        if (limits.noLimit) {
            return { limitUp: null, limitDown: null };
        }

        // A股价格精度：0.01元
        const limitUp = Math.round(prevClose * (1 + limits.upLimit) * 100) / 100;
        const limitDown = Math.round(prevClose * (1 - limits.downLimit) * 100) / 100;

        return { limitUp, limitDown };
    }

    /**
     * 获取最小交易单位
     * @param {string} code - 股票代码
     * @returns {number} 最小交易股数
     */
    getMinTradeUnit(code) {
        const boardType = this.getBoardType(code);

        switch (boardType) {
            case BoardType.STAR:
                // 科创板最小200股，超过200股可以1股递增
                return 200;
            case BoardType.BSE:
                // 北交所最小100股
                return 100;
            default:
                // 主板、创业板最小100股
                return 100;
        }
    }

    /**
     * 验证交易数量
     * @param {string} code - 股票代码
     * @param {number} quantity - 交易数量
     * @param {boolean} isSell - 是否为卖出
     * @returns {Object} { valid, reason, adjustedQuantity }
     */
    validateQuantity(code, quantity, isSell = false) {
        const boardType = this.getBoardType(code);
        const minUnit = this.getMinTradeUnit(code);

        // 科创板特殊处理
        if (boardType === BoardType.STAR) {
            if (quantity < 200) {
                // 卖出时可以不足200股全部卖出
                if (isSell) {
                    return { valid: true, reason: '', adjustedQuantity: quantity };
                }
                return {
                    valid: false,
                    reason: `科创板最小买入${minUnit}股`,
                    adjustedQuantity: 200
                };
            }
            // 超过200股后，可以1股递增
            return { valid: true, reason: '', adjustedQuantity: quantity };
        }

        // 其他板块：必须是100的整数倍
        if (quantity < minUnit) {
            if (isSell) {
                // 卖出时可以不足100股（零股）全部卖出
                return { valid: true, reason: '', adjustedQuantity: quantity };
            }
            return {
                valid: false,
                reason: `最小买入${minUnit}股`,
                adjustedQuantity: minUnit
            };
        }

        if (quantity % 100 !== 0 && !isSell) {
            const adjusted = Math.floor(quantity / 100) * 100;
            return {
                valid: false,
                reason: '买入数量必须是100的整数倍',
                adjustedQuantity: adjusted
            };
        }

        return { valid: true, reason: '', adjustedQuantity: quantity };
    }

    /**
     * 验证价格精度
     * @param {number} price - 价格
     * @returns {number} 调整后的价格（精确到分）
     */
    adjustPrice(price) {
        return Math.round(price * 100) / 100;
    }

    /**
     * 判断当前交易时段
     * @param {Date} date - 日期时间
     * @returns {string} 交易时段
     */
    getTradingSession(date = new Date()) {
        // 检查是否为交易日
        if (!this.isTradingDay(date)) {
            return TradingSession.CLOSED;
        }

        const hours = date.getHours();
        const minutes = date.getMinutes();
        const time = hours * 100 + minutes;

        if (time < 915) return TradingSession.PRE_MARKET;
        if (time >= 915 && time < 925) return TradingSession.CALL_AUCTION_OPEN;
        if (time >= 925 && time < 930) return TradingSession.CALL_AUCTION_MATCH;
        if (time >= 930 && time < 1130) return TradingSession.MORNING_TRADING;
        if (time >= 1130 && time < 1300) return TradingSession.LUNCH_BREAK;
        if (time >= 1300 && time < 1457) return TradingSession.AFTERNOON_TRADING;
        if (time >= 1457 && time < 1500) return TradingSession.CALL_AUCTION_CLOSE;
        return TradingSession.AFTER_HOURS;
    }

    /**
     * 判断是否可以下单
     * @param {Date} date - 日期时间
     * @returns {Object} { canOrder, reason }
     */
    canPlaceOrder(date = new Date()) {
        const session = this.getTradingSession(date);

        switch (session) {
            case TradingSession.CALL_AUCTION_OPEN:
                return { canOrder: true, reason: '开盘集合竞价可以下单' };
            case TradingSession.CALL_AUCTION_MATCH:
                return { canOrder: false, reason: '集合竞价撮合期间不能下单' };
            case TradingSession.MORNING_TRADING:
            case TradingSession.AFTERNOON_TRADING:
                return { canOrder: true, reason: '连续竞价可以下单' };
            case TradingSession.CALL_AUCTION_CLOSE:
                return { canOrder: true, reason: '收盘集合竞价可以下单' };
            case TradingSession.LUNCH_BREAK:
                return { canOrder: true, reason: '午休期间可以下单（收盘前生效）' };
            default:
                return { canOrder: false, reason: '当前非交易时间' };
        }
    }

    /**
     * 判断是否可以撤单
     * @param {Date} date - 日期时间
     * @returns {Object} { canCancel, reason }
     */
    canCancelOrder(date = new Date()) {
        const session = this.getTradingSession(date);

        switch (session) {
            case TradingSession.CALL_AUCTION_OPEN:
                // 09:15-09:20可以撤单，09:20-09:25不能撤单
                const minutes = date.getMinutes();
                if (minutes < 20) {
                    return { canCancel: true, reason: '集合竞价前5分钟可以撤单' };
                }
                return { canCancel: false, reason: '09:20后不能撤单' };
            case TradingSession.CALL_AUCTION_MATCH:
                return { canCancel: false, reason: '集合竞价撮合期间不能撤单' };
            case TradingSession.MORNING_TRADING:
            case TradingSession.AFTERNOON_TRADING:
                return { canCancel: true, reason: '连续竞价可以撤单' };
            case TradingSession.CALL_AUCTION_CLOSE:
                return { canCancel: false, reason: '收盘集合竞价不能撤单' };
            default:
                return { canCancel: false, reason: '当前非交易时间' };
        }
    }

    /**
     * 判断是否为交易日
     * @param {Date} date - 日期
     * @returns {boolean}
     */
    isTradingDay(date = new Date()) {
        const dateStr = date.toISOString().split('T')[0];
        const day = date.getDay();

        // 检查是否为节假日
        if (this.holidays.has(dateStr)) {
            return false;
        }

        // 检查是否为周末补班日
        if (this.workdays.has(dateStr)) {
            return true;
        }

        // 周末不交易
        if (day === 0 || day === 6) {
            return false;
        }

        return true;
    }

    /**
     * 获取下一个交易日
     * @param {Date} date - 起始日期
     * @returns {Date} 下一个交易日
     */
    getNextTradingDay(date = new Date()) {
        const next = new Date(date);
        next.setDate(next.getDate() + 1);

        while (!this.isTradingDay(next)) {
            next.setDate(next.getDate() + 1);
            // 防止无限循环
            if (next.getFullYear() > date.getFullYear() + 1) {
                break;
            }
        }

        return next;
    }

    /**
     * 判断股票是否为ST
     * @param {string} name - 股票名称
     * @returns {string} 股票状态
     */
    getStockStatus(name) {
        if (!name) return StockStatus.NORMAL;

        name = name.toUpperCase();

        if (name.includes('*ST')) return StockStatus.ST_STAR;
        if (name.includes('ST')) return StockStatus.ST;
        if (name.includes('退')) return StockStatus.DELISTING;
        if (name.startsWith('N')) return StockStatus.NEW_LISTING;

        return StockStatus.NORMAL;
    }

    /**
     * 检查是否可以买入该股票
     * @param {string} code - 股票代码
     * @param {string} name - 股票名称
     * @param {Object} quote - 行情数据
     * @returns {Object} { canBuy, reasons }
     */
    checkBuyable(code, name, quote) {
        const reasons = [];
        let canBuy = true;

        // 1. 检查股票状态
        const status = this.getStockStatus(name);
        if (status === StockStatus.ST_STAR) {
            reasons.push('*ST股票，退市风险高');
            canBuy = false;
        } else if (status === StockStatus.ST) {
            reasons.push('ST股票，风险较高');
            // ST可以买，但要警告
        } else if (status === StockStatus.DELISTING) {
            reasons.push('退市整理期股票，禁止买入');
            canBuy = false;
        }

        // 2. 检查涨跌停
        if (quote) {
            if (quote.price >= quote.limitUp * 0.998) {
                reasons.push('股价接近或达到涨停，买入困难');
                canBuy = false;
            }
            if (quote.price <= quote.limitDown * 1.002) {
                reasons.push('股价接近或达到跌停，不建议买入');
            }
        }

        // 3. 检查交易时间
        const orderCheck = this.canPlaceOrder();
        if (!orderCheck.canOrder) {
            reasons.push(orderCheck.reason);
            canBuy = false;
        }

        // 4. 检查板块限制（如是否开通创业板、科创板等）
        const boardType = this.getBoardType(code);
        if (boardType === BoardType.STAR) {
            reasons.push('科创板需要开通权限（50万+2年经验）');
        } else if (boardType === BoardType.GEM) {
            reasons.push('创业板需要开通权限');
        } else if (boardType === BoardType.BSE) {
            reasons.push('北交所需要开通权限');
        }

        return { canBuy, reasons, status };
    }

    /**
     * 检查是否可以卖出
     * @param {string} code - 股票代码
     * @param {Object} position - 持仓信息
     * @param {Object} quote - 行情数据
     * @returns {Object} { canSell, reasons, availableShares }
     */
    checkSellable(code, position, quote) {
        const reasons = [];
        let canSell = true;
        let availableShares = position ? position.availableShares : 0;

        // 1. 检查可卖数量（T+1）
        if (!position || position.availableShares <= 0) {
            reasons.push('无可卖持仓（T+1限制）');
            canSell = false;
            availableShares = 0;
        }

        // 2. 检查跌停
        if (quote && quote.price <= quote.limitDown * 1.002) {
            reasons.push('股价接近或达到跌停，卖出困难');
        }

        // 3. 检查交易时间
        const orderCheck = this.canPlaceOrder();
        if (!orderCheck.canOrder) {
            reasons.push(orderCheck.reason);
            canSell = false;
        }

        return { canSell, reasons, availableShares };
    }

    /**
     * 计算交易费用
     * @param {string} side - BUY/SELL
     * @param {number} amount - 成交金额
     * @param {Object} config - 费率配置
     * @returns {Object} { commission, stampTax, transferFee, totalFee }
     */
    calculateFees(side, amount, config = {}) {
        const {
            commissionRate = 0.0003,  // 佣金率，默认万三
            minCommission = 5,         // 最低佣金
            stampTaxRate = 0.001,      // 印花税率，千一
            transferFeeRate = 0.00001  // 过户费率，十万分之一
        } = config;

        // 佣金（双向收取）
        let commission = amount * commissionRate;
        commission = Math.max(commission, minCommission);

        // 印花税（仅卖出收取）
        const stampTax = side === 'SELL' ? amount * stampTaxRate : 0;

        // 过户费（双向收取，仅上海市场）
        const transferFee = amount * transferFeeRate;

        const totalFee = commission + stampTax + transferFee;

        return {
            commission: Math.round(commission * 100) / 100,
            stampTax: Math.round(stampTax * 100) / 100,
            transferFee: Math.round(transferFee * 100) / 100,
            totalFee: Math.round(totalFee * 100) / 100
        };
    }

    /**
     * 获取板块说明
     */
    getBoardDescription(code) {
        const boardType = this.getBoardType(code);
        const descriptions = {
            [BoardType.MAIN_SH]: { name: '上海主板', limit: '10%', minUnit: 100, risk: '低' },
            [BoardType.MAIN_SZ]: { name: '深圳主板', limit: '10%', minUnit: 100, risk: '低' },
            [BoardType.GEM]: { name: '创业板', limit: '20%', minUnit: 100, risk: '中' },
            [BoardType.STAR]: { name: '科创板', limit: '20%', minUnit: 200, risk: '高' },
            [BoardType.BSE]: { name: '北交所', limit: '30%', minUnit: 100, risk: '高' },
            [BoardType.B_SHARE_SH]: { name: '上海B股', limit: '10%', minUnit: 100, risk: '中' },
            [BoardType.B_SHARE_SZ]: { name: '深圳B股', limit: '10%', minUnit: 100, risk: '中' },
            [BoardType.UNKNOWN]: { name: '未知', limit: '-', minUnit: 100, risk: '-' }
        };
        return descriptions[boardType];
    }
}

// ========== 导出 ==========
module.exports = {
    BoardType,
    StockStatus,
    TradingSession,
    AShareRules,
    // 创建单例
    rules: new AShareRules()
};
