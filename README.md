# 基金多维度数据分析看板

全栈基金分析看板，支持多基金净值对比、重仓股参照、点击净值检索全球新闻、新闻锚定跨期对照。

## 技术栈

- **后端**：Node.js + Express + TypeScript（CommonJS）
  - 数据源：天天基金（pingzhongdata）、腾讯财经行情、GDELT/Wikipedia/新浪新闻
  - 代理：socks5h（境外 API 走代理，避免 DNS 污染）
- **前端**：React 18 + Vite + TypeScript + Recharts
- **持久化**：localStorage（基金列表、视图设置、锚定新闻）

## 目录结构

```
fund-dashboard/
├── server/                    # 后端代理服务
│   └── src/
│       ├── config.ts          # 代理/端口配置
│       ├── utils/
│       │   ├── cache.ts       # 内存缓存 + sleep
│       │   └── http.ts        # HTTP 工具（按需走代理、GBK、重试）
│       ├── services/
│       │   ├── fund.ts        # 基金搜索/净值/重仓股
│       │   ├── stock.ts       # 个股行情/K线（腾讯）
│       │   ├── news.ts        # 新闻检索（GDELT 优先 + 降级）
│       │   └── translate.ts   # 翻译（MyMemory）
│       ├── routes/
│       │   ├── fund.ts
│       │   ├── stock.ts
│       │   └── news.ts
│       └── index.ts           # Express 入口
└── client/                    # 前端 React 应用
    └── src/
        ├── types.ts           # 共享类型
        ├── api.ts             # API 客户端
        ├── theme.ts           # 设计系统（深色金融风）
        ├── metrics.ts         # 指标计算（收益/回撤/波动率/夏普）
        ├── storage.ts         # localStorage 持久化
        ├── App.tsx            # 主组件
        ├── main.tsx           # 入口 + 全局样式
        └── components/
            ├── Header.tsx         # 顶栏（搜索/区间/视图切换）
            ├── FundList.tsx       # 基金列表
            ├── NavChartPanel.tsx  # 净值曲线（点击检索/锚点标记）
            ├── MetricsPanel.tsx   # 指标横向对比
            ├── HoldingsPanel.tsx  # 重仓股（饼图/行情/走势）
            └── NewsPanel.tsx      # 新闻（检索/翻译/锚定/对照）
```

## 启动方式

### 1. 启动后端

```bash
cd fund-dashboard/server
npm install
npm run dev
# 监听 http://localhost:8787
```

代理配置（默认 `socks5h://127.0.0.1:1080`），可通过环境变量覆盖：
```bash
$env:PROXY_URL="socks5h://127.0.0.1:7890"; npm run dev
```

### 2. 启动前端

```bash
cd fund-dashboard/client
npm install
npm run dev
# 访问 http://localhost:5173
```

## 功能说明

### 历史涨幅与最新行情对比
- 搜索添加多只基金，叠加净值曲线
- 归一化（首日=100）/ 绝对净值视图切换
- 8 档区间：1月/3月/6月/1年/3年/5年/年初至今/成立来
- 实时计算：区间总收益、年初至今、最大回撤、年化波动率、夏普比率
- 多基金横向对比，最佳值高亮标 ★

### 重仓股参照展示
- 自动获取基金最新报告期前十大重仓股
- 持仓占比饼图 + 明细列表
- 个股实时行情（现价、当日涨跌、市值、PE）
- 重仓股归一化走势对比曲线

### 点击净值检索全球新闻
- 点击净值曲线任意点位，检索该日期 ±7 天全球新闻
- 数据源优先级：GDELT（走代理）→ Wikipedia 历史事件 → 新浪财经
- 每条新闻含：来源、日期、地区、影响判断（利好/利空/中性）、分类
- 非中文新闻一键翻译（MyMemory API）

### 新闻锚定对照
- 可将检索到的新闻锚定到对应净值点位，图表显示彩色标记
- 锚定新闻按时间排序，跨时期并列展示
- 支持取消锚定
- localStorage 持久化，刷新不丢失

## 数据源说明

| 数据 | 接口 | 备注 |
|------|------|------|
| 基金搜索 | eastmoney FundSearchPageAPI | JSONP 提取 |
| 基金净值 | eastmoney pingzhongdata | 成立来全量，含名称/经理 |
| 重仓股 | eastmoney FundArchivesDatas | JSONP 含 HTML 表格 |
| 个股行情 | 腾讯 qt.gtimg.cn | GBK 编码，A 股+港股 |
| 个股 K 线 | 腾讯 web.ifzq.gtimg.cn | 前复权日线 |
| 全球新闻 | GDELT / Wikipedia / 新浪 | GDELT 限流严格，三级降级 |
| 翻译 | MyMemory | 免费无 key，走代理 |

## 已知限制

- GDELT API 限流严格（连续 2-3 次即 429），通过缓存 + 串行锁 + 降级缓解
- Wikipedia "On This Day" 返回历史同日事件（按与目标年份接近度排序）
- 新浪财经滚动新闻仅含近期新闻，作为最终降级
- 港股行情字段与 A 股有差异，已做兼容处理
