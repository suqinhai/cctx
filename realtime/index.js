// realtime/index.js
// ============================================
// 实时行情数据模块
// ============================================
//
// 支持多个数据源：
// 1. 新浪财经 - 免费，延迟约3秒
// 2. 腾讯财经 - 免费，延迟约3秒
// 3. 东方财富 - 免费，数据更全
//
// 使用方法：
//   const realtime = require('./realtime');
//   const quote = await realtime.getQuote('000001');
//   realtime.subscribe(['000001', '600519'], callback);
//

const axios = require('axios');
const EventEmitter = require('events');

// ========== 数据源配置 ==========
const DATA_SOURCES = {
    sina: {
        name: '新浪财经',
        baseUrl: 'https://hq.sinajs.cn/list=',
        referer: 'https://finance.sina.com.cn'
    },
    tencent: {
        name: '腾讯财经',
        baseUrl: 'https://qt.gtimg.cn/q=',
        referer: 'https://gu.qq.com'
    },
    eastmoney: {
        name: '东方财富',
        baseUrl: 'https://push2.eastmoney.com/api/qt/stock/get',
        referer: 'https://quote.eastmoney.com'
    }
};

/**
 * 实时行情管理器
 */
class RealtimeQuoteManager extends EventEmitter {
    constructor(options = {}) {
        super();

        // 默认数据源
        this.dataSource = options.dataSource || 'sina';

        // 轮询间隔（毫秒），默认3秒
        this.pollInterval = options.pollInterval || 3000;

        // 订阅的股票列表
        this.subscriptions = new Set();

        // 轮询定时器
        this._pollTimer = null;

        // 最新行情缓存
        this._quoteCache = new Map();

        // 是否运行中
        this._running = false;

        // 错误重试次数
        this._retryCount = 0;
        this._maxRetries = 3;
    }

    /**
     * 格式化股票代码（添加市场前缀）
     * @param {string} code - 6位股票代码
     * @returns {string} 带市场前缀的代码
     */
    formatCode(code, source = this.dataSource) {
        // 去除已有前缀
        code = code.replace(/^(sh|sz|SH|SZ)/, '');

        // 判断市场
        // 6开头 - 上海
        // 0、3开头 - 深圳
        // 8、4开头 - 北交所
        let prefix;
        if (code.startsWith('6')) {
            prefix = source === 'eastmoney' ? '1.' : 'sh';
        } else if (code.startsWith('0') || code.startsWith('3')) {
            prefix = source === 'eastmoney' ? '0.' : 'sz';
        } else if (code.startsWith('8') || code.startsWith('4')) {
            prefix = source === 'eastmoney' ? '0.' : 'bj';
        } else {
            prefix = source === 'eastmoney' ? '0.' : 'sz';
        }

        return source === 'eastmoney' ? `${prefix}${code}` : `${prefix}${code}`;
    }

    /**
     * 从新浪获取实时行情
     * @param {string|string[]} codes - 股票代码
     */
    async getQuoteSina(codes) {
        const codeList = Array.isArray(codes) ? codes : [codes];
        const formattedCodes = codeList.map(c => this.formatCode(c, 'sina'));

        try {
            const response = await axios.get(
                `${DATA_SOURCES.sina.baseUrl}${formattedCodes.join(',')}`,
                {
                    headers: {
                        'Referer': DATA_SOURCES.sina.referer,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    responseType: 'arraybuffer'
                }
            );

            // 新浪返回GBK编码
            const iconv = require('iconv-lite');
            const text = iconv.decode(response.data, 'gbk');

            return this.parseSinaData(text, codeList);
        } catch (error) {
            console.error('新浪行情获取失败:', error.message);
            throw error;
        }
    }

    /**
     * 解析新浪行情数据
     */
    parseSinaData(text, codes) {
        const results = {};
        const lines = text.split('\n').filter(line => line.trim());

        lines.forEach((line, index) => {
            // 格式: var hq_str_sh600519="贵州茅台,1800.00,1795.00,..."
            const match = line.match(/var hq_str_(\w+)="(.*)"/);
            if (!match) return;

            const data = match[2].split(',');
            if (data.length < 32) return;

            const code = codes[index] || match[1].substring(2);

            results[code] = {
                code: code,
                name: data[0],
                open: parseFloat(data[1]) || 0,
                prevClose: parseFloat(data[2]) || 0,
                price: parseFloat(data[3]) || 0,
                high: parseFloat(data[4]) || 0,
                low: parseFloat(data[5]) || 0,
                bid: parseFloat(data[6]) || 0,      // 买一价
                ask: parseFloat(data[7]) || 0,      // 卖一价
                volume: parseInt(data[8]) || 0,     // 成交量（股）
                amount: parseFloat(data[9]) || 0,   // 成交额（元）
                // 买盘五档
                bid1Vol: parseInt(data[10]) || 0,
                bid1: parseFloat(data[11]) || 0,
                bid2Vol: parseInt(data[12]) || 0,
                bid2: parseFloat(data[13]) || 0,
                bid3Vol: parseInt(data[14]) || 0,
                bid3: parseFloat(data[15]) || 0,
                bid4Vol: parseInt(data[16]) || 0,
                bid4: parseFloat(data[17]) || 0,
                bid5Vol: parseInt(data[18]) || 0,
                bid5: parseFloat(data[19]) || 0,
                // 卖盘五档
                ask1Vol: parseInt(data[20]) || 0,
                ask1: parseFloat(data[21]) || 0,
                ask2Vol: parseInt(data[22]) || 0,
                ask2: parseFloat(data[23]) || 0,
                ask3Vol: parseInt(data[24]) || 0,
                ask3: parseFloat(data[25]) || 0,
                ask4Vol: parseInt(data[26]) || 0,
                ask4: parseFloat(data[27]) || 0,
                ask5Vol: parseInt(data[28]) || 0,
                ask5: parseFloat(data[29]) || 0,
                // 时间
                date: data[30],
                time: data[31],
                timestamp: new Date(`${data[30]} ${data[31]}`).getTime(),
                // 计算字段
                change: parseFloat(data[3]) - parseFloat(data[2]),
                changePercent: ((parseFloat(data[3]) - parseFloat(data[2])) / parseFloat(data[2]) * 100).toFixed(2),
                // 状态
                status: this.getMarketStatus(data[30], data[31])
            };
        });

        return results;
    }

    /**
     * 从腾讯获取实时行情
     */
    async getQuoteTencent(codes) {
        const codeList = Array.isArray(codes) ? codes : [codes];
        const formattedCodes = codeList.map(c => this.formatCode(c, 'tencent'));

        try {
            const response = await axios.get(
                `${DATA_SOURCES.tencent.baseUrl}${formattedCodes.join(',')}`,
                {
                    headers: {
                        'Referer': DATA_SOURCES.tencent.referer,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    responseType: 'arraybuffer'
                }
            );

            const iconv = require('iconv-lite');
            const text = iconv.decode(response.data, 'gbk');

            return this.parseTencentData(text, codeList);
        } catch (error) {
            console.error('腾讯行情获取失败:', error.message);
            throw error;
        }
    }

    /**
     * 解析腾讯行情数据
     */
    parseTencentData(text, codes) {
        const results = {};
        const lines = text.split('\n').filter(line => line.trim());

        lines.forEach((line, index) => {
            // 格式: v_sh600519="1~贵州茅台~600519~1800.00~..."
            const match = line.match(/v_(\w+)="(.*)"/);
            if (!match) return;

            const data = match[2].split('~');
            if (data.length < 45) return;

            const code = codes[index] || data[2];

            results[code] = {
                code: code,
                name: data[1],
                price: parseFloat(data[3]) || 0,
                prevClose: parseFloat(data[4]) || 0,
                open: parseFloat(data[5]) || 0,
                volume: parseInt(data[6]) || 0,         // 成交量（手）
                outerVol: parseInt(data[7]) || 0,       // 外盘
                innerVol: parseInt(data[8]) || 0,       // 内盘
                bid1: parseFloat(data[9]) || 0,
                bid1Vol: parseInt(data[10]) || 0,
                bid2: parseFloat(data[11]) || 0,
                bid2Vol: parseInt(data[12]) || 0,
                bid3: parseFloat(data[13]) || 0,
                bid3Vol: parseInt(data[14]) || 0,
                bid4: parseFloat(data[15]) || 0,
                bid4Vol: parseInt(data[16]) || 0,
                bid5: parseFloat(data[17]) || 0,
                bid5Vol: parseInt(data[18]) || 0,
                ask1: parseFloat(data[19]) || 0,
                ask1Vol: parseInt(data[20]) || 0,
                ask2: parseFloat(data[21]) || 0,
                ask2Vol: parseInt(data[22]) || 0,
                ask3: parseFloat(data[23]) || 0,
                ask3Vol: parseInt(data[24]) || 0,
                ask4: parseFloat(data[25]) || 0,
                ask4Vol: parseInt(data[26]) || 0,
                ask5: parseFloat(data[27]) || 0,
                ask5Vol: parseInt(data[28]) || 0,
                // 最近成交
                lastTrade: data[29],
                date: data[30].substring(0, 8),
                time: data[30].substring(8),
                change: parseFloat(data[31]) || 0,
                changePercent: parseFloat(data[32]) || 0,
                high: parseFloat(data[33]) || 0,
                low: parseFloat(data[34]) || 0,
                amount: parseFloat(data[37]) || 0,      // 成交额（万元）
                turnoverRate: parseFloat(data[38]) || 0, // 换手率
                pe: parseFloat(data[39]) || 0,          // 市盈率
                amplitude: parseFloat(data[43]) || 0,   // 振幅
                circulationValue: parseFloat(data[44]) || 0, // 流通市值（亿）
                totalValue: parseFloat(data[45]) || 0,  // 总市值（亿）
                pb: parseFloat(data[46]) || 0,          // 市净率
                limitUp: parseFloat(data[47]) || 0,     // 涨停价
                limitDown: parseFloat(data[48]) || 0,   // 跌停价
                timestamp: Date.now(),
                status: this.getMarketStatus()
            };
        });

        return results;
    }

    /**
     * 获取市场状态
     */
    getMarketStatus(dateStr, timeStr) {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const day = now.getDay();

        // 周末
        if (day === 0 || day === 6) {
            return 'CLOSED';
        }

        // 交易时段判断
        const time = hours * 100 + minutes;

        if (time < 915) return 'PRE_MARKET';           // 盘前
        if (time >= 915 && time < 925) return 'CALL_AUCTION'; // 集合竞价
        if (time >= 925 && time < 930) return 'CALL_AUCTION'; // 集合竞价
        if (time >= 930 && time < 1130) return 'TRADING';     // 上午交易
        if (time >= 1130 && time < 1300) return 'LUNCH_BREAK'; // 午休
        if (time >= 1300 && time < 1457) return 'TRADING';     // 下午交易
        if (time >= 1457 && time < 1500) return 'CALL_AUCTION'; // 尾盘集合竞价
        return 'CLOSED';
    }

    /**
     * 获取实时行情（统一接口）
     * @param {string|string[]} codes - 股票代码
     * @returns {Promise<Object>} 行情数据
     */
    async getQuote(codes) {
        const source = this.dataSource;

        try {
            let result;
            switch (source) {
                case 'sina':
                    result = await this.getQuoteSina(codes);
                    break;
                case 'tencent':
                    result = await this.getQuoteTencent(codes);
                    break;
                default:
                    result = await this.getQuoteSina(codes);
            }

            // 更新缓存
            Object.entries(result).forEach(([code, quote]) => {
                this._quoteCache.set(code, quote);
            });

            this._retryCount = 0;
            return result;
        } catch (error) {
            this._retryCount++;

            // 切换数据源重试
            if (this._retryCount < this._maxRetries) {
                console.warn(`数据源 ${source} 失败，尝试切换...`);
                this.dataSource = source === 'sina' ? 'tencent' : 'sina';
                return this.getQuote(codes);
            }

            throw error;
        }
    }

    /**
     * 获取单只股票行情
     */
    async getStockQuote(code) {
        const result = await this.getQuote(code);
        return result[code] || null;
    }

    /**
     * 订阅股票行情
     * @param {string|string[]} codes - 股票代码
     * @param {Function} callback - 行情更新回调 (quotes) => {}
     */
    subscribe(codes, callback) {
        const codeList = Array.isArray(codes) ? codes : [codes];

        codeList.forEach(code => {
            this.subscriptions.add(code);
        });

        if (callback) {
            this.on('quote', callback);
        }

        // 启动轮询
        if (!this._running) {
            this.startPolling();
        }

        console.log(`已订阅 ${codeList.length} 只股票: ${codeList.join(', ')}`);
    }

    /**
     * 取消订阅
     */
    unsubscribe(codes) {
        const codeList = Array.isArray(codes) ? codes : [codes];

        codeList.forEach(code => {
            this.subscriptions.delete(code);
        });

        // 如果没有订阅了，停止轮询
        if (this.subscriptions.size === 0) {
            this.stopPolling();
        }
    }

    /**
     * 启动轮询
     */
    startPolling() {
        if (this._running) return;

        this._running = true;
        console.log('实时行情轮询已启动');

        const poll = async () => {
            if (!this._running || this.subscriptions.size === 0) return;

            try {
                const codes = Array.from(this.subscriptions);
                const quotes = await this.getQuote(codes);

                // 发送事件
                this.emit('quote', quotes);

                // 检查价格变动，发送变动事件
                Object.entries(quotes).forEach(([code, quote]) => {
                    const cached = this._quoteCache.get(code);
                    if (cached && cached.price !== quote.price) {
                        this.emit('priceChange', {
                            code,
                            oldPrice: cached.price,
                            newPrice: quote.price,
                            change: quote.change,
                            changePercent: quote.changePercent
                        });
                    }
                });

            } catch (error) {
                this.emit('error', error);
            }

            // 继续轮询
            this._pollTimer = setTimeout(poll, this.pollInterval);
        };

        // 立即执行一次
        poll();
    }

    /**
     * 停止轮询
     */
    stopPolling() {
        this._running = false;
        if (this._pollTimer) {
            clearTimeout(this._pollTimer);
            this._pollTimer = null;
        }
        console.log('实时行情轮询已停止');
    }

    /**
     * 获取缓存的行情
     */
    getCachedQuote(code) {
        return this._quoteCache.get(code);
    }

    /**
     * 判断是否交易时间
     */
    isTradingTime() {
        const status = this.getMarketStatus();
        return status === 'TRADING' || status === 'CALL_AUCTION';
    }

    /**
     * 等待开盘
     */
    async waitForMarketOpen() {
        return new Promise((resolve) => {
            const check = () => {
                if (this.isTradingTime()) {
                    resolve();
                } else {
                    setTimeout(check, 60000); // 每分钟检查
                }
            };
            check();
        });
    }

    /**
     * 销毁
     */
    destroy() {
        this.stopPolling();
        this.removeAllListeners();
        this._quoteCache.clear();
        this.subscriptions.clear();
    }
}

// ========== 导出 ==========
module.exports = {
    RealtimeQuoteManager,

    // 便捷方法
    createManager: (options) => new RealtimeQuoteManager(options),

    // 单例
    _instance: null,
    getInstance(options) {
        if (!this._instance) {
            this._instance = new RealtimeQuoteManager(options);
        }
        return this._instance;
    },

    // 快捷获取行情
    async getQuote(codes, source = 'sina') {
        const manager = new RealtimeQuoteManager({ dataSource: source });
        return manager.getQuote(codes);
    }
};
