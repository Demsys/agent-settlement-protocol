import { ethers } from 'hardhat'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployments', 'base-sepolia.json'), 'utf-8'))
  const registry = await ethers.getContractAt('EvaluatorRegistry', manifest.contracts.EvaluatorRegistry.address)
  const jobManager = await ethers.getContractAt('AgentJobManager', manifest.contracts.AgentJobManager.address)
  const token = await ethers.getContractAt('ProtocolToken', manifest.contracts.ProtocolToken.address)

  const evaluators = [
    { name: 'ThoughtProof (old)', addr: '0xB4B9Cb85A2642719ba919b0C0F25d2df570eB9C0' },
    { name: 'ThoughtProof (new)', addr: '0x118B1E5A47658D20046bC874cB34E469d472c0C2' },
    { name: 'pablocactus',        addr: '0x35eeDdcbE5E1AE01396Cb93Fc8606cE4C713d7BC' },
  ]

  console.log('=== EVALUATOR REGISTRY ===')
  const count = await registry.getEvaluatorCount()
  console.log(`Pool: ${count} active evaluator(s)\n`)

  for (const e of evaluators) {
    const stake    = await registry.getStake(e.addr)
    const eligible = await registry.isEligible(e.addr)
    const vrt      = await token.balanceOf(e.addr)
    const eth      = await ethers.provider.getBalance(e.addr)
    console.log(`${e.name}`)
    console.log(`  ${e.addr}`)
    console.log(`  ETH: ${parseFloat(ethers.formatEther(eth)).toFixed(4)} | VRT wallet: ${ethers.formatEther(vrt)} | Staked: ${ethers.formatEther(stake)} | Eligible: ${eligible}`)
  }

  console.log('\n=== JOBS ===')
  const statusLabel = ['Open','Funded','Submitted','Completed','Rejected','Expired']
  let totalJobs = 0
  for (let i = 1n; i <= 20n; i++) {
    try {
      const job = await jobManager.getJob(i)
      totalJobs++
      const status = statusLabel[Number(job.status)] ?? job.status.toString()
      const deadline = new Date(Number(job.deadline) * 1000).toISOString().replace('T',' ').slice(0,16)
      const budget = ethers.formatUnits(job.budget, 6)
      console.log(`Job #${i}: [${status}] ${budget} USDC | deadline: ${deadline} UTC`)
      console.log(`  evaluator: ${job.evaluator}`)
    } catch { break }
  }
  console.log(`\nTotal jobs found: ${totalJobs}`)

  console.log('\n=== CONTRACTS (Base Sepolia) ===')
  for (const [name, info] of Object.entries(manifest.contracts) as any) {
    console.log(`${name.padEnd(20)}: ${info.address}`)
  }
}

main().catch(e => { console.error(e.message); process.exitCode = 1 })
