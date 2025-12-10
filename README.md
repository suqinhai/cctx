# VectorBT - A股量化回测系统

一个轻量级的 A 股量化交易回测框架，使用 Node.js 构建，适合学习量化交易和测试简单策略。

## 功能特点

- **实时数据获取** - 通过腾讯财经 API 获取 A 股历史 K 线数据（前复权）
- **模块化设计** - 策略、指标、引擎分离，易于扩展和维护
- **风险管理** - 内置 ATR 动态止损和基于风险的仓位控制
- **回测引擎** - 支持手续费、止损逻辑、净值计算
- **轻量高效** - 纯 JavaScript 实现，无需 Python 环境

## 项目结构

```
vectorbt/
├── data/                   # 数据获取模块
│   └── index.js           # 腾讯财经 API 数据获取
├── engine/                 # 回测引擎
│   └── backtest.js        # 核心回测逻辑
├── indicators/             # 技术指标库
│   ├── sma.js             # 简单移动平均线 (SMA)
│   └── atr.js             # 平均真实波幅 (ATR)
├── strategies/             # 交易策略
│   └── maAtr.js           # 双均线 + ATR 止损策略
├── report/                 # 回测报告输出目录
│   └── nav.csv            # 净值曲线数据
├── run.js                  # 主程序入口
├── package.json            # 项目配置
└── README.md               # 项目说明
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 运行回测

```bash
node run.js
```

### 3. 查看结果

回测完成后会输出：
- 控制台：总收益率、最大回撤
- 文件：`report/nav.csv`（净值曲线数据）

## 配置说明

### 修改回测标的

编辑 `run.js` 中的配置区域：

```javascript
const STOCK_CODE = '000001';  // 股票代码
const DAYS = 500;              // 回测天数
```

常见股票代码示例：
| 代码 | 名称 |
|------|------|
| 000001 | 平安银行 |
| 600519 | 贵州茅台 |
| 300750 | 宁德时代 |
| 000858 | 五粮液 |
| 601318 | 中国平安 |

### 策略参数

```javascript
strategyConfig: {
    fast: 5,            // 快速均线周期（天）
    slow: 20,           // 慢速均线周期（天）
    atrPeriod: 14,      // ATR 计算周期
    atrMultiplier: 2.5, // 止损距离 = ATR × 此倍数
    riskPct: 0.02       // 每笔交易风险比例（2%）
}
```

## 核心模块说明

### 数据模块 (data/index.js)

从腾讯财经 API 获取 A 股历史 K 线数据：

```javascript
const { getStockHistory } = require('./data/index');

// 获取平安银行最近 300 天数据
const data = await getStockHistory('000001', 300);
```

返回数据格式：
```javascript
[
  { date: '2024-01-02', open: 10.5, high: 10.8, low: 10.3, close: 10.6, volume: 1000000 },
  // ...
]
```

### 技术指标

#### SMA（简单移动平均线）

```javascript
const sma = require('./indicators/sma');

// 计算第 20 根 K 线的 5 日均线
const ma5 = sma(data, 20, 5);
```

#### ATR（平均真实波幅）

```javascript
const atr = require('./indicators/atr');

// 计算 14 日 ATR 序列
const atrSeries = atr(data, 14);
```

### 策略模块 (strategies/maAtr.js)

**MA+ATR 策略原理：**

1. **买入信号**：快速均线 > 慢速均线（金叉）
2. **卖出信号**：快速均线 < 慢速均线（死叉）
3. **止损**：入场价 - ATR × 倍数
4. **仓位**：每笔风险 = 净值 × 风险比例

### 回测引擎 (engine/backtest.js)

```javascript
const backtest = require('./engine/backtest');
const MaAtr = require('./strategies/maAtr');

const result = backtest(data, MaAtr, {
    initialCash: 100000,
    strategyConfig: { /* ... */ }
});

// result.navs      - 净值序列
// result.finalCash - 最终现金
```

## 业绩指标

| 指标 | 说明 |
|------|------|
| 总收益率 | (期末净值 - 期初净值) / 期初净值 |
| 最大回撤 | 从峰值到谷值的最大跌幅 |

## 扩展开发

### 添加新指标

在 `indicators/` 目录创建新文件，参考 `sma.js` 或 `atr.js` 的格式。

### 添加新策略

1. 在 `strategies/` 目录创建新策略文件
2. 实现 `constructor(config)` 和 `onBar(ctx)` 方法
3. `onBar` 返回信号对象：`{ type: 'BUY'|'SELL'|'HOLD', ... }`

示例策略结构：

```javascript
module.exports = class MyStrategy {
    constructor(config) {
        // 初始化策略参数
    }

    onBar(ctx) {
        const { data, i, cash, position, nav } = ctx;
        // 策略逻辑
        return { type: 'HOLD' };
    }
};
```

## 注意事项

1. **数据延迟**：腾讯接口数据可能有 15-30 分钟延迟
2. **回测局限**：未考虑 T+1 交易限制、涨跌停限制
3. **手续费**：默认 0.1%，实际 A 股约为万 3
4. **仓位限制**：未实现 A 股一手 100 股的整数限制
5. **仅供学习**：本项目仅供学习交流，不构成投资建议

## 依赖库

| 库名 | 用途 |
|------|------|
| axios | HTTP 请求 |
| dayjs | 日期处理 |
| lodash | 工具函数 |
| xlsx | Excel 操作 |
| cheerio | HTML 解析 |
| fs-extra | 文件系统增强 |

## License

ISC
