# 0G Sentinel

为 0G 主网 AI 智能体提供的链上安全基础设施。

0G Sentinel 针对每个注册智能体运行两条独立的 AI 推理流水线——行为风险分析和智能合约漏洞扫描——并将不可篡改的 8 字段认证数据写入 0G 链。任何 dApp、智能体编排器或 AgentGate 均可通过单次链上调用读取并响应这些认证数据。

AgentMesh 审计开发者代码，而 0G Sentinel 审计主网上的实际运行智能体，并将 ERC-7857 链上身份认证写入链。

---

## 已部署合约（0G Aristotle 主网）

| 合约 | 地址 | 区块浏览器 |
|------|------|-----------|
| AttestationRegistry | `0xB3E7048cef229fF5043CD2dBba296bF278d3F88d` | [chainscan.0g.ai](https://chainscan.0g.ai/address/0xB3E7048cef229fF5043CD2dBba296bF278d3F88d) |
| AgentRegistry | `0xcc1cd4550ec98DDcB19F9200331f3E96cab97fAc` | [chainscan.0g.ai](https://chainscan.0g.ai/address/0xcc1cd4550ec98DDcB19F9200331f3E96cab97fAc) |
| AgentGate | `0xCA3338Af9A1E0Df0539c3C8967597A56044D9360` | [chainscan.0g.ai](https://chainscan.0g.ai/address/0xCA3338Af9A1E0Df0539c3C8967597A56044D9360) |

链 ID：16661（0G Aristotle 主网）

---

## 架构

```
                  0G Sentinel 扫描器
                         |
         +---------------+---------------+
         |                               |
  流水线 1：行为分析              流水线 2：代码扫描
  (0G Compute / 0GM 模型)        (0G Compute / 0GM 模型)
  - 交易频率分析                  - Solidity AST 分析
  - 资金流向异常检测              - 重入漏洞检测
  - 访问控制模式分析              - 访问控制漏洞
         |                               |
  behavioral_receipt_hash        code_receipt_hash
  （每次推理唯一）                （每次推理唯一）
         |                               |
         +---------------+---------------+
                         |
                  证据存档
                  (0G Storage SDK)
                  evidence_hash
                         |
                AttestationRegistry
                （0G 链 — 主网）
                8 字段认证结构体：
                behavioral_score（0-100）
                threat_level（SAFE/CAUTION/FLAGGED）
                code_risk（CLEAN/WARNING/VULNERABLE）
                code_findings（字符串）
                behavioral_receipt_hash（bytes32）
                code_receipt_hash（bytes32）
                evidence_hash（bytes32）
                attestation_timestamp（uint256）
                         |
                    AgentGate
                （可组合性原语）
                基于认证结果拦截执行
```

### 0G 集成层

| 层级 | 集成 | 详情 |
|------|------|------|
| 计算 | 0G Compute（router-api.0g.ai/v1） | 0GM-1.0-35B-A3B 模型，TeeML+TDX 认证 |
| 存储 | `@0glabs/0g-ts-sdk` | 证据 JSON 归档，SHA256 内容哈希回退 |
| 链上 | 主网 `AttestationRegistry` | 不可篡改的链上认证结构体 |
| 可组合性 | `AgentGate.sol` | 读取 AttestationRegistry 的链上执行拦截器 |

---

## 工作原理

1. **注册** — 将智能体地址添加到 AgentRegistry
2. **扫描** — Sentinel 通过 0G Compute 运行两条并行 AI 流水线：
   - 流水线 1：行为风险分析（交易历史、资金流向、访问模式）
   - 流水线 2：Solidity 源码漏洞扫描
3. **归档** — 证据 JSON 上传至 0G Storage，保存根哈希
4. **认证** — 扫描器将 8 字段认证数据写入 0G 链上的 AttestationRegistry
5. **拦截** — AgentGate 读取认证数据，如智能体被标记或未扫描则拒绝执行

每次流水线调用都会从 0G 路由器产生唯一的 `zg-res-key` 收据 UUID，转换为 bytes32 收据哈希。两个哈希均存储在链上，证明两次独立的 AI 验证均已执行。

---

## 本地部署

```bash
# 1. 安装依赖
npm install
cd frontend && npm install

# 2. 设置环境变量
cp .env.example .env
# 填写：ZERO_G_COMPUTE_API_KEY、ZERO_G_PRIVATE_KEY、合约地址

# 3. 编译合约
npx hardhat compile

# 4. 部署到测试网
npx hardhat run scripts/deploy/01_deploy_registry.ts --network zerogTestnet
npx hardhat run scripts/deploy/02_deploy_attestation.ts --network zerogTestnet
npx hardhat run scripts/deploy/03_deploy_gate.ts --network zerogTestnet

# 5. 初始化演示智能体
npx ts-node scripts/seed-demo.ts

# 6. 启动前端
cd frontend && npm run dev
```

---

## OpenClaw 技能

0G Sentinel 在 `openclaw-skill/0g-sentinel-scan.json` 提供了兼容 OpenClaw 的技能清单，使 AI 编排器能够以工具调用的方式触发安全扫描。

---

为 0G APAC Hackathon 2026 构建 — 赛道 T1（Agentic Infrastructure & OpenClaw Lab）+ 赛道 T2（Agentic Trading Arena / Verifiable Finance）
