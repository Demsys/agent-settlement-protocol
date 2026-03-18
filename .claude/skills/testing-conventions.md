# Conventions de test — protocole Agent Settlement

## Philosophie : tester les invariants, pas les chemins

Un test qui vérifie "createJob() retourne un jobId" teste une
implémentation. Un test qui vérifie "un job créé a toujours
le statut Open et son client est toujours msg.sender" teste un
invariant. Les invariants sont plus précieux car ils résistent
aux refactorisations.

Pour chaque contrat, identifier d'abord ses invariants fondamentaux,
puis écrire un test par invariant avant d'écrire les tests de cas
d'usage. Un invariant est une propriété qui doit être vraie
dans tous les états valides du contrat.

Invariants d'AgentJobManager :
  I1. jobs[jobId].budget == 0 si status est Terminal
  I2. jobs[jobId].evaluator != address(0) si status est Funded ou après
  I3. La somme de tous les budgets en escrow == solde token du contrat
  I4. Un job ne peut jamais revenir à un état antérieur

## Structure d'un fichier de test Hardhat

Le nom du fichier reflète le contrat testé : AgentJobManager.test.ts
La structure suit le pattern Arrange-Act-Assert dans cet ordre.

  describe("AgentJobManager", () => {
    // Setup partagé — exécuté avant chaque test
    beforeEach(async () => {
      // Déployer les contrats frais
      // Créer les signers (client, provider, evaluator, attacker)
      // Mint des tokens de test pour les participants
    })

    describe("createJob()", () => {
      it("should create a job in Open status", async () => { ... })
      it("should revert if provider is address zero", async () => { ... })
      it("should revert if provider equals client", async () => { ... })
      it("should revert if deadline is in the past", async () => { ... })
    })

    describe("Security", () => {
      it("should resist reentrancy on complete()", async () => { ... })
      it("should resist unauthorized evaluator on complete()", async () => { ... })
    })
  })

## Pattern pour tester une reentrancy

Pour tester la résistance à la reentrancy, déployer un contrat
malveillant dans le test lui-même, pas de mock externe.

  // Dans le test :
  const MaliciousToken = await ethers.getContractFactory("MaliciousERC20")
  const malToken = await MaliciousToken.deploy(jobManager.address)

  // MaliciousERC20.sol — contrat de test uniquement :
  contract MaliciousERC20 is ERC20 {
    IAgentJobManager public target;
    uint256 public attackJobId;
    bool public attacking;

    function transfer(address to, uint256 amount) override returns (bool) {
      if (!attacking && to != address(target)) {
        attacking = true;
        // Tenter le rappel avant que l'état soit mis à jour
        try target.complete(attackJobId, bytes32(0)) {
          // Si on arrive ici, la reentrancy a réussi — le test doit échouer
        } catch {}
        attacking = false;
      }
      return super.transfer(to, amount);
    }
  }

## Couverture minimale exigée avant déploiement testnet

Toutes les transitions d'état (cas nominal de chaque flèche du graphe),
tous les cas de revert documentés dans les custom errors,
les trois invariants fondamentaux vérifiés en post-condition,
au moins un test de reentrancy par fonction qui transfère des fonds.
