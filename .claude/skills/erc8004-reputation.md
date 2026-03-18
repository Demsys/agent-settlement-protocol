# ERC-8004 — Trustless Agents — Référence pour la réputation

## Auteurs et date
Marco De Rossi (MetaMask), Davide Crapis (Ethereum Foundation),
Jordan Ellis (Google), Erik Reppel (Coinbase). Août 2025.

## Ce que ERC-8004 fournit et qu'on réutilise

ERC-8004 définit trois couches pour la confiance entre agents.
La couche Identité : chaque agent a un identifiant on-chain,
potentiellement un NFT qui encode des métadonnées structurées
(capabilities, endpoint URL, supported protocols).
La couche Réputation : un registre on-chain qui accumule les
signaux de confiance issus des interactions passées.
La couche Validation : des mécanismes pluggables pour prouver
qu'un agent a bien exécuté ce qu'il prétend avoir exécuté
(ZK proofs, TEE attestations, re-execution avec stake).

## L'interface de réputation que notre bridge doit appeler

Notre ReputationBridge.sol doit appeler cette interface
sur le registre ERC-8004 déployé quand un job atteint
son état Terminal.

  interface IERC8004ReputationRegistry {
    function recordOutcome(
      address agent,       // l'agent dont la réputation est mise à jour
      address counterpart, // l'autre agent impliqué dans l'interaction
      bool    positive,    // true = Completed, false = Rejected
      uint256 jobId,       // référence on-chain vérifiable
      bytes32 reason       // hash du rapport d'évaluation
    ) external;

    function getScore(address agent) external view returns (uint256);
  }

## Les signaux que notre protocole génère vers ERC-8004

À chaque JobCompleted : signal positif pour le Provider (a livré),
signal positif pour l'Evaluator (a évalué dans les délais).
À chaque JobRejected par l'Evaluator : signal négatif pour le Provider
(n'a pas livré ou livré hors spec), signal neutre pour l'Evaluator.
À chaque JobExpired : signal négatif léger pour le Provider
(n'a pas soumis dans le délai), signal neutre pour le Client.

## Adresse du registre ERC-8004 sur Base

Testnet (Base Sepolia) : à confirmer après déploiement de référence
Mainnet (Base) : non encore déployé — prévoir une variable configurable
