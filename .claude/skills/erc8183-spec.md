# ERC-8183 — Agentic Commerce — Spec de référence

## Contexte et intention du standard
ERC-8183 a été soumis par Davide Crapis (Ethereum Foundation, dAI team)
et Virtuals Protocol le 10 mars 2026. Il définit le primitif minimal
pour le commerce trustless entre agents IA : un Job avec escrow,
trois rôles, et un cycle de vie à quatre états.

Le standard est intentionnellement minimal. Il ne définit PAS :
la négociation de prix, la découverte d'agents, la réputation,
les mécanismes de dispute, ni les fees protocole.
Ce sont précisément ces lacunes que notre protocole comble.

## Les quatre états et leurs transitions légales

Un Job ne peut qu'avancer dans ce graphe — jamais reculer.

  Open → Funded         : fund() appelé par le Client
  Open → Rejected       : reject() appelé par le Client uniquement
  Funded → Submitted    : submit() appelé par le Provider
  Funded → Rejected     : reject() appelé par l'Evaluator uniquement
  Funded → Expired      : automatique si block.timestamp > deadline
  Submitted → Completed : complete() appelé par l'Evaluator
  Submitted → Rejected  : reject() appelé par l'Evaluator

Toute autre transition doit reverter. C'est une machine à états stricte.

## Les trois rôles et leurs permissions exactes

Le Client est l'adresse qui crée le job et dépose les fonds.
Il peut rejeter un job seulement quand il est à l'état Open.
Il est remboursé si le job est Rejected ou Expired.

Le Provider est l'adresse qui exécute la tâche.
Il appelle submit() pour soumettre son livrable.
Il est payé si et seulement si l'Evaluator appelle complete().
Il ne peut jamais appeler complete() ou reject().

L'Evaluator est l'adresse qui arbitre le résultat.
C'est le rôle central de notre extension : dans la spec de base,
c'est "juste une adresse". Dans notre protocole, si l'adresse fournie
est address(0) à la création, notre EvaluatorRegistry assigne
automatiquement un évaluateur du réseau stakers.

## Les fonctions du contrat minimal selon la spec

createJob(provider, evaluator, token, deadline) → jobId
setBudget(jobId, amount)       : Provider ou Client peuvent proposer
fund(jobId, expectedBudget)    : Client dépose en escrow
submit(jobId, deliverable)     : Provider soumet le livrable (hash)
complete(jobId, reason?)       : Evaluator valide → paie le Provider
reject(jobId, reason?)         : Evaluator ou Client rejette
claimExpired(jobId)            : Client récupère après expiration

## Les Hooks — notre mécanisme d'extension

ERC-8183 définit des Hooks comme points d'extension optionnels.
Un Hook est un contrat externe appelé à des moments précis du cycle.
Notre fee engine est implémenté comme un Hook sur complete().

Un Hook sur complete() reçoit : (jobId, provider, budget)
Il peut modifier le montant transféré au Provider.
Notre FeeHook prélève 1% et l'envoie au ProtocolToken.

## Ce que la spec recommande explicitement

"Implementations MAY emit ERC-8004 compatible events or call
ERC-8004 registries when a job reaches a terminal state."

C'est la justification officielle de notre ReputationBridge.sol.
Chaque Job complété ou rejeté génère un signal de réputation
pour le Provider et l'Evaluator dans le registre ERC-8004.
