# 0G Sentinel ProofLock

ProofLock 是 0G 主网（chain ID `16661`）上面向 ERC-8004 Agent 的策略限定准入层。它把规范身份、经验证的证据包、有期限的链上租约和 AgentGateV2 稳定原因码绑定在一起。

它不证明 Agent “绝对安全”。只有当前身份主体、证据覆盖、策略版本、租约状态均匹配，且 AgentGateV2 返回 `ALLOWED`，消费者操作才被准入；缺失、过期、不匹配、错误链或不可用信息一律 fail closed。

## V2 证据边界

- Compute 只接受 acknowledged decentralized separated-model TEE 服务，并且 SDK `processResponse === true`、签名者和签名文本都精确匹配。没有可生成合格 receipt 的 hosted-router fallback。
- Compute 健康检查只是服务发现：`inferenceExecuted: false`、`paidInference: false`，不表示刚执行了推理。
- Storage 校验会检索原始字节并重算 0G root；当前明确显示 `networkProofVerified: false`，不声称独立验证了网络 Merkle proof。
- 租约由具名、经授权的 validator 写入；validator/guardian 是公开的中心化信任边界。
- Drift 是按需检查，不是持续监控。
- 历史 proof 是否有效，与当前租约/Gate 是否允许是两个不同状态。

## Legacy V1 — 已排除

旧版 `AttestationRegistry`、`AgentRegistry`、原始 `AgentGate`、地址扫描、后台队列、风险排行、fine-tuning、虚构 seed 地址以及旧 evidence API 仅为历史来源。它们不参与 ProofLock V2 准入，也不能支持 V2 声明；旧 API 返回 `410 GONE`。

当前 V2 部署地址必须来自环境变量，不能把旧交易或旧合约展示为当前 ProofLock 证据。完整配置、路由和验证命令请见 [English README](README.md)。

## License

MIT
