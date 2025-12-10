// data/index.js
const axios = require('axios');

// 模拟浏览器头，防止被拦截
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

/**
 * 获取 A 股历史 K 线数据 (用于回测)
 * @param {string} code 股票代码 (例如 '000002')
 * @param {number} dayCount 获取最近多少天的数据 (例如 300)
 */
async function getStockHistory(code, dayCount = 300) {
    // 1. 处理代码前缀：6开头是 sh，其他是 sz
    const market = code.startsWith('6') ? 'sh' : 'sz';
    const fullCode = `${market}${code}`;

    // 2. 腾讯财经 K 线接口 (返回 JSON，不是 v_s_ 字符串)
    // 格式: param=代码,周期(day),,,条数,复权(qfq=前复权)
    const url = `http://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${fullCode},day,,,${dayCount},qfq`;

    try {
        const resp = await axios.get(url, { headers: HEADERS });
        
        // 3. 数据解析
        // 接口返回结构通常是: resp.data.data[fullCode].qfqday (前复权数据)
        // 如果没有复权数据，可能是新股，取 day
        const dataNode = resp.data && resp.data.data && resp.data.data[fullCode];
        
        if (!dataNode) {
            console.error(`❌ 未找到股票 ${code} 的数据`);
            return [];
        }

        // 优先取前复权(qfqday)，没有则取不复权(day)
        const klineArray = dataNode.qfqday || dataNode.day || [];

        // 4. 格式转换：数组转对象
        // 腾讯 K 线数组顺序: [ "日期", "开盘", "收盘", "最高", "最低", "成交量" ]
        // 注意：腾讯的顺序是 Open(1), Close(2), High(3), Low(4)
        return klineArray.map(item => ({
            date: item[0],                 // 日期
            open: parseFloat(item[1]),     // 开盘价
            close: parseFloat(item[2]),    // 收盘价
            high: parseFloat(item[3]),     // 最高价
            low: parseFloat(item[4]),      // 最低价
            volume: parseFloat(item[5])    // 成交量
        }));

    } catch (err) {
        console.error('API 请求失败:', err.message);
        return [];
    }
}

module.exports = { getStockHistory };