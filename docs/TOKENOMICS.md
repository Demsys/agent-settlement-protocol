# VRT Tokenomics

**Protocol:** Agent Settlement Protocol (ASP)
**Token:** VRT (Verifiable Reputation Token)
**Network:** Base (Coinbase L2)
**Contract:** `ProtocolToken.sol` — ERC-20, fixed supply, no mint function post-deployment

---

## Summary

VRT is the native protocol token of Agent Settlement Protocol. It serves three functions: **staking** (evaluator eligibility), **governance** (protocol parameter changes), and **value accrual** (buyback-and-burn from protocol fees). The supply is fixed at deployment — there is no inflation.

---

## Supply

**Total supply: 1,000,000,000 VRT (1 billion)**

Fixed at contract deployment. No `mint()` function exists post-deployment. The only supply reduction mechanism is `burn()`, called by the Treasury on VRT purchased via the buyback-and-burn mechanism.

---

## Distribution

| Category | % | Amount (VRT) | Vesting |
|---|---|---|---|
| Founder | 15% | 150,000,000 | 4 years, 1-year cliff |
| Ecosystem & Evaluators | 30% | 300,000,000 | 3-year linear release, governance-controlled |
| Treasury / Protocol | 25% | 250,000,000 | DAO-controlled (Governor post-launch) |
| Liquidity | 8% | 80,000,000 | Unlocked at TGE for DEX seeding |
| Community & Early Contributors | 7% | 70,000,000 | Distributed at TGE + 12-month linear |
| Investors (SAFT) | 15% | 150,000,000 | 2 years, 6-month cliff |

### Founder (15% — 150M VRT)

4-year vesting with a 1-year cliff. No tokens are liquid before month 12. This mirrors standard startup equity vesting and demonstrates long-term commitment to investors and the community.

### Ecosystem & Evaluators (30% — 300M VRT)

The largest single allocation. Used to bootstrap and sustain the evaluator network — the core differentiator of the protocol. Distributed via:

- **Evaluator staking incentives** — rewards for active, non-slashed evaluators proportional to jobs evaluated
- **Developer grants** — integrators building on ERC-8183, middleware layers (AHM, PLV), adapter SDKs
- **Ecosystem partnerships** — integrations with AI frameworks (Google A2A, LangChain, CrewAI)

Governed by the Treasury DAO. Disbursements are timelocked via the same GOVERNANCE_DELAY (2 days) pattern as protocol parameter changes.

### Treasury / Protocol (25% — 250M VRT)

Controlled by the Governor contract (OpenZeppelin Governor, to be deployed in the governance milestone). Used for:

- Protocol operations and security (bug bounties, future audits)
- Buyback-and-burn top-up (in addition to fee-generated buybacks)
- Strategic initiatives voted on by VRT holders

### Liquidity (8% — 80M VRT)

Unlocked at TGE to seed the VRT/USDC pool on Aerodrome (Base-native DEX). This allocation covers both the initial liquidity provision and market-making operations in the early post-launch period. Not sold — paired with USDC from the Treasury.

### Community & Early Contributors (7% — 70M VRT)

Airdrop to:

- Testnet evaluators (ThoughtProof, pablocactus) and other early participants
- ERC-8183 community contributors (mrocker/CardZero, cmayorga, JackyWang)
- Wallet addresses that interacted with the protocol on Base Sepolia

50% distributed at TGE, 50% vested linearly over 12 months. Snapshot taken at mainnet deployment.

### Investors / SAFT (15% — 150M VRT)

Reserved for fundraising rounds via SAFT (Simple Agreement for Future Tokens). Vesting: 2 years with a 6-month cliff, starting at TGE. The SAFT is denominated in USD and converts to VRT at TGE at the agreed valuation.

---

## Token utility

### 1. Evaluator staking

To participate as an evaluator, a wallet must stake a minimum amount of VRT in `EvaluatorRegistry`. Staked VRT:

- Determines selection weight (stake-weighted random draw on each job)
- Is at risk of slashing for misbehavior (malicious `complete()` or `reject()` calls)
- Cannot be withdrawn during the warmup period (7 days after staking)

This creates direct, ongoing demand for VRT: as more agents use the protocol and create jobs, more evaluators are needed, and each evaluator must hold and lock VRT.

### 2. Governance

VRT holders vote on protocol parameter changes via the Governor contract (post-launch):

- `feeRate` and `evaluationFee` (already timelocked in the current implementation)
- `EVALUATOR_SHARE_BPS` (evaluator/treasury fee split)
- Ecosystem fund disbursements
- Treasury buyback-and-burn execution

### 3. Value accrual — buyback-and-burn

Every job settled on the protocol generates a fee (currently 0.5% of job budget, split 80/20 evaluator/treasury). The treasury's 20% accumulates in USDC. Governance periodically calls `Treasury.buybackAndBurn()`, which:

1. Swaps accumulated USDC for VRT on Aerodrome
2. Calls `ProtocolToken.burn()` on the received VRT

This permanently reduces the circulating supply. As protocol usage grows, the burn rate increases, creating deflationary pressure on VRT supply without requiring any new issuance.

---

## Economic model

### Fee flow

```
Job budget (USDC)
  └─ gross fee = min(evaluationFee, budget)  [fixed mode]
               = budget × feeRate / 10,000   [proportional mode]
       ├─ 80% → evaluator wallet (immediate)
       └─ 20% → Treasury contract
                    └─ accumulated → buybackAndBurn() → VRT burned
```

### Demand drivers

| Driver | Mechanism |
|---|---|
| Evaluator onboarding | Each new evaluator must buy and stake VRT |
| Protocol usage growth | More jobs → more fees → more buyback-and-burn |
| Governance participation | VRT holders vote on fee parameters and fund disbursements |
| Slashing | Misbehaving evaluators lose VRT (reduces circulating supply) |

### Supply reduction

| Event | Effect on supply |
|---|---|
| Buyback-and-burn | Permanent burn — supply decreases with protocol revenue |
| Evaluator slashing | Burned immediately — no redistribution |
| Vesting cliff (founder, investors) | Reduces early liquid supply pressure |

---

## Vesting schedule (visual)

```
Month:     0    6    12   18   24   30   36   48
           |    |    |    |    |    |    |    |

Founder    ░░░░░░░░░░░████████████████████████  (cliff m12, linear m12→m48)
Ecosystem  ████████████████████████████████████  (linear m0→m36, governance)
Treasury   ████████████████████████████████████  (DAO-controlled, no schedule)
Liquidity  ████  (100% at TGE)
Community  ████░░░░░░░░░░░░░░░░░░░░  (50% TGE, 50% linear m0→m12)
Investors  ░░░░░░░░░░░████████████████████████  (cliff m6, linear m6→m30)
```

---

## TGE (Token Generation Event)

TGE occurs at mainnet deployment (Base mainnet ceremony). At TGE:

1. Full supply is minted to the deployer wallet
2. Allocations are transferred to their respective vesting contracts / multisigs
3. Liquidity allocation is paired with USDC and deposited into the Aerodrome VRT/USDC pool
4. Community airdrop (50% tranche) is distributed via merkle drop
5. Token becomes tradeable

**No pre-sale, no public sale, no ICO.** Distribution is limited to: SAFT investors (pre-agreed), ecosystem grants, community airdrop, and liquidity seeding.

---

## Valuation reference points

These are indicative reference ranges for discussion with investors. They are not offers.

| Stage | FDV range | Basis |
|---|---|---|
| Pre-audit (SAFT) | $5M–$10M | Early risk, testnet traction, reference implementation |
| Post-audit (SAFT) | $10M–$20M | Audit report de-risks the protocol significantly |
| TGE | Market-determined | Aerodrome AMM price discovery |

At a $10M FDV and 1B supply: 1 VRT = $0.01. A $100k SAFT investment at this FDV receives 10M VRT (1% of supply), vesting over 2 years with 6-month cliff.

---

## Legal notice

VRT is a utility token used exclusively for protocol participation (staking, governance). It is not a security, does not represent equity in any legal entity, and does not guarantee any financial return. This document is informational. Any investment in VRT via SAFT is subject to a separate legal agreement reviewed by qualified counsel. MiCA (EU) compliance review is in progress.

---

*Last updated: 2026-05-15*
*Version: 0.1 — draft, subject to change before TGE*
