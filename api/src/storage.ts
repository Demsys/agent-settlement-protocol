import * as fs from 'fs'
import * as path from 'path'

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface AgentRecord {
  agentId: string
  name: string
  address: string
  apiKey: string
  // AES-256-GCM encrypted private key: "iv:authTag:ciphertext" (all hex)
  encryptedPrivateKey: string
  createdAt: string
}

export interface JobRecord {
  jobId: string          // numeric on-chain job ID as string
  agentId: string
  txHash: string
  status: 'open' | 'funded' | 'submitted' | 'completed' | 'rejected' | 'expired'
  providerAddress: string
  budget: string         // human-readable (e.g. "5.00")
  deadlineMinutes: number
  createdAt: string
  updatedAt: string
}

// -------------------------------------------------------------------
// File paths
// -------------------------------------------------------------------

const DATA_DIR = path.resolve(__dirname, '..', 'data')
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json')
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json')

// -------------------------------------------------------------------
// Ensure data directory exists (safe on fresh clone, idempotent)
// -------------------------------------------------------------------

fs.mkdirSync(DATA_DIR, { recursive: true })

// -------------------------------------------------------------------
// Generic helpers
// -------------------------------------------------------------------

function ensureFile(filePath: string, defaultContent: string): void {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultContent, 'utf-8')
  }
}

function readJson<T>(filePath: string, defaultContent: string): T {
  ensureFile(filePath, defaultContent)
  const raw = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as T
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

// -------------------------------------------------------------------
// Agents
// -------------------------------------------------------------------

export function readAgents(): AgentRecord[] {
  return readJson<AgentRecord[]>(AGENTS_FILE, '[]')
}

export function writeAgents(agents: AgentRecord[]): void {
  writeJson(AGENTS_FILE, agents)
}

export function findAgentById(agentId: string): AgentRecord | undefined {
  return readAgents().find((a) => a.agentId === agentId)
}

export function findAgentByApiKey(apiKey: string): AgentRecord | undefined {
  return readAgents().find((a) => a.apiKey === apiKey)
}

export function saveAgent(agent: AgentRecord): void {
  const agents = readAgents()
  agents.push(agent)
  writeAgents(agents)
}

// -------------------------------------------------------------------
// Jobs
// -------------------------------------------------------------------

export function readJobs(): JobRecord[] {
  return readJson<JobRecord[]>(JOBS_FILE, '[]')
}

export function writeJobs(jobs: JobRecord[]): void {
  writeJson(JOBS_FILE, jobs)
}

export function findJobById(jobId: string): JobRecord | undefined {
  return readJobs().find((j) => j.jobId === jobId)
}

export function findJobsByAgentId(agentId: string): JobRecord[] {
  return readJobs().filter((j) => j.agentId === agentId)
}

export function saveJob(job: JobRecord): void {
  const jobs = readJobs()
  jobs.push(job)
  writeJobs(jobs)
}

export function updateJobStatus(
  jobId: string,
  status: JobRecord['status'],
  txHash?: string,
): void {
  const jobs = readJobs()
  const idx = jobs.findIndex((j) => j.jobId === jobId)
  if (idx === -1) throw new Error(`Job ${jobId} not found in storage`)
  jobs[idx].status = status
  jobs[idx].updatedAt = new Date().toISOString()
  if (txHash) jobs[idx].txHash = txHash
  writeJobs(jobs)
}
