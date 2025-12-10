// data/index.js
// ============================================
// 数据获取模块 - 负责从腾讯财经API获取A股历史K线数据
// ============================================

// 引入 axios 库，用于发送 HTTP 请求
const axios = require('axios');

// 模拟浏览器请求头，防止被服务器识别为爬虫而拦截
// User-Agent 伪装成 Chrome 浏览器
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

/**
 * 获取 A 股历史 K 线数据 (用于回测)
 *
 * @param {string} code - 股票代码，例如 '000001'(平安银行)、'600519'(贵州茅台)
 * @param {number} dayCount - 获取最近多少天的数据，默认300天
 * @returns {Array} 返回K线数据数组，每个元素包含 date/open/close/high/low/volume
 *
 * 使用示例:
 *   const data = await getStockHistory('000001', 500);
 */
async function getStockHistory(code, dayCount = 300) {
    // ========== 第一步：处理股票代码前缀 ==========
    // A股股票代码规则：
    //   - 6开头的是上海证券交易所(sh)，如 600519
    //   - 0、3开头的是深圳证券交易所(sz)，如 000001、300750
    const market = code.startsWith('6') ? 'sh' : 'sz';

    // 拼接完整的股票代码，如 'sz000001' 或 'sh600519'
    const fullCode = `${market}${code}`;

    // ========== 第二步：构建腾讯财经API请求URL ==========
    // 腾讯财经 K 线接口说明:
    //   - param 参数格式: 股票代码,周期类型,起始日期,结束日期,数据条数,复权类型
    //   - 周期类型: day(日K), week(周K), month(月K)
    //   - 复权类型: qfq(前复权), hfq(后复权), 不填则不复权
    //   - 前复权: 以最新价格为基准，向前调整历史价格（推荐用于回测）
    const url = `http://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${fullCode},day,,,${dayCount},qfq`;

    try {
        // ========== 第三步：发送HTTP请求获取数据 ==========
        // 使用 axios 发送 GET 请求，携带伪装的请求头
        const resp = await axios.get(url, { headers: HEADERS });

        // ========== 第四步：解析返回的JSON数据 ==========
        // 腾讯接口返回的数据结构:
        // {
        //   code: 0,
        //   data: {
        //     "sz000001": {
        //       qfqday: [["2024-01-01", "10.00", "10.50", "10.80", "9.90", "1000000"], ...],
        //       day: [...],  // 不复权数据
        //       ...
        //     }
        //   }
        // }
        const dataNode = resp.data && resp.data.data && resp.data.data[fullCode];

        // 如果没有找到数据，可能是股票代码错误或网络问题
        if (!dataNode) {
            console.error(`❌ 未找到股票 ${code} 的数据`);
            return [];  // 返回空数组
        }

        // ========== 第五步：选择复权类型 ==========
        // 优先使用前复权数据(qfqday)，如果没有则使用不复权数据(day)
        // 新股可能没有复权数据
        const klineArray = dataNode.qfqday || dataNode.day || [];

        // ========== 第六步：数据格式转换 ==========
        // 腾讯返回的K线数据是数组格式，需要转换为对象格式方便使用
        // 原始数组顺序: [日期, 开盘价, 收盘价, 最高价, 最低价, 成交量]
        // 注意：腾讯的顺序是 Open(索引1), Close(索引2), High(索引3), Low(索引4)
        return klineArray.map(item => ({
            date: item[0],                 // 日期，格式如 "2024-01-15"
            open: parseFloat(item[1]),     // 开盘价，转换为浮点数
            close: parseFloat(item[2]),    // 收盘价，转换为浮点数
            high: parseFloat(item[3]),     // 最高价，转换为浮点数
            low: parseFloat(item[4]),      // 最低价，转换为浮点数
            volume: parseFloat(item[5])    // 成交量，转换为浮点数
        }));

    } catch (err) {
        // 捕获网络错误或其他异常
        console.error('API 请求失败:', err.message);
        return [];  // 返回空数组，让调用方处理
    }
}

// 导出函数供其他模块使用
module.exports = { getStockHistory };
