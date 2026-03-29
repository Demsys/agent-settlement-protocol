import Database from 'better-sqlite3'
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
// Database initialisation
// -------------------------------------------------------------------

const DATA_DIR = path.resolve(process.cwd(), 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })
const DB_PATH = path.join(DATA_DIR, 'asp.db')

const db = new Database(DB_PATH)

// WAL mode gives better concurrent read performance and avoids
// write contention between background handler callbacks.
db.pragma('journal_mode = WAL')

// Schema migrations — idempotent, safe to run on every startup.
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    agentId            TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    address            TEXT NOT NULL,
    apiKey             TEXT NOT NULL UNIQUE,
    encryptedPrivateKey TEXT NOT NULL,
    createdAt          TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS jobs (
    jobId           TEXT PRIMARY KEY,
    agentId         TEXT NOT NULL,
    txHash          TEXT NOT NULL,
    status          TEXT NOT NULL,
    providerAddress TEXT NOT NULL,
    budget          TEXT NOT NULL,
    deadlineMinutes INTEGER NOT NULL,
    createdAt       TEXT NOT NULL,
    updatedAt       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agents_apiKey ON agents(apiKey);
  CREATE INDEX IF NOT EXISTS idx_jobs_agentId  ON jobs(agentId);
`)

// -------------------------------------------------------------------
// One-time JSON migration
// Imports legacy flat-file data on first run then archives the files
// so subsequent restarts are not slowed by re-importing stale data.
// -------------------------------------------------------------------

const AGENTS_JSON = path.join(DATA_DIR, 'agents.json')
const JOBS_JSON   = path.join(DATA_DIR, 'jobs.json')

function migrateFromJson(): void {
  // Agents
  if (fs.existsSync(AGENTS_JSON)) {
    try {
      const raw = fs.readFileSync(AGENTS_JSON, 'utf-8')
      const agents: AgentRecord[] = JSON.parse(raw)
      const insert = db.prepare(`
        INSERT OR IGNORE INTO agents
          (agentId, name, address, apiKey, encryptedPrivateKey, createdAt)
        VALUES
          (@agentId, @name, @address, @apiKey, @encryptedPrivateKey, @createdAt)
      `)
      const importAll = db.transaction((rows: AgentRecord[]) => {
        for (const row of rows) insert.run(row)
      })
      importAll(agents)
      fs.renameSync(AGENTS_JSON, AGENTS_JSON + '.bak')
      console.log(`[storage] Migrated ${agents.length} agent(s) from agents.json → SQLite`)
    } catch (err) {
      console.warn('[storage] Failed to migrate agents.json:', err)
    }
  }

  // Jobs
  if (fs.existsSync(JOBS_JSON)) {
    try {
      const raw = fs.readFileSync(JOBS_JSON, 'utf-8')
      const jobs: JobRecord[] = JSON.parse(raw)
      const insert = db.prepare(`
        INSERT OR IGNORE INTO jobs
          (jobId, agentId, txHash, status, providerAddress, budget, deadlineMinutes, createdAt, updatedAt)
        VALUES
          (@jobId, @agentId, @txHash, @status, @providerAddress, @budget, @deadlineMinutes, @createdAt, @updatedAt)
      `)
      const importAll = db.transaction((rows: JobRecord[]) => {
        for (const row of rows) insert.run(row)
      })
      importAll(jobs)
      fs.renameSync(JOBS_JSON, JOBS_JSON + '.bak')
      console.log(`[storage] Migrated ${jobs.length} job(s) from jobs.json → SQLite`)
    } catch (err) {
      console.warn('[storage] Failed to migrate jobs.json:', err)
    }
  }
}

migrateFromJson()

// -------------------------------------------------------------------
// Prepared statements (created once, reused across all requests)
// -------------------------------------------------------------------

const stmts = {
  insertAgent: db.prepare(`
    INSERT INTO agents (agentId, name, address, apiKey, encryptedPrivateKey, createdAt)
    VALUES (@agentId, @name, @address, @apiKey, @encryptedPrivateKey, @createdAt)
  `),
  selectAllAgents: db.prepare('SELECT * FROM agents'),
  selectAgentById: db.prepare('SELECT * FROM agents WHERE agentId = ?'),
  selectAgentByApiKey: db.prepare('SELECT * FROM agents WHERE apiKey = ?'),

  insertJob: db.prepare(`
    INSERT OR REPLACE INTO jobs (jobId, agentId, txHash, status, providerAddress, budget, deadlineMinutes, createdAt, updatedAt)
    VALUES (@jobId, @agentId, @txHash, @status, @providerAddress, @budget, @deadlineMinutes, @createdAt, @updatedAt)
  `),
  selectAllJobs: db.prepare('SELECT * FROM jobs'),
  selectJobById: db.prepare('SELECT * FROM jobs WHERE jobId = ?'),
  selectJobsByAgentId: db.prepare('SELECT * FROM jobs WHERE agentId = ?'),
  updateJobStatus: db.prepare(`
    UPDATE jobs SET status = @status, updatedAt = @updatedAt, txHash = COALESCE(@txHash, txHash)
    WHERE jobId = @jobId
  `),
}

// -------------------------------------------------------------------
// Agents
// -------------------------------------------------------------------

export function readAgents(): AgentRecord[] {
  return stmts.selectAllAgents.all() as AgentRecord[]
}

// Kept for interface parity with the old flat-file API.
// Direct writes via writeAgents() are no longer the primary path —
// use saveAgent() instead, which is atomic via a prepared statement.
export function writeAgents(_agents: AgentRecord[]): void {
  throw new Error('writeAgents() is not supported with SQLite storage — use saveAgent() directly')
}

export function findAgentById(agentId: string): AgentRecord | undefined {
  return stmts.selectAgentById.get(agentId) as AgentRecord | undefined
}

export function findAgentByApiKey(apiKey: string): AgentRecord | undefined {
  return stmts.selectAgentByApiKey.get(apiKey) as AgentRecord | undefined
}

export function saveAgent(agent: AgentRecord): void {
  stmts.insertAgent.run(agent)
}

// -------------------------------------------------------------------
// Jobs
// -------------------------------------------------------------------

export function readJobs(): JobRecord[] {
  return stmts.selectAllJobs.all() as JobRecord[]
}

// Kept for interface parity. Same caveat as writeAgents().
export function writeJobs(_jobs: JobRecord[]): void {
  throw new Error('writeJobs() is not supported with SQLite storage — use saveJob() directly')
}

export function findJobById(jobId: string): JobRecord | undefined {
  const row = stmts.selectJobById.get(jobId) as JobRecord | undefined
  if (!row) return undefined
  // SQLite stores integers as numbers — normalise deadlineMinutes back to number
  return { ...row, deadlineMinutes: Number(row.deadlineMinutes) }
}

export function findJobsByAgentId(agentId: string): JobRecord[] {
  const rows = stmts.selectJobsByAgentId.all(agentId) as JobRecord[]
  return rows.map((r) => ({ ...r, deadlineMinutes: Number(r.deadlineMinutes) }))
}

export function saveJob(job: JobRecord): void {
  stmts.insertJob.run(job)
}

export function updateJobStatus(
  jobId: string,
  status: JobRecord['status'],
  txHash?: string,
): void {
  const result = stmts.updateJobStatus.run({
    jobId,
    status,
    updatedAt: new Date().toISOString(),
    txHash: txHash ?? null,
  })
  if (result.changes === 0) throw new Error(`Job ${jobId} not found in storage`)
}
