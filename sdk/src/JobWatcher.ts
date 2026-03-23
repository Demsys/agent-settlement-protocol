import { EventEmitter } from 'events'
import type { JobStatus, JobRecord } from './types'
import { ApiError, JobNotFoundError } from './errors'

// ---------------------------------------------------------------------------
// Terminal states — polling stops automatically when one of these is reached.
// ---------------------------------------------------------------------------
const TERMINAL_STATES = new Set<JobStatus>(['completed', 'rejected', 'expired'])

// ---------------------------------------------------------------------------
// JobWatcher
//
// Polls GET /v1/jobs/:id at a fixed interval and emits typed events as the
// job progresses. Callers never need to manage the interval themselves —
// just call stop() if they want to cancel early, or listen for a terminal
// event to know it has stopped on its own.
//
// Usage:
//   const watcher = client.watchJob('42')
//   watcher.on('update', (status) => console.log('now:', status))
//   watcher.on('completed', () => console.log('done!'))
//   watcher.on('error', (err) => console.error(err))
// ---------------------------------------------------------------------------

/** Typed events emitted by JobWatcher. */
export interface JobWatcherEvents {
  /**
   * Emitted on every poll that returns a different status than the previous one.
   * Also emitted once immediately after the first successful poll.
   */
  update: [status: JobStatus, job: JobRecord]
  /** Job has been evaluated and payment released to the provider. */
  completed: [job: JobRecord]
  /** Job has been rejected by the evaluator. */
  rejected: [job: JobRecord]
  /** Job deadline passed without a submission or evaluation. */
  expired: [job: JobRecord]
  /** Any error that occurs during polling (network, API, etc.). */
  error: [error: Error]
}

export class JobWatcher extends EventEmitter {
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private lastKnownStatus: JobStatus | null = null
  private stopped = false

  /**
   * @param jobId - The job ID to watch.
   * @param fetchJob - Async function that fetches the current job state.
   *   Injected by AgentClient so JobWatcher has no HTTP knowledge.
   * @param intervalMs - Polling interval in milliseconds. Default 3 000.
   */
  constructor(
    public readonly jobId: string,
    private readonly fetchJob: (jobId: string) => Promise<JobRecord>,
    private readonly intervalMs: number = 3_000,
  ) {
    super()
    // Start polling on the next tick so callers have time to attach listeners
    // before the first event fires.
    setImmediate(() => this.poll())
    this.intervalHandle = setInterval(() => this.poll(), this.intervalMs)
  }

  /** Stop polling. Safe to call multiple times. */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
  }

  // Override typed EventEmitter methods so callers get autocomplete on event names.
  on<K extends keyof JobWatcherEvents>(
    event: K,
    listener: (...args: JobWatcherEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void)
  }

  once<K extends keyof JobWatcherEvents>(
    event: K,
    listener: (...args: JobWatcherEvents[K]) => void,
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async poll(): Promise<void> {
    // Guard against a race where the interval fires after stop() was called
    // (possible if the event loop already queued the callback).
    if (this.stopped) return

    let job: JobRecord
    try {
      job = await this.fetchJob(this.jobId)
    } catch (err) {
      // Translate 404 into a specific error to make it easy to distinguish
      // "job doesn't exist" from transient network failures.
      if (err instanceof ApiError && err.status === 404) {
        this.emit('error', new JobNotFoundError(this.jobId))
      } else {
        this.emit('error', err instanceof Error ? err : new Error(String(err)))
      }
      // Do not stop on transient errors — the caller decides whether to stop.
      return
    }

    const { status } = job

    // Emit 'update' on first poll or whenever the status changes.
    if (status !== this.lastKnownStatus) {
      this.lastKnownStatus = status
      this.emit('update', status, job)

      // Also emit the specific terminal event so callers can use a simpler API:
      //   watcher.on('completed', handler)  instead of
      //   watcher.on('update', (s, j) => { if (s === 'completed') handler(j) })
      if (status === 'completed') this.emit('completed', job)
      if (status === 'rejected') this.emit('rejected', job)
      if (status === 'expired') this.emit('expired', job)
    }

    if (TERMINAL_STATES.has(status)) {
      this.stop()
    }
  }
}
