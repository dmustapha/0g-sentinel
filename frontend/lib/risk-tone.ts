// The single source of truth for risk tone + mark, shared by every risk surface (scan result,
// agent detail, RiskReport). Replaces the duplicated toneMark() functions that had drifted apart.
export type RiskTone = "good" | "caution" | "blocked" | "neutral";

// Maps a verdict label (SAFE / CAUTION / FLAGGED) to a tone. Unknown labels stay neutral.
export function riskTone(label: string): RiskTone {
  switch (label.toUpperCase()) {
    case "SAFE": return "good";
    case "CAUTION": return "caution";
    case "FLAGGED":
    case "BLOCKED": return "blocked";
    default: return "neutral";
  }
}

export function toneMark(tone: RiskTone): string {
  switch (tone) {
    case "good": return "✓";     // check
    case "blocked": return "×";  // multiplication sign
    case "caution": return "!";
    default: return "•";         // bullet
  }
}

// Plain-English gloss for a contract bytecode flag (from the PUSH-aware opcode walker). Falls back to
// the raw flag so an unknown future flag still renders.
export function bytecodeFlagGloss(flag: string): string {
  switch (flag.toUpperCase()) {
    case "SELFDESTRUCT": return "Self-destruct: the contract can be permanently destroyed";
    case "DELEGATECALL": return "Delegatecall: execution can be redirected to other code";
    case "CALLCODE": return "Callcode: legacy execution redirect";
    case "HAS_MINT": return "Owner can mint new tokens";
    case "HAS_PAUSE": return "Owner can pause transfers";
    case "HAS_BLACKLIST": return "Owner can block specific addresses";
    case "OWNER_CONTROLLED": return "Owner holds privileged control functions";
    default: return flag;
  }
}
