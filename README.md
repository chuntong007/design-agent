<div align="center">

# 📈 基金洞察 · 多维数据分析看板

**Fund Insight — 基于实时数据的基金多维度分析平台**

实时行情 · 多基金对比 · 重仓股参照 · 全球新闻关联 · 净值锚定对照

</div>

---

## ✨ 功能特性

### 1. 多基金历史涨幅对比
- 🔍 支持按 **基金代码 / 名称 / 拼音** 实时搜索并添加任意基金（上限 6 只）
- 📊 净值走势曲线叠加对比，支持 **归一化 / 绝对净值** 双模式切换
- 📅 时间区间筛选（1月 / 3月 / 6月 / 1年）
- 🧮 多基金聚合指标：区间总收益、年初至今、最大回撤、年化波动率、夏普比率

### 2. 重仓股参照分析
- 🥧 重仓股占比环形图（按行业着色）
- 📈 Top5 重仓股归一化走势对比，与基金净值同期参照
- 📋 完整明细表：排名、代码、行业、占比、最新价、当日涨跌、年初至今、市值、PE

### 3. 点击净值自动搜索全球新闻
- 🖱️ 点击净值曲线任意点位 → 自动检索该日期 **±5 天** 的全球新闻
- 🌍 数据来自 **GDELT 全球新闻数据库**（支持中英文财经媒体）
- 🏷️ 新闻卡片含来源、日期、地区、类别、影响力标签
- 🔄 GDELT 限流时自动降级到 Wikipedia 历史事件 + BBC/CNBC RSS 备用源

### 4. 新闻锚定与跨时期对照
- 📌 一键**锚定**当前净值点（图表橙色实线标记）
- 🕰️ 检索其他日期时，同步展示「锚定时期事件对照」区域，直观对比不同时期发生了什么

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────┐
│                 前端 (React + Vite)          │
│        http://localhost:5173                 │
│  React 18 · TypeScript · Tailwind CSS        │
│  ECharts 图表 · Lucide 图标                  │
└───────────────────┬─────────────────────────┘
                    │  /api 代理 (Vite proxy)
┌───────────────────▼─────────────────────────┐
│         后端代理服务 (Express + Node)        │
│        http://localhost:8787                 │
│  server/index.js · fundService.js            │
│  newsService.js · utils.js                   │
└────────────┬───────────────────┬────────────┘
             │                   │
┌────────────▼─────────┐  ┌──────▼──────────────────┐
│   天天基金 API        │  │   GDELT 全球新闻数据库   │
│  · 基金搜索/净值/持仓  │  │  · Wikipedia 历史事件    │
│   腾讯财经 API        │  │  · BBC/CNBC RSS 备用源   │
│  · 个股行情/历史K线    │  │                         │
└──────────────────────┘  └─────────────────────────┘
```

### 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite 5 |
| 样式 | Tailwind CSS 3 |
| 图表 | ECharts 5 + echarts-for-react |
| 后端 | Node.js + Express 4 |
| HTTP 客户端 | node-fetch 3 |
| 并发控制 | 自研 `mapWithConcurrency` 限制器 |

---

## 🚀 快速开始

### 环境要求

- **Node.js ≥ 18**（推荐 20+，需支持 `node-fetch` v3 与原生 `fetch`）
- npm ≥ 9

### 安装与启动

```bash
# 1. 克隆 / 进入项目目录
cd fund-dashboard

# 2. 安装依赖
npm install

# 3. 一键启动前后端（concurrently 并行）
npm run dev
```

启动后：

- 🌐 前端看板：<http://localhost:5173>
- ⚙️ 后端代理：<http://localhost:8787>（健康检查：`/api/health`）

> 也可分开启动：`npm run dev:web`（仅前端） / `npm run dev:server`（仅后端）

### 生产构建

```bash
npm run build     # 构建前端产物到 dist/
npm run preview   # 本地预览构建产物
npm run server    # 仅运行后端服务
```

---

## 📡 API 文档

所有接口均返回统一格式：

```json
{ "code": 0, "message": "success", "data": { ... } }
```

| 方法 | 路径 | 说明 | 关键参数 |
|------|------|------|----------|
| GET | `/api/health` | 健康检查 | - |
| GET | `/api/funds/search` | 基金搜索 | `keyword`（代码/名称/拼音） |
| GET | `/api/funds/:code` | 基金详情 + 历史净值 + 指标 | `days`（默认 365） |
| GET | `/api/funds/:code/holdings` | 重仓股（含个股行情与走势） | - |
| GET | `/api/news/search` | 全球新闻搜索 | `date`（必填）、`keyword`、`fundName`、`stockName`、`rangeDays` |

---

## 📂 目录结构

```
fund-dashboard/
├── index.html                 # 入口 HTML
├── vite.config.ts             # Vite 配置（含 /api 代理）
├── tailwind.config.js         # Tailwind 主题配置
├── package.json
├── server/                    # 后端代理服务
│   ├── index.js               # Express 路由 + 指标计算
│   ├── fundService.js         # 天天基金 / 腾讯财经数据服务
│   ├── newsService.js         # GDELT + Wikipedia + RSS 新闻服务
│   └── utils.js               # fetch 封装 / 缓存 / 并发控制
└── src/                       # 前端源码
    ├── main.tsx               # React 入口
    ├── App.tsx                # 主组件（异步数据流）
    ├── index.css              # 全局样式
    ├── api/index.ts           # 前端 API 客户端
    ├── types/index.ts         # TypeScript 类型定义
    └── components/
        ├── FundSelector.tsx   # 基金搜索选择器
        ├── MetricsBar.tsx     # 聚合指标条
        ├── NavChart.tsx       # 净值对比图表（点击检索）
        ├── HoldingsPanel.tsx  # 重仓股面板
        ├── NewsPanel.tsx      # 新闻检索 + 锚定对照
        ├── Loading.tsx        # 加载 / 错误 / 空状态
        └── UI.tsx             # 通用 UI 组件
```

---

## 🛠️ 数据源说明

### 天天基金（基金数据）
| 数据 | 接口 | 备注 |
|------|------|------|
| 基金搜索 | `fundsuggest.eastmoney.com` | JSONP 返回 |
| 历史净值 | `api.fund.eastmoney.com/f10/lsjz` | 需 Referer，pageSize ≤ 200（分页） |
| 重仓股 | `fundf10.eastmoney.com/FundArchivesDatas` | 需 Referer，解析 HTML 表格 |

### 腾讯财经（个股数据）
| 数据 | 接口 | 备注 |
|------|------|------|
| 实时行情 | `qt.gtimg.cn/q=sh600519` | GBK 编码，`~` 分隔字段 |
| 历史 K 线 | `web.ifzq.gtimg.cn/appstock/app/fqkline` | 前复权日线 |

### 全球新闻
| 数据 | 接口 | 备注 |
|------|------|------|
| 全球新闻 | `api.gdeltproject.org/api/v2/doc/doc` | 免费，有 429 限流 |
| 历史事件 | `en.wikipedia.org/api/rest_v1/feed/onthisday` | 备用源 |
| 财经 RSS | BBC Business / CNBC Markets | 备用源 |

---

## ⚠️ 已知限制与说明

- **GDELT 429 限流**：GDELT 为免费公共服务，连续请求会触发限流。本项目已内置 **串行化请求 + 重试 + 备用源降级**，限流期间会自动切换至 Wikipedia / RSS 数据，并提示用户稍后重试。
- **数据版权**：本项目仅为技术演示，数据来自公开接口，请勿用于商业用途。
- **接口稳定性**：第三方接口（天天基金 / 腾讯 / GDELT）可能随时调整，若部分数据异常，多为接口变更所致。
- **实时性**：净值、行情为当日实时数据；重仓股持仓数据按季度披露，更新有滞后。

---

## 📄 许可证

本项目仅供学习与演示用途，`MIT License`。
