# Agent Settlement Protocol

## Vision du projet
Première implémentation de référence d'ERC-8183 (Agentic Commerce) avec
un layer économique décentralisé : réseau d'évaluateurs stakers, fee engine,
bridge de réputation vers ERC-8004, et token natif.

Le protocole se branche sur Google A2A comme adapter — il ne remplace pas
A2A, il lui ajoute le settlement trustless et la confiance cryptoéconomique.

## Standards cibles
- ERC-8183 (Agentic Commerce, 10 mars 2026) : implémentation core
- ERC-8004 (Trustless Agents, août 2025) : bridge de réputation
- x402 (Coinbase) : compatibilité micropaiements HTTP
- Google A2A : adapter TypeScript SDK

## Architecture des contrats
- AgentJobManager.sol    → implémentation ERC-8183 + fee hook (1%)
- EvaluatorRegistry.sol  → staking, sélection, slashing des évaluateurs
- ReputationBridge.sol   → bridge outcomes ERC-8183 → ERC-8004
- ProtocolToken.sol      → ERC-20 avec burn et governance

## Règles de développement
- Solidity 0.8.24, target : Base (Coinbase L2) + Ethereum mainnet
- Framework de test : Hardhat + ethers.js v6
- Pas de librairies externes non auditées (OpenZeppelin uniquement)
- Chaque fonction publique doit avoir un événement émis
- Commenter en anglais, variable names en camelCase
- Toujours vérifier : reentrancy, overflow, access control

## Ce qu'on ne construit PAS
- On ne réimplémente pas Google A2A (on s'y adapte)
- On ne construit pas de frontend pour l'instant
- On ne déploie pas en mainnet avant un audit complet

## Blockchain cible
Base Sepolia (testnet) pour le développement
Base mainnet pour la production
Chain ID testnet : 84532