import { ethers } from 'hardhat'
import * as fs from 'fs'

async function main() {
  const deployment = JSON.parse(fs.readFileSync('deployments/base-sepolia.json', 'utf8'))
  const registry = await ethers.getContractAt('EvaluatorRegistry', deployment.contracts.EvaluatorRegistry.address)

  const wallets: Record<string, string> = {
    'ThoughtProof new': '0x118B1E5A47658D20046bC874cB34E469d472c0C2',
    'pablocactus':      '0x35eeDdcbE5E1AE01396Cb93Fc8606cE4C713d7BC',
  }

  const count = await registry.getEvaluatorCount()
  console.log(`EvaluatorRegistry: ${deployment.contracts.EvaluatorRegistry.address}`)
  console.log(`Total active evaluators: ${count}\n`)

  for (const [name, addr] of Object.entries(wallets)) {
    const stake   = await registry.getStake(addr)
    const eligible = await registry.isEligible(addr)
    console.log(`${name} (${addr})`)
    console.log(`  staked:   ${ethers.formatEther(stake)} VRT`)
    console.log(`  eligible: ${eligible}`)
  }
}

main().catch(console.error)
