#!/usr/bin/env npx ts-node
/**
 * Forum Watcher Agent — ERC-8183 Thread Monitor
 *
 * Two modes:
 *   Default  : reads new posts, displays them — zero Claude API calls
 *   --analyze: adds Claude analysis (priority, action) — costs tokens
 *
 * Usage:
 *   npm run agent:forum                      # lecture seule, gratuit
 *   npm run agent:forum -- --analyze         # + analyse Claude
 *   npm run agent:forum -- --analyze --from=280  # reanalyse depuis #280
 */

import * as fs from 'fs'
import * as path from 'path'

// ─── Config ───────────────────────────────────────────────────────────────────

const TOPIC_SLUG = 'erc-8183-agentic-commerce'
const TOPIC_ID   = 27902
const OUR_HANDLE = 'Bakugo32'
const STATE_FILE = path.join(__dirname, 'state/forum-state.json')
const BASE_URL   = `https://ethereum-magicians.org/t/${TOPIC_SLUG}/${TOPIC_ID}`

// Known participants — auto-elevated to 🟡 without Claude
const KEY_PARTICIPANTS = new Set([
  'TMerlini', 'mike-diamond', 'mrocker', 'ThoughtProof',
  'pablocactus', 'nftprof', 'cmayorga', 'JackyWang', 'MeltedMindz',
  'davidecrapis.eth', 'clawplaza', 'miratisu', 'mlegls',
])

// ─── Types ────────────────────────────────────────────────────────────────────

interface ForumState {
  lastSeenPostNumber: number
  lastChecked: string
}

interface DiscoursePost {
  id:                    number
  post_number:           number
  username:              string
  created_at:            string
  cooked:                string
  raw?:                  string
  reply_to_post_number?: number
}

interface PostSummary {
  postNumber:  number
  username:    string
  date:        string
  preview:     string
  priority:    'high' | 'medium' | 'low'
  replyTo?:    number
}

interface PostAnalysis extends PostSummary {
  summary:         string
  needsReply:      'high' | 'medium' | 'none'
  reason:          string
  suggestedAction: string
}

// ─── State ────────────────────────────────────────────────────────────────────

function loadState(): ForumState {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
  }
  return { lastSeenPostNumber: 284, lastChecked: new Date().toISOString() }
}

function saveState(state: ForumState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// ─── Forum API ────────────────────────────────────────────────────────────────

async function fetchTopicMeta(): Promise<{ highest_post_number: number }> {
  const res = await fetch(`${BASE_URL}.json`)
  if (!res.ok) throw new Error(`Forum API ${res.status}`)
  return res.json()
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/\s+/g, ' ')
    .trim()
}

async function fetchPostsFrom(from: number, to: number): Promise<DiscoursePost[]> {
  const posts: DiscoursePost[] = []
  for (let n = from; n <= to; n++) {
    const res = await fetch(`${BASE_URL}/${n}.json`)
    if (!res.ok) continue
    const data: any = await res.json()
    const raw = data?.post_stream?.posts ?? []
    const post = raw.find((p: DiscoursePost) => p.post_number === n)
    if (post) posts.push(post)
    await new Promise(r => setTimeout(r, 250))
  }
  return posts
}

// ─── Rule-based priority (no Claude) ─────────────────────────────────────────

function classifyPost(post: DiscoursePost): PostSummary {
  const text    = post.raw ?? stripHtml(post.cooked)
  const preview = text.slice(0, 320).replace(/\n+/g, ' ').trim()
  const date    = new Date(post.created_at).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  })

  // Priority rules — no API cost
  let priority: 'high' | 'medium' | 'low' = 'low'

  const mentionsUs = text.toLowerCase().includes(OUR_HANDLE.toLowerCase())
  if (mentionsUs) priority = 'high'
  else if (KEY_PARTICIPANTS.has(post.username)) priority = 'medium'

  return {
    postNumber: post.post_number,
    username:   post.username,
    date,
    preview,
    priority,
    replyTo:    post.reply_to_post_number,
  }
}

// ─── Claude analysis (opt-in) ─────────────────────────────────────────────────

async function analyzePosts(posts: DiscoursePost[]): Promise<PostAnalysis[]> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const apiKey    = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in .env')

  const client = new Anthropic({ apiKey })

  const postsText = posts.map(p => {
    const content  = p.raw ?? stripHtml(p.cooked)
    const replyInfo = p.reply_to_post_number ? ` (reply to #${p.reply_to_post_number})` : ''
    return `--- Post #${p.post_number} by @${p.username}${replyInfo} ---\n${content}`
  }).join('\n\n')

  const system = `You are the assistant for Bakugo32, author of ERC-8183 (Agentic Commerce).
Context: ERC-8183 = trustless job marketplace for AI agents (fund→submit→evaluate→settle).
Key participants: TMerlini (Ensub, production L4 attestation), mike-diamond (ERC-8265 author), mrocker (CardZero, mainnet), ThoughtProof (PLV evaluator), pablocactus (AHM/RNWY).
Open threads: §B.x spec text integration (ERC-8183 absorbs outcome envelope mapping), commitmentRef semantics, IAttestationVerifier overload.

For each post output JSON:
[{"postNumber":number,"username":string,"summary":"1 sentence","needsReply":"high"|"medium"|"none","reason":"1 sentence","suggestedAction":"what to do"}]
needsReply=high: direct question, spec decision needed. medium: worth acknowledging. none: no action.
Return only the JSON array.`

  const res = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: `Analyze:\n\n${postsText}` }]
  })

  const text    = res.content[0].type === 'text' ? res.content[0].text : ''
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

  let analyses: any[]
  try { analyses = JSON.parse(cleaned) }
  catch { analyses = [] }

  return posts.map(post => {
    const base  = classifyPost(post)
    const found = analyses.find((a: any) => a.postNumber === post.post_number)
    return {
      ...base,
      summary:         found?.summary         ?? base.preview.slice(0, 100),
      needsReply:      found?.needsReply       ?? 'medium',
      reason:          found?.reason           ?? '',
      suggestedAction: found?.suggestedAction  ?? 'Review manually',
    }
  })
}

// ─── Output ───────────────────────────────────────────────────────────────────

const ICON: Record<string, string> = { high: '🔴', medium: '🟡', low: '⚪' }
const REPLY_ICON: Record<string, string> = { high: '🔴', medium: '🟡', none: '⚪' }

function printSummaries(summaries: PostSummary[]): void {
  const high   = summaries.filter(s => s.priority === 'high')
  const medium = summaries.filter(s => s.priority === 'medium')
  const low    = summaries.filter(s => s.priority === 'low')

  console.log()
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║          ERC-8183 Forum Watcher — Nouveaux posts             ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')

  if (summaries.length === 0) {
    console.log('\n  Aucun nouveau post externe.\n')
    return
  }

  for (const group of [high, medium, low]) {
    if (group.length === 0) continue
    console.log()
    for (const s of group) {
      const reply = s.replyTo ? ` ↩ #${s.replyTo}` : ''
      console.log(`  ${ICON[s.priority]} #${s.postNumber} @${s.username}${reply}  [${s.date}]`)
      console.log(`     ${s.preview.slice(0, 280)}${s.preview.length > 280 ? '…' : ''}`)
      console.log(`     🔗 ${BASE_URL}/${s.postNumber}`)
      console.log()
    }
  }

  console.log(`  ─── ${high.length} 🔴  ${medium.length} 🟡  ${low.length} ⚪  (${summaries.length} total)`)
  if (high.length > 0 || medium.length > 0) {
    console.log(`  Relance avec --analyze pour l'analyse Claude.`)
  }
  console.log()
}

function printAnalyses(analyses: PostAnalysis[]): void {
  const needsAction = analyses.filter(a => a.needsReply !== 'none')
  const noAction    = analyses.filter(a => a.needsReply === 'none')

  console.log()
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║          ERC-8183 Forum Watcher — Analyse Claude             ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')

  if (needsAction.length > 0) {
    console.log(`\n  ── À traiter (${needsAction.length}) ────────────────────────────────────\n`)
    for (const a of needsAction) {
      console.log(`  ${REPLY_ICON[a.needsReply]} #${a.postNumber} @${a.username}`)
      console.log(`     Résumé  : ${a.summary}`)
      console.log(`     Raison  : ${a.reason}`)
      console.log(`     Action  : ${a.suggestedAction}`)
      console.log(`     Lien    : ${BASE_URL}/${a.postNumber}`)
      console.log()
    }
  }

  if (noAction.length > 0) {
    console.log(`  ── Pas d'action (${noAction.length}) ─────────────────────────────────────`)
    for (const a of noAction) {
      console.log(`  ⚪ #${a.postNumber} @${a.username}: ${a.summary}`)
    }
    console.log()
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args    = process.argv.slice(2)
  const analyze = args.includes('--analyze')
  const fromArg = args.find(a => a.startsWith('--from='))
  const fromOverride = fromArg ? parseInt(fromArg.split('=')[1]) : undefined

  const state   = loadState()
  const fromNum = (fromOverride ?? state.lastSeenPostNumber) + 1

  console.log(`[forum-watcher] Dernier vu : #${state.lastSeenPostNumber}  (${state.lastChecked})`)

  const meta    = await fetchTopicMeta()
  const highest = meta.highest_post_number

  console.log(`[forum-watcher] Dernier sur le forum : #${highest}`)

  if (highest < fromNum) {
    console.log('[forum-watcher] Aucun nouveau post.')
    return
  }

  console.log(`[forum-watcher] Fetch #${fromNum} → #${highest}...`)
  const posts = await fetchPostsFrom(fromNum, highest)

  // Filter our own posts
  const external = posts.filter(p => p.username !== OUR_HANDLE)
  console.log(`[forum-watcher] ${posts.length} post(s) dont ${external.length} externe(s).`)

  if (external.length === 0) {
    console.log('[forum-watcher] Que nos propres posts — rien à signaler.')
  } else if (analyze) {
    console.log('[forum-watcher] Analyse Claude en cours...')
    const analyses = await analyzePosts(external)
    printAnalyses(analyses)
  } else {
    const summaries = external.map(classifyPost)
    printSummaries(summaries)
  }

  // Only advance state if not using --from override (avoid losing position)
  if (!fromOverride) {
    saveState({ lastSeenPostNumber: highest, lastChecked: new Date().toISOString() })
    console.log(`[forum-watcher] État mis à jour → #${highest}`)
  }
}

main().catch(err => {
  console.error('[forum-watcher] Erreur :', err.message)
  process.exit(1)
})
