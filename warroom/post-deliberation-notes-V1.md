# Post-Deliberation Notes — V1 → V2 Handoff
**Date:** 2026-05-13
**Trigger:** Agent population verification before build start

---

## What Changed After V1 Verdict

### Finding 1: 0G Mainnet Agent Population is Thin
**Verified via web research.**

- AIverse launched on 0G Aristotle **mainnet in March 2026** — only 2 months before hackathon deadline
- 0G App (no-code agent builder) launched **April 2026** — 1 month old
- No public confirmed count of AI agents on 0G Aristotle mainnet
- 1,230 median daily active addresses (December 2025) — general activity, not agent-specific
- The "40% of on-chain txns are from agents" stat is an industry-wide number, NOT 0G-specific
- Best estimate: tens to low hundreds of iNFTs minted on AIverse mainnet

**Impact on AgentWatch:** The demo plan assumed scanning "3,000+ agent transactions" — this number is likely inflated or synthetic. R1 (no real anomalies) is confirmed HIGH probability, not theoretical.

### Finding 2: Demo Framing Needs to Change
**Original plan:** "Scan 500 agent transactions, find anomalies"
**Problem:** Thin population makes this look empty or fake

**Correct reframe:** "AgentWatch has scanned every AI agent on 0G Aristotle mainnet — comprehensive coverage of the full ecosystem."
- Small population becomes a feature: comprehensive, not partial
- Judges know the ecosystem is young — claiming full coverage is credible and strong
- Doesn't require finding anomalies in volume; synthetic seeding provides the risk signal
- Better grant narrative: "We built the trust registry the 0G ecosystem needs from day one"

### Finding 3: "Agent-Like Behavior" Reframe Was Wrong
An intermediate reframe (scan all contract addresses for agent-like behavior) was proposed and then rejected:
- Loses ERC-7857 integration (addresses without Agent ID don't benefit from iNFT attestations)
- Introduces a classification research problem unsolvable in 72 hours
- Weakens the product story

The correct fix is: own the small population, claim comprehensive coverage.

### Finding 4: Name Change
- **Old name:** AgentWatch
- **New name:** 0G Sentinel
- **Reason:** "AgentWatch" implies watching a known population. "0G Sentinel" implies active protection of the whole chain, fits the comprehensive coverage reframe, and signals infrastructure (stronger grant narrative).

---

## What Carries Into V2 Warroom

- V1 winner (AgentWatch / 0G Sentinel) at 9.75 remains the strongest concept
- The core architecture is unchanged: 0G Compute + 0G Chain + ERC-7857 + 0G Storage
- The thin agent population is NOW a known constraint — V2 agents must factor it in
- V2 should re-evaluate: does this finding change the ranking? Does CascadeGuard or a new idea now score higher?
- V2 should also consider: is there a stronger product concept that works WITH the thin agent population rather than around it?

---

## Open Questions for V2

1. Does the thin agent population on 0G actually hurt 0G Sentinel more than it hurts other ideas?
2. CascadeGuard's demo doesn't depend on agent population — does this make it comparatively stronger?
3. Is there a product concept that uses the thin agent population as the explicit product hook (e.g., "bootstrap the trust registry from zero" as a narrative)?
4. Should 0G Sentinel pivot to include hackathon-deployed agents as part of the live demo population — 974 registered participants may deploy agents during the hackathon window?
