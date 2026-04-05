import { EventEmitter } from 'events'
import type { JobRecord } from './types'

/**
 * AssignmentWatcher polls GET /v1/evaluator/:address/jobs and emits typed
 * events when jobs are assigned to the given evaluator address or transition
 * to the `submitted` state (signalling the evaluator should act).
 *
 * Events:
 *   'assigned'  – a newly funded job is assigned to this evaluator
 *                 payload: JobRecord (status: 'funded')
 *   'submitted' – an assigned job's deliverable is ready for evaluation
 *                 payload: JobRecord (status: 'submitted')
 *   'completed' – job completed
 *   'rejected'  – job rejected
 *   'expired'   – job expired
 *   'error'     – polling error; watcher continues unless stop() is called
 */
export class AssignmentWatcher extends EventEmitter {
  private readonly evaluatorAddress: string
  private readonly baseUrl: string
  private readonly intervalMs: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private knownJobs = new Map<string, string>() // jobId → last known status

  constructor(evaluatorAddress: string, baseUrl: string, intervalMs = 5_000) {
    super()
    this.evaluatorAddress = evaluatorAddress
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.intervalMs = intervalMs
    this.scheduleNext()
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => this.poll(), this.intervalMs)
  }

  private async poll(): Promise<void> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v1/evaluator/${this.evaluatorAddress}/jobs`,
      )
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const { jobs } = (await response.json()) as { jobs: JobRecord[] }

      for (const job of jobs) {
        const prev = this.knownJobs.get(job.jobId)
        this.knownJobs.set(job.jobId, job.status)

        if (prev === job.status) continue // no change

        if (job.status === 'funded' && prev === undefined) {
          // First time we see this job — it's a new assignment
          this.emit('assigned', job)
        } else if (job.status === 'submitted') {
          this.emit('submitted', job)
        } else if (job.status === 'completed') {
          this.emit('completed', job)
        } else if (job.status === 'rejected') {
          this.emit('rejected', job)
        } else if (job.status === 'expired') {
          this.emit('expired', job)
        }
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    } finally {
      if (this.timer !== null) this.scheduleNext()
    }
  }
}
