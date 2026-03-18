# Patterns de sécurité Solidity — référence projet

## Pattern 1 — Checks-Effects-Interactions (CEI)

Règle : dans toute fonction qui transfère des fonds, l'ordre
doit toujours être : (1) vérifications, (2) mises à jour d'état,
(3) appels externes et transferts.

Pourquoi : un token malveillant peut rappeler notre contrat depuis
son hook transfer(). Si l'état n'est pas encore mis à jour,
la vérification passe une deuxième fois et les fonds sont doublés.

Exemple correct pour complete() :
  // (1) CHECKS
  if (job.status != JobStatus.Submitted) revert InvalidStatus(...);
  if (msg.sender != job.evaluator) revert NotAuthorized(...);

  // (2) EFFECTS — tout mettre à jour avant les transferts
  uint256 payment = job.budget - fee;
  job.status = JobStatus.Completed;
  job.budget = 0;  // crucial : remettre à zéro avant de transférer

  // (3) INTERACTIONS — transferts en dernier
  SafeERC20.safeTransfer(job.token, job.provider, payment);
  SafeERC20.safeTransfer(job.token, feeRecipient, fee);
  emit JobCompleted(jobId, job.provider, payment);

Signal d'alerte : si tu vois safeTransfer() avant job.budget = 0,
c'est une reentrancy. Corriger immédiatement.

## Pattern 2 — Pull over Push pour les remboursements

Règle : ne jamais envoyer des fonds automatiquement à une adresse
externe. Enregistrer le montant dû et laisser le destinataire
les réclamer avec une fonction claimRefund().

Pourquoi : un contrat malveillant peut rejeter les transferts entrants
(pas de fallback, ou fallback qui reverte), ce qui bloquerait toute
la fonction de remboursement pour tout le monde.

Implémentation dans notre protocole :
  // Dans reject() et claimExpired() :
  pendingRefunds[job.client] += job.budget;
  job.budget = 0;
  emit JobRefundPending(jobId, job.client, amount);

  // Fonction séparée, appelée par le client quand il veut :
  function claimRefund() external nonReentrant {
    uint256 amount = pendingRefunds[msg.sender];
    if (amount == 0) revert NothingToRefund();
    pendingRefunds[msg.sender] = 0;  // CEI : effet avant interaction
    SafeERC20.safeTransfer(defaultToken, msg.sender, amount);
    emit RefundClaimed(msg.sender, amount);
  }

## Pattern 3 — Validation des adresses à la création du Job

Règle : à la création d'un job, vérifier que provider, evaluator,
et token sont tous des adresses valides et distinctes.

Les vérifications obligatoires dans createJob() :
  if (provider == address(0)) revert ZeroAddress("provider");
  if (token == address(0)) revert ZeroAddress("token");
  if (provider == msg.sender) revert SelfAssignment("provider");
  if (evaluator == msg.sender) revert SelfAssignment("evaluator");
  if (evaluator == provider) revert SelfAssignment("evaluator");
  if (deadline <= block.timestamp + 5 minutes) revert DeadlineTooSoon();

## Pattern 4 — Custom errors plutôt que strings

Règle : toujours utiliser des custom errors, jamais require("message").

Pourquoi : économise ~50 gas par revert, permet au SDK TypeScript
de décoder précisément l'erreur, et facilite les tests unitaires.

  // Ne jamais faire :
  require(msg.sender == job.evaluator, "Not evaluator");

  // Toujours faire :
  error NotAuthorized(address caller, uint256 jobId, string role);
  if (msg.sender != job.evaluator)
      revert NotAuthorized(msg.sender, jobId, "evaluator");

## Pattern 5 — Casts de type avec vérification de bounds

Règle : avant tout cast réducteur (uint256 → uint128),
vérifier explicitement que la valeur rentre dans le type cible.

  // Vulnérable — troncature silencieuse si amount > 2^128 :
  uint128 budget = uint128(amount);

  // Correct :
  if (amount > type(uint128).max)
      revert BudgetExceedsMaximum(amount, type(uint128).max);
  uint128 budget = uint128(amount);
