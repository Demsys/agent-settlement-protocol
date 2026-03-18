# Configuration de déploiement — Agent Settlement Protocol

## Réseau cible pour le développement

Base Sepolia Testnet uniquement pour toutes les sessions de développement.
Chain ID : 84532
RPC URL : https://sepolia.base.org
Block Explorer : https://sepolia.basescan.org
Faucet ETH de test : https://faucet.quicknode.com/base/sepolia

Règle absolue : aucun déploiement sur Base mainnet (chain ID 8453)
avant un audit de sécurité professionnel complet.

## Tokens de test disponibles sur Base Sepolia

USDC de test (MockUSDC) : à déployer nous-mêmes avec un contrat
ERC-20 minimal qui permet le mint libre pour les tests.
Ne pas utiliser l'adresse USDC officielle sur testnet — elle
nécessite un whitelist pour recevoir des tokens.

## Paramètres initiaux du protocole à la construction

feeRate initial : 100 (= 1%, en basis points sur 10000)
feeRateMaximum : 500 (= 5%, plafond gouvernable)
minJobDeadline : 5 minutes (300 secondes)
minEvaluatorStake : 100 tokens (en unités de base, 18 décimales)

## Ordre de déploiement des contrats

L'ordre est important car certains contrats ont besoin de l'adresse
des autres dans leur constructeur.

  1. ProtocolToken.sol        (pas de dépendances)
  2. EvaluatorRegistry.sol    (dépend de ProtocolToken)
  3. AgentJobManager.sol      (dépend de EvaluatorRegistry + ProtocolToken)
  4. ReputationBridge.sol     (dépend de AgentJobManager)

Après déploiement, appeler obligatoirement :
  AgentJobManager.setFeeRecipient(ProtocolToken.address)
  EvaluatorRegistry.setJobManager(AgentJobManager.address)
```

---

## Comment les skills s'articulent avec les sous-agents

Pour être vraiment utile, un skill ne doit pas être lu passivement — il doit être invoqué au bon moment. Dans Claude Code, vous référencez un skill en le mentionnant explicitement dans votre 
requête. Par exemple, quand vous demandez à `solidity-dev` d'écrire `AgentJobManager.sol`, vous écrivez :
```
/agent solidity-dev
En suivant erc8183-spec et solidity-security-patterns,
implémente AgentJobManager.sol avec le hook de fee à 1%.
