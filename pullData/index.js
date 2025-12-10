// 拉取股票数据-腾讯财经 API 批量拉取 A股数据

const axios = require('axios');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};


//单只拉取
async function testSingle(code) {
    const market = code.startsWith('6') ? 'sh' : 'sz';
    const resp = await axios.get(`http://qt.gtimg.cn/q=s_${market}${code}`, { headers: HEADERS });
    const dataStr = resp.data.split('~');
    console.log(`单只 ${code}: 当前价 ${parseFloat(dataStr[3]) || 'N/A'}`);
}


//批量拉取
async function testBatch(codes) {
    const q = codes.map(c => `s_${c.startsWith('6') ? 'sh' : 'sz'}${c}`).join(',');
    const resp = await axios.get(`http://qt.gtimg.cn/q=${q}`, { headers: HEADERS });
    console.log('批量响应原始:', resp.data.substring(0, 200) + '...');  // 调试看 v_ 前缀

    const results = {};
    resp.data.split(';').forEach(line => {
        if (line.startsWith('v_')) {
            const codeMatch = line.match(/v_([a-z]+)(\d+)/i);
            if (codeMatch) {
                const fullCode = codeMatch[1] === 'sh' ? '6' + codeMatch[2] : codeMatch[2];
                const dataStr = line.slice(2, -1).split('~');  // 去 v_ 和 "，拆 ~
                results[fullCode] = {
                    name: dataStr[1],
                    current: parseFloat(dataStr[3]),
                    high: parseFloat(dataStr[4]),
                    low: parseFloat(dataStr[5]),
                    volume: parseInt(dataStr[8])
                };
            }
        }
    });
    console.log('批量结果:', results);
}

// 测试
// const testCodes = ['600000', '000001', '000002'];  // 浦发、平安、中信
// testSingle('600000').then(() => testBatch(testCodes));