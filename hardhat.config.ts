import { HardhatUserConfig } from "hardhat/config"
import "@nomicfoundation/hardhat-toolbox"
import * as dotenv from "dotenv"

// Charge les variables depuis .env (PRIVATE_KEY, BASE_SEPOLIA_RPC_URL, etc.)
dotenv.config()

// On récupère la clé privée depuis l'environnement.
// La valeur par défaut est une clé fictive qui permet à Hardhat de démarrer
// même si .env n'existe pas encore — utile pour la compilation locale.
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? ""

const config: HardhatUserConfig = {
  // Version du compilateur Solidity — doit correspondre au pragma dans vos .sol
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        // 200 runs est un bon équilibre entre coût de déploiement et coût d'exécution.
        // Plus la valeur est haute, plus les appels sont bon marché mais le déploiement coûte plus.
        runs: 200,
      },
      // viaIR: required to resolve "stack too deep" in complex functions (AgentJobManager.complete)
      // that use gas-capped external calls ({gas: 50_000}). The IR pipeline enables more
      // aggressive stack optimization without changing runtime behavior.
      viaIR: true,
      // OpenZeppelin 5.6.x uses the mcopy opcode which requires the Cancun EVM version.
      // Base and Ethereum mainnet both support Cancun (post-Dencun upgrade, March 2024).
      evmVersion: "cancun",
    },
  },

  // Définition des réseaux disponibles
  networks: {
    // Réseau local Hardhat — utilisé automatiquement pour les tests
    hardhat: {
      chainId: 31337,
    },
    // Base Sepolia — notre testnet cible
    "base-sepolia": {
      url: BASE_SEPOLIA_RPC_URL,
      accounts: [PRIVATE_KEY],
      chainId: 84532,
    },
  },

  // Vérification via Etherscan V2 (supporte Base Sepolia nativement via chainid)
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
    customChains: [
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=84532",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },

  // Sourcify — vérification décentralisée, pas de clé API requise
  sourcify: {
    enabled: true,
  },

  // Dossier où Hardhat génère les types TypeScript depuis les ABI
  // Le SDK les importera depuis cet endroit
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
}

export default config
