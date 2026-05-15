# Base Ecosystem Fund — Grant Application
# Agent Settlement Protocol

*Draft — for review before submission*

---

## Project name

Agent Settlement Protocol (ASP)

## Website

[to be added — in progress]

## GitHub

[your public repo URL]

## Contact

Hugo Demouy — [email]

---

## One-line description

A trustless settlement and reputation layer for AI agent commerce, implementing ERC-8183 (Agentic Commerce) on Base.

---

## Project overview

Agent Settlement Protocol is the reference implementation of ERC-8183, the emerging Ethereum standard for agentic commerce. It provides the cryptoeconomic infrastructure that AI agents need to transact with each other trustlessly: escrow, evaluation, settlement, and on-chain reputation — without relying on a central coordinator.

The protocol is deployed on Base Sepolia and has already been exercised by real independent evaluators (ThoughtProof, pablocactus/RNWY), with on-chain job lifecycle — fund → submit → evaluate → settle — fully operational.

---

## The problem

AI agents are beginning to act as economic participants: ordering services, hiring other agents, paying for compute, and delivering work products. This is already happening today in LLM pipelines, multi-agent frameworks, and autonomous task runners.

The problem is that there is no trustless settlement layer for this commerce. Today's agentic transactions are:

- **Off-chain and unverifiable** — no public record, no dispute resolution
- **Centralized** — dependent on the platform (OpenAI, Google, Anthropic) as the trusted intermediary
- **Reputation-free** — an agent that fails to deliver has no on-chain record of that failure
- **Unauditable** — a client cannot prove they paid, a provider cannot prove they delivered

This creates a fundamental trust gap that limits the scale and autonomy of agentic commerce. As AI agents become more capable and take on higher-stakes tasks, this gap becomes a critical bottleneck.

### The convergence of DeFi and agentic AI

DeFi has spent a decade building the primitives for trustless value transfer: programmable escrow, transparent settlement, composable incentive structures, and on-chain governance. These primitives were built for humans but are naturally suited for machine-to-machine commerce.

Agentic AI is now creating demand for exactly these primitives — but at machine speed, at micro-scale, and without human oversight in the loop. The intersection is not incidental: AI agents need DeFi infrastructure, and DeFi protocols increasingly need AI agents to operate them (monitoring, rebalancing, arbitrage, governance participation).

Agent Settlement Protocol sits at this convergence. It does not compete with Google A2A or LangChain — it plugs into them as a settlement adapter, adding cryptoeconomic trust to any agentic workflow. The result is a market where AI agents can transact with each other with the same guarantees that DeFi users have today: auditable, non-custodial, and permissionless.

The addressable market is the intersection of the global AI services market (projected $500B+ by 2030) and the DeFi settlement layer — a segment that does not yet exist as infrastructure, which is precisely the opportunity.

---

## Solution

Agent Settlement Protocol implements ERC-8183 with four layers:

**1. Job lifecycle escrow (ERC-8183 core)**
A client funds a job in any whitelisted ERC-20 (USDC on Base mainnet). A provider delivers work. An independent evaluator (staked in VRT) calls `complete()` or `reject()`. Settlement is instant and on-chain.

**2. Decentralized evaluator network**
Evaluators stake VRT (the protocol token) to participate. They are stake-weighted selected and slashed for misbehavior. This is the key differentiator vs. other ERC-8183 implementations (e.g. CardZero, which uses a single trusted EOA as evaluator). A network of independent evaluators is more Sybil-resistant and more credibly neutral.

**3. Cryptoeconomic fee engine**
A configurable fee (proportional or fixed, governance-controlled) is split 80/20 between the evaluator and the protocol treasury. The treasury executes VRT buyback-and-burn on Aerodrome. This creates a sustainable economic loop: protocol usage → fees → VRT demand.

**4. On-chain reputation bridge (ERC-8004)**
Every settled job emits a reputation signal via ReputationBridge. Agents that deliver reliably accumulate verifiable on-chain reputation — not controlled by any platform, portable across protocols.

### Why Base

- Base is the natural home for this protocol: the highest throughput EVM L2, with Coinbase distribution and the most active developer ecosystem outside Ethereum mainnet.
- x402 (Coinbase's HTTP payment protocol) is a natural complement to ASP — x402 handles the payment signaling layer, ASP handles the settlement and reputation layer.
- Aerodrome (Base-native DEX) is the target for the VRT buyback-and-burn mechanism.
- Base's Ecotone upgrade (EIP-1153 transient storage) enables the `ReentrancyGuardTransient` we use in production — an EVM-level gas optimization only available on Cancun-compatible chains.

---

## Traction

- **ERC-8183 standard**: active contributor on the Ethereum Magicians forum thread. The protocol is discussed as a reference implementation by other ERC-8183 implementers.
- **First external evaluators**: ThoughtProof (Raul Jaeger) and pablocactus (Pablo A. Lopez / RNWY) have independently staked VRT, evaluated jobs, and settled payments on-chain on Base Sepolia.
- **Cross-implementation coordination**: technical exchanges with mrocker (CardZero) — the only other known mainnet ERC-8183 implementation — on shared interface standards (`EvaluatorSlashed` event selector, `scoringRulesHash` spec text for ERC-8183 v2).
- **ERC-8210 compatibility**: EvaluatorSlashed event design validated by cmayorga (author of ERC-8210 PR #1653) as compatible with the fileClaim pattern.
- **Middleware integrations in progress**: pablocactus/RNWY is integrating AHM (Agent Health Monitor) as a pre-evaluation behavioral signal layer. ThoughtProof is testing PLV (Plan-Level Verification) as a reasoning trace middleware. These are independent of the protocol core — they settle through the binary `complete()`/`reject()` interface.
- **Public GitHub**: open source (BUSL-1.1), full test suite (191 tests passing), deployment scripts, and ceremony documentation.

---

## Team

**Hugo Demouy** — Founder & sole engineer

Software engineer with a specialization in cybersecurity. Entrepreneur in the tech sector with several years of experience building and shipping products. Has been following AI developments closely for several years, with a focus on the economic and infrastructure implications of autonomous agents. Agent Settlement Protocol is the result of that conviction: that agentic commerce will be one of the defining infrastructure categories of the next decade, and that it needs a trustless settlement layer built now, before the market scales.

---

## Use of funds — $75,000

| Item | Amount | Rationale |
|---|---|---|
| Security audit (Code4rena contest or equivalent) | $50,000 | The protocol holds user funds. Audit is a hard prerequisite for mainnet. Prize pool funds an open competitive audit with public reports. |
| Legal — SAFT template + MiCA/AMF opinion on VRT | $15,000 | Required before any token distribution or investor conversation. French/EU regulatory context (MiCA). |
| Website (project presentation) | $5,000 | Single-page site presenting the protocol, documentation, and testnet dashboard to evaluators and integrators. |
| Buffer (gas, infrastructure, contingency) | $5,000 | Mainnet deployment gas, Railway hosting, unexpected audit remediation. |
| **Total** | **$75,000** | |

---

## Milestones

| Milestone | Target | Deliverable |
|---|---|---|
| Phase 2 testnet redeployment | 4 weeks | ReentrancyGuardTransient + evaluationFee live on Base Sepolia with updated evaluators |
| Audit submitted | 8 weeks | Code4rena contest opened, scope published |
| Legal opinion received | 8 weeks | SAFT template + MiCA utility token classification |
| Audit complete + remediation | 16 weeks | Audit report published, all findings addressed |
| Mainnet ceremony | 18 weeks | 4-EOA deployment, addresses published, community verification window |
| VRT liquidity on Aerodrome | 20 weeks | DEX pool live, buyback-and-burn mechanism active |

---

## Links

- GitHub: [your public repo URL]
- ERC-8183 forum thread: https://ethereum-magicians.org/t/erc-8183-agentic-commerce/27902
- Base Sepolia dashboard: [your Railway URL]
- INTERFACES.md (public interface changelog): [GitHub link]

---

*This application was prepared for the Base Ecosystem Fund. All technical claims are verifiable on-chain on Base Sepolia (chain ID 84532).*
