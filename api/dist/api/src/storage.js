"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readAgents = readAgents;
exports.writeAgents = writeAgents;
exports.findAgentById = findAgentById;
exports.findAgentByApiKey = findAgentByApiKey;
exports.saveAgent = saveAgent;
exports.readJobs = readJobs;
exports.writeJobs = writeJobs;
exports.findJobById = findJobById;
exports.findJobsByAgentId = findJobsByAgentId;
exports.saveJob = saveJob;
exports.updateJobStatus = updateJobStatus;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// -------------------------------------------------------------------
// Database initialisation
// -------------------------------------------------------------------
const DATA_DIR = path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'asp.db');
const db = new better_sqlite3_1.default(DB_PATH);
// WAL mode gives better concurrent read performance and avoids
// write contention between background handler callbacks.
db.pragma('journal_mode = WAL');
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
`);
// -------------------------------------------------------------------
// One-time JSON migration
// Imports legacy flat-file data on first run then archives the files
// so subsequent restarts are not slowed by re-importing stale data.
// -------------------------------------------------------------------
const AGENTS_JSON = path.join(DATA_DIR, 'agents.json');
const JOBS_JSON = path.join(DATA_DIR, 'jobs.json');
function migrateFromJson() {
    // Agents
    if (fs.existsSync(AGENTS_JSON)) {
        try {
            const raw = fs.readFileSync(AGENTS_JSON, 'utf-8');
            const agents = JSON.parse(raw);
            const insert = db.prepare(`
        INSERT OR IGNORE INTO agents
          (agentId, name, address, apiKey, encryptedPrivateKey, createdAt)
        VALUES
          (@agentId, @name, @address, @apiKey, @encryptedPrivateKey, @createdAt)
      `);
            const importAll = db.transaction((rows) => {
                for (const row of rows)
                    insert.run(row);
            });
            importAll(agents);
            fs.renameSync(AGENTS_JSON, AGENTS_JSON + '.bak');
            console.log(`[storage] Migrated ${agents.length} agent(s) from agents.json → SQLite`);
        }
        catch (err) {
            console.warn('[storage] Failed to migrate agents.json:', err);
        }
    }
    // Jobs
    if (fs.existsSync(JOBS_JSON)) {
        try {
            const raw = fs.readFileSync(JOBS_JSON, 'utf-8');
            const jobs = JSON.parse(raw);
            const insert = db.prepare(`
        INSERT OR IGNORE INTO jobs
          (jobId, agentId, txHash, status, providerAddress, budget, deadlineMinutes, createdAt, updatedAt)
        VALUES
          (@jobId, @agentId, @txHash, @status, @providerAddress, @budget, @deadlineMinutes, @createdAt, @updatedAt)
      `);
            const importAll = db.transaction((rows) => {
                for (const row of rows)
                    insert.run(row);
            });
            importAll(jobs);
            fs.renameSync(JOBS_JSON, JOBS_JSON + '.bak');
            console.log(`[storage] Migrated ${jobs.length} job(s) from jobs.json → SQLite`);
        }
        catch (err) {
            console.warn('[storage] Failed to migrate jobs.json:', err);
        }
    }
}
migrateFromJson();
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
    INSERT INTO jobs (jobId, agentId, txHash, status, providerAddress, budget, deadlineMinutes, createdAt, updatedAt)
    VALUES (@jobId, @agentId, @txHash, @status, @providerAddress, @budget, @deadlineMinutes, @createdAt, @updatedAt)
  `),
    selectAllJobs: db.prepare('SELECT * FROM jobs'),
    selectJobById: db.prepare('SELECT * FROM jobs WHERE jobId = ?'),
    selectJobsByAgentId: db.prepare('SELECT * FROM jobs WHERE agentId = ?'),
    updateJobStatus: db.prepare(`
    UPDATE jobs SET status = @status, updatedAt = @updatedAt, txHash = COALESCE(@txHash, txHash)
    WHERE jobId = @jobId
  `),
};
// -------------------------------------------------------------------
// Agents
// -------------------------------------------------------------------
function readAgents() {
    return stmts.selectAllAgents.all();
}
// Kept for interface parity with the old flat-file API.
// Direct writes via writeAgents() are no longer the primary path —
// use saveAgent() instead, which is atomic via a prepared statement.
function writeAgents(_agents) {
    throw new Error('writeAgents() is not supported with SQLite storage — use saveAgent() directly');
}
function findAgentById(agentId) {
    return stmts.selectAgentById.get(agentId);
}
function findAgentByApiKey(apiKey) {
    return stmts.selectAgentByApiKey.get(apiKey);
}
function saveAgent(agent) {
    stmts.insertAgent.run(agent);
}
// -------------------------------------------------------------------
// Jobs
// -------------------------------------------------------------------
function readJobs() {
    return stmts.selectAllJobs.all();
}
// Kept for interface parity. Same caveat as writeAgents().
function writeJobs(_jobs) {
    throw new Error('writeJobs() is not supported with SQLite storage — use saveJob() directly');
}
function findJobById(jobId) {
    const row = stmts.selectJobById.get(jobId);
    if (!row)
        return undefined;
    // SQLite stores integers as numbers — normalise deadlineMinutes back to number
    return { ...row, deadlineMinutes: Number(row.deadlineMinutes) };
}
function findJobsByAgentId(agentId) {
    const rows = stmts.selectJobsByAgentId.all(agentId);
    return rows.map((r) => ({ ...r, deadlineMinutes: Number(r.deadlineMinutes) }));
}
function saveJob(job) {
    stmts.insertJob.run(job);
}
function updateJobStatus(jobId, status, txHash) {
    const result = stmts.updateJobStatus.run({
        jobId,
        status,
        updatedAt: new Date().toISOString(),
        txHash: txHash ?? null,
    });
    if (result.changes === 0)
        throw new Error(`Job ${jobId} not found in storage`);
}
//# sourceMappingURL=storage.js.map