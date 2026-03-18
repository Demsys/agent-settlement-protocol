# Agent Settlement Protocol

> **La première implémentation de référence d'ERC-8183** — une couche économique décentralisée qui apporte la confiance, le settlement trustless et la réputation on-chain à l'écosystème Google A2A.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
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
- [Installation et démarrage](#installation-et-démarrage)
- [Développement avec Claude Code](#développement-avec-claude-code)
- [Smart contracts](#smart-contracts)
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
│  │ Staking · Slash  │ │ 1% · Burn50% │ │ ERC-8183→ERC-8004 │  │
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

**Étape 6 — Settlement automatique (ERC-8183 + notre Fee Hook).** Si `complete()` : 99% du budget va au Provider, 1% va au FeeRecipient (dont 50% brûlé, 50% distribué aux stakers). Si `reject()` : le Client est remboursé intégralement. Si expiration : le Client peut appeler `claimExpired()` pour récupérer ses fonds.

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
│   │   ├── AgentJobManager.sol      # Implémentation ERC-8183 + Fee Hook
│   │   ├── EvaluatorRegistry.sol    # Staking, sélection, slashing
│   │   └── ReputationBridge.sol     # Bridge ERC-8183 → ERC-8004
│   └── token/
│       └── ProtocolToken.sol        # ERC-20 avec burn et governance
│
├── sdk/
│   └── src/
│       ├── index.ts                 # Exports publics
│       ├── AgentSettlementClient.ts # Point d'entrée principal
│       ├── adapters/
│       │   └── A2AAdapter.ts        # A2A Task → ERC-8183 Job
│       ├── contracts/
│       │   ├── AgentJobManager.ts   # Wrapper du contrat core
│       │   └── EvaluatorRegistry.ts # Wrapper du registre
│       ├── types/
│       │   └── index.ts             # Types TypeScript du projet
│       └── utils/
│           ├── errors.ts            # Erreurs typées custom
│           └── events.ts            # Helpers events on-chain
│
├── test/
│   ├── unit/
│   │   ├── AgentJobManager.test.ts  # Tests unitaires des contrats
│   │   └── EvaluatorRegistry.test.ts
│   └── integration/
│       └── fullFlow.test.ts         # Flow complet end-to-end
│
├── scripts/
│   ├── deploy.ts                    # Script de déploiement ordonné
│   └── verify.ts                    # Vérification sur Basescan
│
├── .claude/
│   ├── agents/
│   │   ├── solidity-dev.md          # Sous-agent développeur Solidity
│   │   ├── sdk-dev.md               # Sous-agent développeur TypeScript
│   │   ├── security-reviewer.md     # Sous-agent auditeur sécurité
│   │   └── docs-updater.md          # Sous-agent maintenance documentation
│   └── skills/
│       ├── erc8183-spec.md          # Spec complète ERC-8183
│       ├── erc8004-reputation.md    # Spec ERC-8004 pour la réputation
│       ├── solidity-security-patterns.md  # Patterns de sécurité
│       ├── testing-conventions.md   # Conventions de test
│       └── deployment-config.md     # Configuration réseau et paramètres
│
├── CLAUDE.md                        # Mémoire du projet pour Claude Code
├── hardhat.config.ts                # Configuration Hardhat
├── package.json
├── tsconfig.json
└── README.md                        # Ce fichier
```

---

## Installation et démarrage

### Prérequis

Vous avez besoin de Node.js 18 ou supérieur (`node --version` pour vérifier), npm ou yarn, et Git. Pour interagir avec la blockchain, vous aurez besoin d'un wallet avec des ETH de test sur Base Sepolia — disponibles gratuitement sur le faucet QuickNode.

### Installation

Clonez le dépôt et installez les dépendances :

```bash
git clone https://github.com/votre-org/agent-settlement-protocol.git
cd agent-settlement-protocol
npm install
```

Copiez le fichier d'environnement et renseignez vos valeurs :

```bash
cp .env.example .env
```

Le fichier `.env` doit contenir les variables suivantes :

```bash
# Clé privée de votre wallet de déploiement (Base Sepolia uniquement)
# Ne jamais utiliser un wallet avec des fonds réels pour les tests
PRIVATE_KEY=0x...

# RPC URL pour Base Sepolia
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# Clé API Basescan pour la vérification des contrats (optionnel)
BASESCAN_API_KEY=...
```

### Compilation des contrats

```bash
npx hardhat compile
```

Si la compilation réussit, les ABI générés sont disponibles dans `artifacts/`. Le SDK TypeScript les importe directement depuis ce dossier.

### Lancer les tests

```bash
# Tous les tests
npx hardhat test

# Tests unitaires uniquement
npx hardhat test test/unit/

# Tests avec rapport de couverture
npx hardhat coverage
```

---

## Développement avec Claude Code

Ce projet est conçu pour être développé en collaboration avec Claude Code, l'outil en ligne de commande d'Anthropic. L'architecture multi-agents permet de déléguer chaque type de tâche au sous-agent le mieux adapté.

### Installation de Claude Code

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

### Démarrage d'une session

Depuis la racine du projet, lancez simplement :

```bash
claude
```

Claude Code lira automatiquement `CLAUDE.md` et aura le contexte complet du projet. Il n'est pas nécessaire de réexpliquer l'architecture à chaque session.

### Utilisation des sous-agents

Quatre sous-agents spécialisés sont disponibles. Chacun a un rôle précis et délimité pour éviter les chevauchements et garantir la cohérence du code produit.

**`solidity-dev`** est votre développeur Solidity. Il connaît ERC-8183, les patterns de sécurité OpenZeppelin, et les contraintes spécifiques à Base. Utilisez-le pour écrire ou modifier tout fichier `.sol`.

```bash
/agent solidity-dev
En suivant erc8183-spec et solidity-security-patterns,
implémente AgentJobManager.sol avec le hook de fee à 1%.
```

**`sdk-dev`** est votre développeur TypeScript. Il maîtrise l'intégration d'ethers.js v6, la conception d'APIs developer-friendly, et le protocole A2A. Utilisez-le pour tout le code dans le dossier `sdk/`.

```bash
/agent sdk-dev
Implémente AgentSettlementClient.ts avec la méthode
createAndFundJob() qui prend un A2A Task en entrée.
```

**`security-reviewer`** est votre auditeur. Il adopte une posture adversariale et cherche à prouver que le code est cassable. Appelez-le systématiquement après chaque fichier Solidity produit par `solidity-dev`, avant tout déploiement.

```bash
/agent security-reviewer
Audite ce fichier AgentJobManager.sol soumis ci-dessous.
[contenu du fichier]
```

**`docs-updater`** maintient la cohérence entre le code implémenté et les skills de documentation. Appelez-le en fin de session pour mettre à jour les fichiers `.claude/skills/` si l'implémentation a révélé des nuances non documentées.

```bash
/agent docs-updater
Lors de cette session, nous avons ajouté un état Disputed
à l'enum JobStatus et modifié le calcul de fee pour les
jobs avec budget inférieur à 1 USDC. Mets à jour les skills
concernés.
```

### Les skills — la mémoire partagée

Les fichiers dans `.claude/skills/` sont la mémoire technique du projet. Ils sont consultés par les sous-agents à la demande. Contrairement à `CLAUDE.md` (lu automatiquement), les skills sont des références spécialisées invoquées pour une tâche précise. Ils ne se mettent pas à jour automatiquement — c'est le rôle du `docs-updater` appelé manuellement en fin de session.

---

## Smart contracts

### AgentJobManager.sol

Contrat central du protocole. Il implémente fidèlement l'interface ERC-8183 et y ajoute notre Fee Hook qui prélève 1% à chaque `complete()`. Le fee rate est un paramètre gouvernable (maximum 5%) modifiable via vote DAO.

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

## SDK TypeScript

Le SDK expose une API simple qui rend la blockchain invisible pour le développeur d'agents. Toutes les complexités — gestion du gas, approbations ERC-20, attente de confirmation, décodage des erreurs — sont gérées en interne.

### Installation du SDK

```bash
npm install @agent-settlement/sdk
```

### Utilisation de base

```typescript
import { AgentSettlementClient } from '@agent-settlement/sdk'
import { ethers } from 'ethers'

// Initialisation
const provider = new ethers.JsonRpcProvider('https://sepolia.base.org')
const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider)

const client = new AgentSettlementClient(signer, {
  jobManagerAddress: '0x...',
  evaluatorRegistryAddress: '0x...',
  network: 'base-sepolia'
})

// Créer et financer un job en une seule opération
const result = await client.createAndFundJob({
  provider: '0x...adresse-du-provider-agent...',
  task: myA2ATask,        // un A2A Task standard
  budget: '5.00',         // en USDC, pas en wei
  token: 'USDC',
  deadlineMinutes: 60
})

console.log(`Job créé : ${result.jobId}`)

// Observer l'évolution du job
const job = client.watchJob(result.jobId)
job.on('submitted', (event) => console.log('Livrable soumis'))
job.on('completed', (event) => console.log('Job complété, paiement libéré'))
job.on('expired', (event) => console.log('Job expiré, remboursement disponible'))
```

### Gestion des erreurs

Le SDK expose des erreurs typées pour tous les cas d'échec prévisibles. Les erreurs blockchain brutes ne remontent jamais jusqu'à l'utilisateur.

```typescript
import {
  InsufficientBalanceError,
  EvaluatorUnavailableError,
  JobExpiredError,
  InvalidAddressError
} from '@agent-settlement/sdk'

try {
  await client.createAndFundJob(params)
} catch (e) {
  if (e instanceof InsufficientBalanceError) {
    console.error(`Solde insuffisant : ${e.required} ${e.token} requis`)
  }
  if (e instanceof EvaluatorUnavailableError) {
    console.error('Aucun évaluateur disponible, réessayez dans quelques minutes')
  }
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

### Phase 0 — Fondations (en cours)

Mise en place de l'environnement de développement Claude Code, écriture de `IAgentJobManager.sol` (l'interface de référence), configuration des sous-agents et skills, et documentation initiale.

### Phase 1 — MVP technique (mois 1-3)

Implémentation complète des quatre smart contracts, suite de tests avec couverture >95%, SDK TypeScript avec adapter A2A fonctionnel, et déploiement sur Base Sepolia avec démonstration d'un job complet entre deux agents de test.

### Phase 2 — Validation et traction (mois 3-8)

Premier partenariat avec un projet AI Agent existant (ElizaOS, Virtuals Protocol, ou similaire) pour utiliser le protocole en conditions réelles, audit de sécurité préliminaire, et seed round.

### Phase 3 — Lancement (mois 8-14)

Audit de sécurité complet, IDO / TGE sur Base, déploiement mainnet, et objectif de 500 agents actifs et 10 000 jobs par mois dans les 90 jours suivant le lancement.

---

## Contribuer

Ce projet accueille les contributions, en particulier sur les smart contracts (nouvelles implémentations de Hooks), le SDK TypeScript (support de nouveaux frameworks d'agents), et la documentation technique.

Avant de soumettre une Pull Request, assurez-vous que tous les tests passent (`npx hardhat test`), que le code Solidity a été examiné par le sous-agent `security-reviewer`, et que les skills de documentation ont été mis à jour si votre contribution introduit un nouveau pattern ou une nouvelle décision architecturale.

---

## Licence

MIT License — voir [LICENSE](./LICENSE) pour les détails.

---

*Agent Settlement Protocol — Construire la couche de confiance pour l'économie agentique.*

*ERC-8183 est un standard en cours de proposition (DRAFT). Ce projet est une implémentation de référence expérimentale. Ne pas utiliser avec des fonds réels avant un audit de sécurité complet.*
