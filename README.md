# Agent Settlement Protocol

> **La première implémentation de référence d'ERC-8183** — une couche économique décentralisée qui apporte la confiance, le settlement trustless et la réputation on-chain à l'écosystème Google A2A.

[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL%201.1-blue.svg)](./LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-blue)](https://soliditylang.org)
[![Network](https://img.shields.io/badge/Network-Base%20Sepolia-blue)](https://sepolia.basescan.org)
[![Standard](https://img.shields.io/badge/Standard-ERC--8183-purple)](https://eips.ethereum.org/EIPS/eip-8183)
[![Status](https://img.shields.io/badge/Status-En%20développement-orange)]()

---

## Table des matières

- [Vision du projet](#vision-du-projet)
- [Contexte et problème résolu](#contexte-et-problème-résolu)
- [Architecture du protocole](#architecture-du-protocole)
- [Standards implémentés](#standards-implémentés)
- [Le token natif](#le-token-natif)
- [Structure du projet](#structure-du-projet)
- [Quick Start — Testnet live](#quick-start--testnet-live)
- [Installation et démarrage](#installation-et-démarrage)
- [Smart contracts](#smart-contracts)
- [API REST](#api-rest)
- [SDK TypeScript](#sdk-typescript)
- [Tests](#tests)
- [Déploiement](#déploiement)
- [Sécurité](#sécurité)
- [Feuille de route](#feuille-de-route)
- [Contribuer](#contribuer)
- [Licence](#licence)

---

## Vision du projet

L'économie agentique est en train de naître. Des dizaines de milliers d'agents IA autonomes — des programmes capables de prendre des décisions, d'exécuter des tâches et de communiquer entre eux sans intervention humaine — commencent à opérer sur des réseaux décentralisés. Google, Anthropic, Coinbase, et plus de 150 organisations majeures ont standardisé leur façon de se parler via le protocole A2A (Agent2Agent, Linux Foundation, juin 2025).

Mais résoudre la communication ne résout pas la confiance. Quand un agent IA commande un service à un autre agent, qui garantit que le travail sera fait ? Qui détient l'argent pendant l'exécution ? Qui arbitre si le résultat est contesté ? Qui construit la réputation de chaque agent au fil du temps ?

**Agent Settlement Protocol répond à ces quatre questions** en construisant la première implémentation de référence d'ERC-8183 (Agentic Commerce, Ethereum Foundation + Virtuals Protocol, 10 mars 2026) — enrichie d'un réseau d'évaluateurs décentralisés, d'un mécanisme de réputation on-chain, et d'un token natif qui aligne les incitations de tous les participants.

---

## Contexte et problème résolu

### L'analogie Upwork pour l'économie agentique

Imaginez Upwork — la plateforme où des entreprises publient des missions et des freelances les exécutent. Upwork joue le rôle de tiers de confiance : il détient l'argent en escrow, vérifie que le travail est fait, et libère le paiement. Ce modèle fonctionne parce qu'Upwork est une entreprise réelle, soumise à la loi, avec une réputation à protéger.

Maintenant remplacez les humains par des agents IA autonomes. Ces agents ne peuvent pas signer de contrats légaux. Ils ne peuvent pas faire confiance à une plateforme centralisée qui peut changer ses règles, bloquer des fonds, ou disparaître. Et surtout, ils opèrent à une vitesse et une échelle qu'aucun humain ne peut superviser transaction par transaction.

Il faut l'équivalent décentralisé d'Upwork pour agents IA — un système où les règles sont encodées dans des smart contracts immuables, où personne ne peut bloquer les fonds arbitrairement, et où la réputation de chaque agent est construite de manière transparente et vérifiable par tous.

### Ce que Google A2A résout — et ce qu'il laisse ouvert

Google A2A (avril 2025, Linux Foundation) définit un standard de communication universel entre agents : comment ils se découvrent, comment ils se parlent, comment ils se délèguent des tâches. C'est une contribution fondamentale, adoptée par 150+ organisations. Mais A2A est explicitement hors-scope sur tout ce qui concerne l'économie : pas de paiement, pas d'escrow, pas de réputation, pas de résolution de conflits.

Ce gap est précisément notre marché.

### Ce que ERC-8183 résout — et ce qu'il laisse ouvert

ERC-8183 (10 mars 2026) définit le primitif minimal pour le commerce trustless entre agents : un `Job` avec quatre états (Open → Funded → Submitted → Terminal), trois rôles (Client, Provider, Evaluator), et un escrow programmable. C'est le bon fondement.

Mais ERC-8183 est intentionnellement minimal. Il dit "il faut un Evaluator" sans préciser qui il est, pourquoi on lui fait confiance, ni comment il est incité à être honnête. Il ne définit pas de fees protocole, pas de réputation, pas de discovery. C'est un squelette qui attend sa chair.

**Notre protocole est cette chair.** Il implémente ERC-8183 et y ajoute exactement ce qui manque : un réseau décentralisé d'évaluateurs stakers, un bridge de réputation vers ERC-8004, un fee engine avec mécanisme burn, et un adapter A2A qui rend tout cela accessible en quelques lignes de TypeScript.

---

## Architecture du protocole

Le protocole s'organise en quatre couches superposées. Chaque couche s'appuie sur la précédente et apporte une valeur distincte.

```
┌─────────────────────────────────────────────────────────────────┐
│  COUCHE 4 — SDK TypeScript (A2A Adapter)                        │
│  Reçoit un A2A Task · Crée le Job · Gère l'escrow · Retourne   │
│  le résultat · Émet les événements de suivi                     │
├─────────────────────────────────────────────────────────────────┤
│  COUCHE 3 — Layer économique (notre valeur ajoutée)             │
│                                                                 │
│  ┌──────────────────┐ ┌──────────────┐ ┌───────────────────┐  │
│  │ EvaluatorRegistry│ │  Fee Engine  │ │ ReputationBridge  │  │
│  │ Staking · Slash  │ │ 0.5% · Burn  │ │ ERC-8183→ERC-8004 │  │
│  └──────────────────┘ └──────────────┘ └───────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  COUCHE 2 — ERC-8183 (implémentation de référence)              │
│  AgentJobManager · Escrow · Job lifecycle · Hooks               │
├─────────────────────────────────────────────────────────────────┤
│  COUCHE 1 — Standards existants réutilisés                      │
│  Google A2A · MCP (Anthropic) · x402 (Coinbase) · ERC-8004     │
└─────────────────────────────────────────────────────────────────┘
```

### Flow complet d'une transaction inter-agents

Voici ce qui se passe concrètement quand un agent IA commande un service à un autre, de bout en bout.

**Étape 1 — Discovery (A2A natif).** Agent Client envoie une requête A2A. Notre SDK intercepte la requête, consulte le registre on-chain pour vérifier le score de réputation du Provider ciblé (ex : 94/100, 1 847 jobs réussis), et décide si le job peut être lancé.

**Étape 2 — Trust check (notre layer).** Le SDK interroge `EvaluatorRegistry` pour obtenir l'adresse d'un évaluateur disponible, sélectionné pseudo-aléatoirement parmi les stakers actifs, pondéré par leur stake et leur score historique.

**Étape 3 — Job creation & escrow (ERC-8183).** Le SDK crée le job on-chain via `AgentJobManager.createJob()`, puis dépose le budget en escrow avec `fund()`. Les fonds sont locked dans le smart contract — ni le Client, ni le Provider, ni notre équipe ne peut les déplacer unilatéralement.

**Étape 4 — Exécution (A2A natif).** L'agent Provider reçoit la tâche A2A, l'exécute, et soumet son livrable (ou son hash cryptographique) on-chain via `submit()`.

**Étape 5 — Évaluation (notre layer).** L'Evaluator examine la soumission par rapport aux critères définis dans le job. Il appelle `complete()` (travail validé) ou `reject()` (travail refusé).

**Étape 6 — Settlement automatique (ERC-8183 + notre Fee Hook).** Si `complete()` : 99,5% du budget va au Provider, 0,5% va au FeeRecipient (dont 50% brûlé, 50% distribué aux stakers). Si `reject()` : le Client est remboursé intégralement. Si expiration : le Client peut appeler `claimExpired()` pour récupérer ses fonds.

**Étape 7 — Réputation (notre layer).** `ReputationBridge` émet automatiquement un signal ERC-8004 pour le Provider et l'Evaluator, qui met à jour leur score on-chain. Ce score est visible par tous les autres agents du réseau.

---

## Standards implémentés

### ERC-8183 — Agentic Commerce

Proposé le 10 mars 2026 par Davide Crapis (Ethereum Foundation, dAI team) et Virtuals Protocol. Ce standard définit le primitif minimal pour le commerce trustless entre agents : un Job avec escrow conditionnel, une machine à états en quatre phases, et un système d'extension par Hooks.

Notre protocole est la première implémentation de référence de ce standard. Nous avons pris soin d'implémenter exactement l'interface spécifiée, sans la déformer, et d'utiliser les mécanismes d'extension prévus (Hooks) pour nos ajouts.

### ERC-8004 — Trustless Agents

Proposé en août 2025 par Marco De Rossi (MetaMask), Davide Crapis (Ethereum Foundation), Jordan Ellis (Google), et Erik Reppel (Coinbase). Ce standard définit l'identité et la réputation on-chain des agents. Notre `ReputationBridge` connecte les outcomes de nos jobs aux signaux ERC-8004, construisant ainsi une réputation interopérable avec tout l'écosystème.

### x402 — Agent Payments Protocol (Coinbase)

Le protocole x402 de Coinbase (2025) permet aux agents de recevoir et d'effectuer des micropaiements via HTTP 402. Notre SDK est compatible x402 : un agent peut utiliser x402 pour pré-financer son wallet, puis utiliser ce wallet pour payer des jobs sur notre protocole.

### Google A2A — Agent2Agent Protocol

Le standard A2A (Linux Foundation, juin 2025) gère la découverte et la communication entre agents. Notre SDK TypeScript s'intègre nativement comme un adapter A2A : il reçoit des `A2A Tasks`, les traduit en `ERC-8183 Jobs`, et retourne les résultats dans le format A2A standard.

---

## Le token natif

Le token du protocole n'est pas un token de spéculation — c'est un composant fonctionnel non-substituable du protocole. Il remplit trois rôles que ni les stablecoins ni l'ETH ne peuvent assurer.

### Staking d'évaluateurs

Pour qu'une adresse soit éligible comme évaluateur, elle doit déposer un stake minimum de tokens dans `EvaluatorRegistry`. Ce stake est la caution de bonne conduite : si l'évaluateur est identifié comme malhonnête (via un mécanisme de challenge décentralisé), une fraction de son stake est slashée et redistribuée aux participants lésés. Sans token natif, ce mécanisme de collateral ne peut pas fonctionner de manière véritablement décentralisée.

### Fee capture et burn mécanique

Chaque transaction complétée génère un fee de 1% (paramètre gouvernable, maximum 5%) distribué comme suit : 50% est brûlé définitivement, réduisant l'offre totale circulante ; 50% est distribué proportionnellement aux évaluateurs actifs stakers. Ce mécanisme crée une corrélation directe entre le volume de transactions du réseau et la pression déflationnaire sur le token.

### Gouvernance du protocole

Les détenteurs de tokens votent sur les paramètres du protocole : taux de fee, stake minimum des évaluateurs, règles de slashing, liste des tokens acceptés pour le paiement des jobs, et les upgrades du protocole. Le token utilise `ERC20Votes` d'OpenZeppelin pour permettre la délégation de vote, compatible avec les standards de gouvernance on-chain.

### Distribution initiale

| Tranche | Pourcentage | Vesting |
|---|---|---|
| Équipe fondatrice | 15% | 4 ans, cliff 1 an |
| Investisseurs seed | 10% | 2 ans, cliff 6 mois |
| Écosystème et développeurs | 25% | Émission sur 5 ans |
| Treasury DAO | 20% | Gouvernance on-chain |
| Récompenses staking | 20% | Émission algorithmique |
| Vente publique (IDO) | 10% | Immédiat (limité) |

---

## Structure du projet

```
agent-settlement-protocol/
│
├── contracts/
│   ├── interfaces/
│   │   └── IAgentJobManager.sol     # Interface ERC-8183 complète
│   ├── core/
│   │   ├── AgentJobManager.sol      # Implémentation ERC-8183 + Fee Hook (0.5%)
│   │   ├── EvaluatorRegistry.sol    # Staking, sélection pseudo-aléatoire, slashing
│   │   └── ReputationBridge.sol     # Bridge outcomes ERC-8183 → ERC-8004
│   ├── token/
│   │   └── ProtocolToken.sol        # ERC-20 avec burn et ERC20Votes
│   └── test/
│       └── MockUSDC.sol             # USDC de test avec mint() libre
│
├── api/                             # API REST Express (serveur de settlement)
│   └── src/
│       ├── index.ts                 # Routes + logique métier (9 endpoints)
│       ├── contracts.ts             # Connexion ethers.js aux contrats déployés
│       ├── storage.ts               # Persistance JSON locale (agents + jobs)
│       └── wallet.ts                # Wallets managés chiffrés AES-256-GCM
│
├── sdk/                             # SDK TypeScript (@asp/sdk)
│   └── src/
│       ├── index.ts                 # Re-exports publics
│       ├── AgentClient.ts           # Classe principale (toutes les opérations)
│       ├── JobWatcher.ts            # EventEmitter de polling jusqu'à état terminal
│       ├── types.ts                 # Types partagés (JobStatus, JobRecord, params)
│       └── errors.ts                # Erreurs typées (ApiError, JobNotFoundError…)
│
├── scripts/
│   ├── deploy.ts                    # Déploiement ordonné des 5 contrats
│   └── monitor.ts                   # Visualisation on-chain de tous les jobs
│
├── deployments/
│   └── base-sepolia.json            # Adresses des contrats déployés + config
│
├── test/                            # Tests Hardhat (à compléter)
│   ├── unit/
│   └── integration/
│
├── .env.example                     # Template des variables d'environnement
├── CLAUDE.md                        # Contexte projet pour Claude Code
├── hardhat.config.ts                # Configuration Hardhat + Solidity 0.8.24
├── package.json
└── tsconfig.json
```

---

## Quick Start — Testnet live


Les contrats sont déployés et vérifiés sur Base Sepolia. Voici comment interagir avec le protocole en 5 minutes.

### Contrats déployés (Base Sepolia)

| Contrat | Adresse | Basescan |
|---|---|---|
| AgentJobManager | `0x739362c2995a13dB684B57CC6BCF8Fb1FeDE4200` | [voir](https://sepolia.basescan.org/address/0x739362c2995a13dB684B57CC6BCF8Fb1FeDE4200#readContract) |
| EvaluatorRegistry | `0x44919317f7FA0722b555dE43082661045eb20086` | [voir](https://sepolia.basescan.org/address/0x44919317f7FA0722b555dE43082661045eb20086#readContract) |
| ReputationBridge | `0x195C1ec510703d874a1635f089BFf42f7fE5aE40` | [voir](https://sepolia.basescan.org/address/0x195C1ec510703d874a1635f089BFf42f7fE5aE40#readContract) |
| ProtocolToken | `0x63C60385368f89C18E011F58c633F0C9C8C9902E` | [voir](https://sepolia.basescan.org/address/0x63C60385368f89C18E011F58c633F0C9C8C9902E#readContract) |
| MockUSDC | `0x0f272a4ba4EDab053F856A40306f78150AF5b703` | [voir](https://sepolia.basescan.org/address/0x0f272a4ba4EDab053F856A40306f78150AF5b703#readContract) |

### Démarrer l'API

```bash
# Variables d'environnement requises dans .env :
# PRIVATE_KEY=0x...            (wallet deployer — joue le rôle d'évaluateur)
# BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
# WALLET_ENCRYPTION_KEY=...    (32 bytes hex, généré au premier lancement)

cd api
npm install
npm run dev
# → Agent Settlement API running on http://localhost:3000
```

### Flow complet d'un job (curl)

**1. Créer deux agents**

```bash
# Agent Client
curl -X POST http://localhost:3000/v1/agents \
  -H "Content-Type: application/json" \
  -d '{"name": "Agent Alice"}'
# → { agentId, address, apiKey }

# Agent Provider
curl -X POST http://localhost:3000/v1/agents \
  -H "Content-Type: application/json" \
  -d '{"name": "Agent Bob"}'
# → { agentId, address, apiKey }
```

> Approvisionner les wallets avec des ETH Base Sepolia : [faucet.coinbase.com](https://faucet.coinbase.com)

**2. Créer et financer un job**

```bash
# Alice crée un job pour Bob (5 USDC, deadline 60 min)
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -H "x-api-key: <ALICE_API_KEY>" \
  -d '{"providerAddress": "<BOB_ADDRESS>", "budget": "5.00", "deadlineMinutes": 60}'
# → { jobId: "1", txHash, basescanUrl, status: "open" }

# Alice finance l'escrow (mint MockUSDC + approve + fund on-chain)
curl -X POST http://localhost:3000/v1/jobs/1/fund \
  -H "x-api-key: <ALICE_API_KEY>"
# → { jobId: "1", txHash, basescanUrl, status: "funded" }
```

**3. Bob soumet son livrable**

```bash
curl -X POST http://localhost:3000/v1/jobs/1/submit \
  -H "Content-Type: application/json" \
  -H "x-api-key: <BOB_API_KEY>" \
  -d '{"deliverable": "rapport_final.pdf — tâche terminée"}'
# → { jobId: "1", txHash, deliverableHash, status: "submitted" }
```

**4. L'évaluateur approuve — paiement automatique**

```bash
curl -X POST http://localhost:3000/v1/jobs/1/complete \
  -H "Content-Type: application/json" \
  -H "x-api-key: <ALICE_API_KEY>" \
  -d '{"reason": "Travail validé"}'
# → { jobId: "1", txHash, basescanUrl, status: "completed" }
```

**5. Vérifier les soldes**

```bash
curl http://localhost:3000/v1/agents/<BOB_AGENT_ID>/balance
# → { usdcBalance: "4.975" }  ← 5 USDC moins 0.5% de protocol fee
```

### Monitorer les transactions on-chain

```bash
npx hardhat run scripts/monitor.ts --network base-sepolia
```

Affiche l'historique complet de tous les jobs :

```
─── Job #1  [Completed ✓]
  [39228759] JobCreated   client=0xAd6334... provider=0x7eE67c...
  [39228774] JobFunded    amount=5.0 USDC
  [39229121] JobSubmitted deliverable=0x527262...
  [39229127] JobCompleted payment=4.975 USDC  fee=0.025 USDC
```

---

## Installation et démarrage

### Prérequis

Node.js 18+, npm, Git. Pour déployer vos propres contrats : un wallet avec des ETH de test sur Base Sepolia (faucet : [faucet.quicknode.com/base/sepolia](https://faucet.quicknode.com/base/sepolia)).

### Installation

```bash
git clone https://github.com/hugobiais/agent-settlement-protocol.git
cd agent-settlement-protocol
npm install          # contrats + scripts
cd api && npm install  # API REST
cd ../sdk && npm install && npm run build  # SDK TypeScript
```

### Configuration

```bash
cp .env.example .env
# Renseigner PRIVATE_KEY, BASE_SEPOLIA_RPC_URL, WALLET_ENCRYPTION_KEY
```

Variables requises :

| Variable | Obligatoire | Description |
|---|---|---|
| `PRIVATE_KEY` | Oui | Clé privée du wallet deployer (testnet uniquement) |
| `BASE_SEPOLIA_RPC_URL` | Oui | RPC Base Sepolia (ex: `https://sepolia.base.org`) |
| `WALLET_ENCRYPTION_KEY` | Oui (API) | 32 bytes hex pour chiffrer les wallets managés |
| `ETHERSCAN_API_KEY` | Non | Vérification contrats via Etherscan V2 |

### Compilation des contrats

```bash
npx hardhat compile
# → artifacts/ + typechain-types/ générés
```

### Lancer les tests

```bash
npx hardhat test
npx hardhat coverage
```

---

## Smart contracts

### AgentJobManager.sol

Contrat central du protocole. Il implémente fidèlement l'interface ERC-8183 et y ajoute notre Fee Hook qui prélève 0,5% (50 bps) à chaque `complete()`. Le fee rate est un paramètre gouvernable (maximum 5%) modifiable via vote DAO.

Les transitions d'état sont gérées comme une machine à états stricte : toute tentative de transition invalide reverte avec un custom error qui encode l'état actuel et l'état attendu, facilitant le debugging et le monitoring.

```solidity
// Exemple d'utilisation directe (le SDK abstrait ces appels)
uint256 jobId = jobManager.createJob(
    providerAddress,
    address(0),      // 0x0 = assignation automatique depuis EvaluatorRegistry
    usdcAddress,
    block.timestamp + 1 hours
);
jobManager.setBudget(jobId, 5_000_000); // 5 USDC (6 décimales)
usdc.approve(address(jobManager), 5_000_000);
jobManager.fund(jobId, 5_000_000);
```

### EvaluatorRegistry.sol

Registre décentralisé des évaluateurs. Pour être éligible, un participant doit staker un minimum de tokens (`minEvaluatorStake`, gouvernable). La sélection d'un évaluateur pour un job mélange plusieurs sources d'entropie (block.prevrandao, jobId, timestamp, adresse du client) pour résister au front-running.

Le mécanisme de slashing est déclenché exclusivement par `AgentJobManager` — jamais directement — garantissant que seuls les outcomes vérifiés on-chain peuvent affecter le stake d'un évaluateur.

### ReputationBridge.sol

Contrat stateless (il ne détient jamais de fonds) qui écoute les événements de `AgentJobManager` et appelle `IERC8004ReputationRegistry.recordOutcome()` pour chaque job Terminal. Il construit ainsi la réputation interopérable des agents, visible par tout protocole compatible ERC-8004.

### ProtocolToken.sol

Token ERC-20 avec `ERC20Votes` pour la gouvernance on-chain (délégation de vote compatible Governor), `ERC20Burnable` pour le mécanisme de burn, et un rôle `MINTER_ROLE` contrôlé par le DAO pour les émissions futures.

---

## API REST

Serveur Express (`api/`) qui expose le protocole via HTTP. Il gère des wallets managés chiffrés (AES-256-GCM) pour chaque agent — le développeur n'a jamais à manipuler de clés privées directement.

### Démarrage

```bash
cd api && npm run dev
# → Agent Settlement API running on http://localhost:3000
```

### Endpoints

| Méthode | Chemin | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/agents` | — | Crée un agent + wallet managé |
| `GET` | `/v1/agents/:id/balance` | — | Soldes ETH + USDC |
| `POST` | `/v1/jobs` | `x-api-key` | Crée un job on-chain |
| `GET` | `/v1/jobs` | `x-api-key` | Liste les jobs de l'agent |
| `GET` | `/v1/jobs/:id` | — | État live on-chain |
| `POST` | `/v1/jobs/:id/fund` | `x-api-key` | Mint → approve → fund escrow |
| `POST` | `/v1/jobs/:id/submit` | `x-api-key` | Provider soumet le livrable |
| `POST` | `/v1/jobs/:id/complete` | `x-api-key` | Évaluateur approuve → paiement |
| `POST` | `/v1/jobs/:id/reject` | `x-api-key` | Évaluateur rejette → remboursement |

---

## SDK TypeScript

Package `@asp/sdk` indépendant (zéro dépendance runtime). Il parle exclusivement à l'API REST — aucune interaction blockchain directe.

### Build

```bash
cd sdk && npm install && npm run build
```

### Utilisation

```typescript
import AgentClient from '@asp/sdk'

// Créer un agent (retourne instance + apiKey)
const { client, agentId, address } = await AgentClient.createAgent('Alice')

// Créer et financer un job
const job = await client.createJob({
  providerAddress: '0x...adresse-de-Bob...',
  budget: '5.00',
  deadlineMinutes: 60
})
await client.fundJob(job.jobId)

// Surveiller l'état en temps réel (polling automatique)
const watcher = client.watchJob(job.jobId)
watcher.on('update', (status) => console.log('Nouvel état :', status))
watcher.on('complete', () => console.log('Paiement libéré'))
watcher.on('rejected', () => console.log('Livrable rejeté'))
watcher.on('error', console.error)

// Consulter le solde d'un agent
const balance = await AgentClient.getBalance(agentId)
console.log(balance.usdcBalance) // "4.975"
```

### Gestion des erreurs

```typescript
import { ApiError, JobNotFoundError, InvalidStateError } from '@asp/sdk'

try {
  await client.fundJob('999')
} catch (e) {
  if (e instanceof JobNotFoundError) { /* job inexistant */ }
  if (e instanceof InvalidStateError) { /* mauvais état (ex: déjà funded) */ }
  if (e instanceof ApiError) { console.log(e.status, e.code) }
}
```

---

## Tests

### Philosophie

Les tests de ce projet vérifient des **invariants**, pas des implémentations. Un invariant est une propriété qui doit être vraie dans tous les états valides du contrat.

Les quatre invariants fondamentaux d'`AgentJobManager` sont : le budget d'un job est toujours zéro si son statut est Terminal ; l'Evaluator d'un job Funded ou après n'est jamais `address(0)` ; la somme de tous les budgets en escrow est toujours égale au solde en tokens du contrat ; un job ne peut jamais revenir à un état antérieur.

### Couverture minimale exigée avant déploiement testnet

Toutes les transitions d'état dans les deux sens (nominal et revert), tous les custom errors avec leurs paramètres exacts, les quatre invariants fondamentaux vérifiés en post-condition de chaque opération, au moins un test de reentrancy par fonction qui transfère des fonds, et un test d'expiration avec simulation du passage du temps via `time.increase()` de Hardhat.

### Lancer les tests

```bash
# Suite complète avec rapport de gas
REPORT_GAS=true npx hardhat test

# Test unique par nom
npx hardhat test --grep "should resist reentrancy"

# Coverage HTML dans coverage/
npx hardhat coverage
```

---

## Déploiement

### Réseau de développement — Base Sepolia uniquement

Tout déploiement pendant la phase de développement se fait exclusivement sur Base Sepolia (chain ID 84532). Aucun déploiement sur Base mainnet avant la réalisation d'un audit de sécurité professionnel complet par une firme indépendante.

```bash
# Déploiement sur Base Sepolia
npx hardhat run scripts/deploy.ts --network base-sepolia

# Vérification des contrats sur Basescan
npx hardhat run scripts/verify.ts --network base-sepolia
```

### Ordre de déploiement

L'ordre est déterminé par les dépendances entre contrats. `ProtocolToken` n'a aucune dépendance et se déploie en premier. `EvaluatorRegistry` dépend de `ProtocolToken`. `AgentJobManager` dépend des deux précédents. `ReputationBridge` dépend d'`AgentJobManager`.

Après déploiement, deux transactions de configuration sont nécessaires : appeler `AgentJobManager.setFeeRecipient(ProtocolToken.address)` pour connecter le fee engine, et `EvaluatorRegistry.setJobManager(AgentJobManager.address)` pour autoriser le slashing.

---

## Sécurité

### Principes non-négociables

Tous les contrats implémentent le pattern **Checks-Effects-Interactions** (CEI) sans exception. Toutes les fonctions qui transfèrent des fonds sont protégées par `ReentrancyGuard`. Tous les transferts de tokens utilisent `SafeERC20` — jamais `token.transfer()` directement. Les remboursements utilisent le pattern **Pull over Push** pour résister au griefing.

### Signalement de vulnérabilités

Ce protocole est en développement actif et n'a pas encore fait l'objet d'un audit professionnel. Si vous identifiez une vulnérabilité de sécurité, merci de **ne pas l'ouvrir comme issue publique**. Envoyez un rapport détaillé à [security@votre-domaine.com] avec la description de la vulnérabilité, un scénario d'exploit pas à pas, et l'impact estimé.

### Audits planifiés

Un audit de sécurité professionnel complet est planifié avant tout déploiement sur Base mainnet. Les firmes envisagées sont Trail of Bits, OpenZeppelin Security, et Certik. L'audit couvrira l'intégralité des smart contracts, avec une attention particulière aux mécanismes de slashing et à l'accès à l'Evaluator.

---

## Feuille de route

### Phase 0 — Fondations ✅

Interface `IAgentJobManager.sol` (ERC-8183), 5 contrats Solidity, déploiement sur Base Sepolia, vérification Sourcify, API REST 9 endpoints, SDK TypeScript `@asp/sdk`.

**Prouvé en production (testnet)** : Job #4 complété on-chain — Alice a mis 5 USDC en escrow, Bob a soumis un livrable, l'évaluateur a approuvé, Bob a reçu 4,975 USDC (fee 0,5% déduit).

### Phase 1 — Solidification (en cours)

Suite de tests Hardhat avec couverture >95%, script de démo end-to-end, adapter Google A2A, et documentation technique complète.

### Phase 2 — Validation et traction

Premier partenariat avec un projet AI Agent existant (ElizaOS, Virtuals Protocol, ou similaire), audit de sécurité préliminaire, et seed round.

### Phase 3 — Lancement

Audit de sécurité complet par une firme indépendante (Trail of Bits, OpenZeppelin Security), IDO / TGE sur Base, déploiement mainnet, objectif 500 agents actifs et 10 000 jobs/mois dans les 90 jours suivant le lancement.

---

## Contribuer

Ce projet accueille les contributions, en particulier sur les smart contracts (nouvelles implémentations de Hooks), le SDK TypeScript (support de nouveaux frameworks d'agents), et la documentation technique.

Avant de soumettre une Pull Request, assurez-vous que tous les tests passent (`npx hardhat test`), que le code Solidity a été examiné par le sous-agent `security-reviewer`, et que les skills de documentation ont été mis à jour si votre contribution introduit un nouveau pattern ou une nouvelle décision architecturale.

---

## Licence

**Business Source License 1.1** — voir [LICENSE](./LICENSE) pour les détails complets.

Le code source est librement lisible et auditable. L'usage commercial est soumis à licence jusqu'au **23 mars 2030**, date à laquelle la licence bascule automatiquement en **MIT**.

Usage non-commercial (recherche, éducation, projets personnels) : libre et sans restriction.

---

*Agent Settlement Protocol — Construire la couche de confiance pour l'économie agentique.*

*ERC-8183 est un standard en cours de proposition (DRAFT). Ce projet est une implémentation de référence expérimentale. Ne pas utiliser avec des fonds réels avant un audit de sécurité complet.*
