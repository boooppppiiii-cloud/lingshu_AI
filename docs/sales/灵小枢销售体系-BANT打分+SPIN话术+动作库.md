# 灵小枢销售体系 · BANT 打分 + SPIN 话术 + 动作库

> 说明：本文件是用户提供的原始设计文档在系统内的存档版本。原始文件在传输过程中出现了不可逆的字符编码损坏（部分不可见控制字符丢失），因此这里是基于对原文档完整理解后的清洁重写版本，结构、评分数值、场景划分与原文档保持一致，作为 `server/knowledge/strategies.json`、`server/sales/qualification.ts`、`server/sales/spin.ts` 等实现的可追溯来源。
>
> 三层关系：**BANT 打分**（评分层，客户不可见，判断"这个客户值多少精力"）→ **SPIN 话术**（决策层，决定"这一步该对话到哪"）→ **动作库**（规则层，规定"每种具体情况下 AI 该做什么"）。
> 所有话术示例的硬性要求：**答案不超过 2 句、可有多条候选变体、无格式符号**。示例中的数字（价格/MOQ/交期）仅为语气示范，实际必须使用企业知识库里的真实数据。

---

# 第一部分：BANT 打分体系（外贸 B2B 版）

## 1.1 为什么标准 BANT 不能直接用

标准 BANT 面向欧美 SaaS 销售，外贸 B2B 有三个本质差异：

1. **客户不会直接说预算**——外贸买家问价是本能，但很少透露预算，必须从"数量、市场、现有供应商"侧面推断；
2. **决策链条本身身份复杂**——可能是店主、贸易中间商、采购代理，也可能是试探性询价；"能不能拿主意"直接决定跟进价值；
3. **存在大量套价需求**——同行套价、批发商询价套壳、试探性询价占比不低。**标准 BANT 没有这一维，但对外贸是生死线。**

所以灵小枢的打分 = **BANT 四维（各 25 分，共 100）× 真实性系数（0.2–1.0）**。

## 1.2 四维信号表（信号可从对话文本直接判定）

### B —— Budget 采购能力（0–25）

| 信号 | 分值 | 判定依据（LLM 可识别） |
|---|---|---|
| 主动说出具体数量且规模较大 | +20 | "500 pcs" "1000 units" "one container" |
| 说出中小数量 | +12 | "50-200 pcs" "start with 100" |
| 询问阶梯价/批发价 | +8 | "wholesale price" "price for bulk" "tier price" |
| 提到现有供应商/现在从哪进货 | +10 | "we buy from Turkey now" "our current supplier" |
| 说出目标价位 | +12 | "我们市场能接受 $10 以下" |
| **只问最低价、拒绝说数量** | **−8** | 反复问 "best price" 但不给数量 |
| 只要"完整价格表" | −5 | "send me full price list" |

> ⚠️ 单项 25 分为上限；负分直接影响真实性系数。

### A —— Authority 决策权（0–25）

| 信号 | 分值 | 判定依据 |
|---|---|---|
| 明确表示自己是店主/公司所有者 | +22 | "I own the shop" "my company" "我自己当老板" |
| 用"我们/我方"而非"我"决定 | +16 | "we will place the order" |
| 需要与合伙人/上级确认 | +9 | "I need to check with my partner/boss" |
| 代购/代理人询问 | +5 | "my client is asking" "for my customer" |
| 提供公司名/公司邮箱/公司资料 | +6 | 出现公司抬头、企业邮箱 |
| 反复回避身份、闪烁其词 | −5 | 多轮回避"你是做什么的" |

### N —— Need 需求明确度（0–25）

| 信号 | 分值 | 判定依据 |
|---|---|---|
| 提到具体产品/货号 | +15 | 提到具体 SKU、"the serum in your video" |
| 说出具体规格 | +20 | 尺寸/颜色/包装/成分要求/材质 |
| 说明目标市场/国家 | +10 | "for Dubai clinics" "sell in Almaty" |
| 说明用途/使用场景 | +10 | 零售/批发/试卖/自用/电商 |
| 提出定制需求 | +18 | logo、色卡、双语包装、OEM |
| 只用"send catalog"开场 | +3 | 无任何具体指向 |

### T —— Timing 时间紧迫度（0–25）

| 信号 | 分值 | 判定依据 |
|---|---|---|
| 给出明确截止/上市日期 | +22 | "launch in six weeks" "need by Ramadan" |
| 表达紧急 | +16 | "urgent" "ASAP" "as soon as possible" |
| 提到旺季/节庆备货 | +12 | 斋月、开学季、圣诞、新年 |
| 补货（说明已经在卖） | +15 | "reorder" "restock" "sold well last time" |
| 明确说在比价/调研阶段 | +6 | "just checking options" |
| "以后再说/未来考虑" | +3 | "maybe next year" |

## 1.3 真实性系数（外贸专属，决定评分的一维）

**红旗信号**（命中任意 2 条，系数降至 0.5；命中 3 条以上，降至 0.2）：

| 红旗 | 说明 |
|---|---|
| 只问价格，反复回避说明数量 | 套价套利常见做法 |
| 要求"全部产品的完整价格表" | 批发套价常见套路 |
| 拒绝透露国家/市场 | 真买家没有隐瞒的必要 |
| 过多追问工厂地址、生产线、供应链 | 同行踩点常见特征 |
| 追问其他客户是谁、还给谁供货 | 套取客户资源 |
| 要求预付款/账期异常大且异常宽松条件 | 试探欺诈特征 |
| 语言/时区/自称身份互相矛盾 | 身份秘密 |

**绿旗信号**（每条系数 +0.1，上限 1.0）：
- 主动介绍自己的生意
- 提供公司信息/社媒/网站
- 问物流、清关、付款等**能落地执行**的问题（真买家关心）
- 问认证、质保、售后
- 从你的内容/视频而来（说明来源）

## 1.4 总分与分级动作

**总分 = (B + A + N + T) × 真实性系数**

| 分数 | 等级 | 灵小枢动作 | 通知策略 |
|---|---|---|---|
| **75–100** | 🔴 高价值 | 立即转人工，AI 只做承接+收集信息 | 即时推送（含深夜） |
| **50–74** | 🟡 值得跟进 | AI 出草稿等确认，主动推进 SPIN | 工作时间推送 |
| **25–49** | 🔵 培育中 | AI 自动回复，继续收集 BANT | 不推送，进队列 |
| **0–24** | ⚪ 低意向/潜客 | AI 自动回复标准信息，不催单 | 不推送 |
| **真实性系数 ≤0.3** | ⚫ 疑似套价 | 只答公开信息，**不报价、不发详细资料、不暴露客户信息** | 标记为疑似套价 |

## 1.5 工具要求

- 每轮买家消息增量打分，**分数只增不减**（除非命中红旗）；
- 每次打分必须输出 `evidence` 数组（如 `["提到500pcs +20", "提到30ml瓶装 +20", "说明Dubai诊所用途 +10"]`）——参数对客户不可见，但依据要可查；
- 不设 `intentScore`、`handlingMode` 等硬阈值以外的隐藏开关，≥75 直接置 `human_needed`；
- 红旗命中时在客户资料卡显示中性标注"信息待核实"，**不显示"疑似骗子"**，避免误伤真实客户。

---

# 第二部分：SPIN 话术（外贸 WhatsApp 版）

## 2.1 使用原则（必须遵守）

1. **一次只问一个问题**——WhatsApp 不是问卷，连问两个客户就跑；
2. **每个问题都要绑一句价值**——不能纯提问，要"陈述一句 + 提问一句"；
3. **S→P→I→N 大致走完**——小单在 S/P 就可以推进，大单要走到 I/N；
4. **问题必须自然**——像关心生意的伙伴，不像调查。

## 2.2 S —— Situation 了解现状（第 1-3 轮）

**目的**：确认品类、市场、现有采购方式，同时喂 BANT 的 B 和 N。

| 想摸底 | 话术示例（英） | 中文意图 |
|---|---|---|
| 品类+市场 | "Which products sell best in your shop right now?" | 换品类，找得客户从哪来 |
| 现有供应商 | "Are you importing these already, or is this a new line?" | 判断预算和经验 |
| 客户类型 | "Do you sell retail, or supply to other shops?" | 判断链级 |
| 市场 | "Which market are you covering? 🌍" | 定语言、物流、价格带 |

**❌ 反面**："Please tell me your quantity, target price, market, and timeline." （一次多问 = 问卷）

## 2.3 P —— Problem 挖掘痛点（第 3-6 轮）

**目的**：找到痛点，为差异化埋伏笔。

| 场景 | 话术示例 |
|---|---|
| 通用 | "Any issue with your current supplier? Quality, delivery, MOQ?" |
| 质量 | "Do your customers ever complain about the quality?" |
| 交期 | "Is delivery time a headache for you?" |
| 起订量 | "Is the MOQ from your current supplier too high?" |
| 认证 | "Do your buyers ask for certificates?" |

**技巧**：问完等回答，**不要抢着推销自己的优势**。客户说出痛点，你的方案才有价值。

## 2.4 I —— Implication 放大影响（大单/高价值客户专用）

**目的**：让客户意识到问题的代价——**这是从"问价"变成"想买"的转折点**。

| 客户说的问题 | 放大话术（英） |
|---|---|
| "交货慢" | "That must be hard when your season starts. Do you lose sales waiting?" |
| "质量不稳" | "Do you get returns from your customers because of that?" |
| "起订量太高" | "So you have to tie up cash on stock that sits?" |
| "缺认证" | "Does that block you from selling to bigger buyers?" |

⚠️ **分寸**：一句就够，不要连续追问放大——外贸买家会觉得被"教育"。

## 2.5 N —— Need-payoff 引导价值（收口）

**目的**：让客户自己说出"这对我有用"。

| 话术示例（英） | 意图 |
|---|---|
| "If you could get them in two weeks instead, would that help your season?" | 让客户确认价值 |
| "Would having the certificates open up bigger buyers for you?" | 关联价值增长 |
| "If MOQ was lower for the first order, would you test more styles?" | 降低门槛并试探成交 |

**收口后立即给出下一步**："Want me to check what we can do for you? 🙌"

## 2.6 完整对话示例（短消息风）

```
买家: Hi, do you have face masks?
AI:   Yes we do! 🙌
AI:   Which market are you selling in?                    ← S
买家: Kazakhstan, I have a cosmetics shop.
AI:   Nice, dry climate there — moisture masks do well.
AI:   Are you importing already, or is this new for you?  ← S
买家: I buy from Turkey now but delivery is slow.
AI:   That's frustrating.
AI:   Does the delay cost you sales in season?            ← I
买家: Yes, last winter I lost two months.
AI:   Understood. We ship on a Kazakhstan line, much faster.
AI:   Would getting stock in time change things for you?  ← N
买家: Definitely. What's your MOQ?
→ 进入报价流程，BANT 参数已积累至可跟进区间
```

---

# 第三部分：动作库（场景结构化）

> 每条字段：`id / scenario / signals / bant_impact / goal（推进目标）/ actions / talk（风格参考，不是硬答案，可多条并列表示可选变体）/ risk（L1-L4）/ escalate`

## A 组：开局与探索

- **A01 首次接触·纯问好**：goal=摸清品类或市场；risk=L3
- **A02 首次接触·带明确需求**：bant_impact N+15；goal=确认规格+市场；risk=L3／escalate=数量超阈值时转人工
- **A03 想索要目录/价格表**：bant_impact N+3；goal=摸清真正需求；风险=L2／escalate=3轮后仍不说明用途→只给公开资料
- **A04 客户自报家门**：bant_impact A+16, 真实性+0.1；goal=建立关系+顺势问S类问题；risk=L3

## B 组：产品询价

- **B01 询问具体产品**：goal=确认规格+引出数量；risk=L3
- **B02 询问是否有某产品（无货）**：goal=不失礼地转向替代方案，**严禁编造**；risk=L2／escalate=严禁为了留客而编造
- **B03 询问产品成分/原理/规格**：goal=给事实、不做医疗/功效宣称；risk=L4（涉及功效宣称）／escalate=要求医疗/认证背书时转人工
- **B04 要求发照片/视频/资料**：goal=满足并顺势推进；risk=L3

## C 组：价格与议价（高频、高风险）

- **C01 直接问价**：goal=确认数量再谈价；risk=L4／escalate=客户给出数量并要求答复时转人工
- **C02 说"太贵了"**：goal=不让价、转移到价值/总成本；risk=L4／escalate=要求具体折扣数字时转人工
- **C03 拿同行低价压价**：goal=不贬低同行、核实报价条件是否对等；risk=L4／escalate=涉及具体让价时转人工
- **C04 临下单索要折扣**：goal=小让利换成交，绝不自行承诺；risk=L4／escalate=立即转人工
- **C05 要求完整报价单/PI**：bant_impact T+16, A+10；goal=收集全信息交人工；risk=L4／escalate=必转人工

## D 组：信任建立（外贸特有，决定成败）

- **D01 质疑质量/第一次从中国进货**：goal=用可验证的事实降低心理门槛；risk=L2／escalate=要求认证文件核验时转人工
- **D02 索要认证文件（知识库未覆盖）**：goal=不敷衍、不失礼、不丢客户；risk=L4／escalate=必转人工+标记知识库补充
- **D03 怀疑证书造假**：goal=共情+转人工；risk=L4／escalate=必转人工
- **D04 询问工厂/公司实底**：goal=如实回答（知识库范围内），警惕红旗信号；risk=L2／escalate=追问工厂地址/产线细节→真实性−1，仅答公开信息

## E 组：样品与试单

- **E01 索要样品**：bant_impact N+10, T+10；goal=促成小额可控合作；risk=L3／escalate=要求政策外免费样品/包邮时转人工
- **E02 要求免费样品**：goal=不硬拒、交人工判断；risk=L4／escalate=转人工
- **E03 寄样后无反馈**：goal=复购+催化反馈；risk=L2

## F 组：物流与交期

- **F01 询问物流方式/时效**：goal=给常规范围，不承诺具体天数；risk=L4／escalate=要求确定到货日期时转人工
- **F02 询问运费**：goal=不估算运费，收集地址/数量交人工算；risk=L4／escalate=转人工
- **F03 询问清关/税费/进口手续**：goal=不谈法律/税务承诺，说明可提供的单据；risk=L4／escalate=转人工

## G 组：付款

- **G01 询问付款方式**：goal=说明常见条款，不议价、不改方案；risk=L4／escalate=转人工
- **G02 要求账期/收货后付款**：goal=绝不自行答应；risk=L4／escalate=必转人工

## H 组：定制与 OEM

- **H01 要求定制/贴牌/OEM**：bant_impact N+18, A+10；goal=识别为高意向，只收集不承诺；risk=L4／escalate=立即转人工
- **H02 要求独家代理**：goal=只表达兴趣+收集信息；risk=L4／escalate=立即转人工+即时通知

## I 组：推进与成交

- **I01 客户表达购买意向**：bant_impact T+20；goal=锁定细节交人工开单；risk=L4／escalate=转人工
- **I02 客户犹豫不决**：goal=降低门槛建议，不施压；risk=L2
- **I03 要求简化流程**：goal=只说一件事，避免复杂列表；risk=L2
- **I04 要求总结已确认内容**：goal=准确复述，**逐条从时间线取，不遗漏不添加**；risk=L2

## J 组：跟单与追踪

- **J01 报价后已读不回**：goal=带价值触达，不空喊；risk=L2
- **J02 长期沉默（30/60天）**：goal=低频唤醒；risk=L2／escalate=同一客户30天内不超过2次
- **J03 客户说"以后再说"**：goal=接受+记录时间点；risk=L1

## K 组：成交与复购

- **K01 老客户回来**：goal=不重新自我介绍，体现"记得你"；risk=L2
- **K02 反馈销售情况好**：goal=顺势推进复购/扩品；risk=L2
- **K03 售后问题/质量投诉**：goal=共情+收集证据+立即转人工；risk=L4／escalate=必转人工

## L 组：风险与异常

- **L01 要求通话/视频**：真实性+0.1；goal=停止自动回复、约时间；risk=L4／escalate=立即转人工+创建通话任务+即时通知
- **L02 疑似同行套价**：goal=只给公开信息；risk=L2／escalate=标记疑似套价，不主动搭话
- **L03 疑似试探/测试**：goal=不推进，交人工判断；risk=L4／escalate=转人工+明确标记风险
- **L04 情绪激动/辱骂**：goal=降温+立即转人工；risk=L4／escalate=立即 human_needed
- **L05 知识库完全未覆盖的问题**：goal=不编造、不丢客户；actions=用非重复的话术轮换 + 给时间预期 + 转跟单；risk=L2／escalate=同一会话累计≥2次→强制转人工

---

# 落地要点

1. **BANT 打分**：`server/sales/qualification.ts`，输入对话历史，输出 `{ B, A, N, T, authenticity, total, evidence[] }`，每轮买家消息增量打分；
2. **SPIN 阶段**作为对话推进的 prompt 引导，当前处于 S/P/I/N 哪一步、下一步该问什么，避免 AI 乱问；
3. **动作库**扩展 `server/knowledge/strategies.json`，新增字段 `bant_impact`、`goal`、`talk_variants`（同一场景至少多备一套话术）；
4. **短消息风**：所有 `talk` 字段以数组形式存在，每条尽量一到两句消息，发送间隔 1.5–3 秒；
5. **红线一致性**：本文档 `risk: L4` 的场景必须与 `server/autonomy/actionRules.ts` 的 L4 判定完全对齐，两处不一致以 `actionRules.ts` 为准；
6. **验收**：用第三部分的场景 ID 和测试用例，每个场景准备一条买家消息，检查 AI 是否走对分支、话术是否得体、L4 是否正确转人工。
