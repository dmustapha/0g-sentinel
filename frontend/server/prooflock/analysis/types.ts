// Shared types for the deep agent-risk analysis pipeline (0G explorer evidence -> heuristics +
// threat intel + contract analysis -> rich evidence bundle for the risk LLM). All modules import
// from here so the pieces compose. Every field is a seal-time snapshot: captured once when the
// agent is scanned, hashed into the sealed evidence, and reasoned over by the 0G Compute model.

export type EvmAddress = `0x${string}`;

// ---------- Phase 0: raw on-chain evidence (evidence-collector.ts) ----------

export type ChainTx = Readonly<{
  hash: string;
  blockNumber: number;
  timestamp: number;      // unix seconds
  from: string;
  to: string | null;      // null for contract-creation
  value: string;          // wei, decimal string
  methodId: string;       // first 4 bytes of input (e.g. "0x095ea7b3"), or "0x" for plain transfer
  input: string;          // full calldata
  isError: boolean;       // txreceipt_status === "0" or isError === "1"
  gasUsed: string;
}>;

export type TokenTransfer = Readonly<{
  hash: string;
  blockNumber: number;
  from: string;
  to: string;
  contractAddress: string;
  value: string;
  tokenSymbol: string;
  tokenDecimal: string;
}>;

export type InternalTx = Readonly<{
  from: string;
  to: string;
  value: string;
  type: string;           // "call" | "create" | "suicide" ...
  isError: boolean;
}>;

// The complete seal-time evidence for one subject address.
export type AddressEvidence = Readonly<{
  address: EvmAddress;
  observedAtBlock: number;
  nonce: number;                       // outgoing tx count (activity floor, always available)
  balanceWei: string;
  isContract: boolean;
  code: string;                        // eth_getCode ("0x" for EOA)
  transactions: readonly ChainTx[];    // recent, newest-first, bounded
  tokenTransfers: readonly TokenTransfer[];
  internalTxns: readonly InternalTx[];
  sourceVerified: boolean;             // did getsourcecode return verified source
  source: string | null;              // verified Solidity source, if any
  // Per-source availability so downstream can be honest about partial coverage.
  coverage: Readonly<{ explorer: "OK" | "PARTIAL" | "UNAVAILABLE"; rpc: "OK" | "UNAVAILABLE" }>;
}>;

// ---------- Phase 1: computed heuristic signals (risk-heuristics.ts) ----------

// One computed risk signal. weight and value are in [0,1]; hard=true clamps the whole score to max.
export type RiskSignal = Readonly<{
  id: string;              // e.g. "unlimited_approvals"
  label: string;           // plain-English factor a user can read
  value: number;           // [0,1] strength
  weight: number;          // [0,1] contribution weight
  hard: boolean;           // true => clamps overall risk to maximum (e.g. sanctioned)
  detail?: string;         // optional evidence snippet (address, count, tx hash)
}>;

export type HeuristicSignals = Readonly<{
  signals: readonly RiskSignal[];
  behavioralScore: number;   // [0,100] computed from the non-code signals
  factors: readonly string[]; // plain-English summary factors for the user
}>;

// ---------- Phase 2: threat intel (threat-intel.ts) ----------

export type ThreatSignals = Readonly<{
  sanctioned: boolean;              // OFAC / Chainalysis positive
  scamFlagged: boolean;             // ScamSniffer / blocklist positive
  sources: readonly Readonly<{ name: string; status: "HIT" | "CLEAR" | "UNAVAILABLE"; detail?: string }>[];
  signals: readonly RiskSignal[];   // fold into the heuristic vector (sanctioned => hard)
}>;

// ---------- Phase 3: contract analysis (contract-analysis.ts) ----------

export type ContractAnalysis = Readonly<{
  isContract: boolean;
  bytecodeFlags: readonly string[];      // e.g. ["SELFDESTRUCT","DELEGATECALL"]
  sourceFindings: readonly string[];     // from verified source, if any
  codeRisk: number;                      // 0 | 1 | 2 (maps to the gate's codeRisk)
  signals: readonly RiskSignal[];
  factors: readonly string[];
}>;

// ---------- The rich evidence bundle fed to the risk LLM (Phase 4) ----------

export type RiskEvidenceBundle = Readonly<{
  address: EvmAddress;
  isContract: boolean;
  nonce: number;
  observedAtBlock: number;
  heuristics: HeuristicSignals;
  threat: ThreatSignals;
  contract: ContractAnalysis;
  coverage: AddressEvidence["coverage"];
}>;
