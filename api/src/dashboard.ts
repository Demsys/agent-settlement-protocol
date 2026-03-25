/**
 * Returns the self-contained HTML for the monitoring dashboard.
 * apiBase is injected at render time so the fetch() calls point to the
 * correct host regardless of the environment.
 */
export function getDashboardHtml(apiBase: string): string {
  const basescan = 'https://sepolia.basescan.org/address'

  return /* html */ `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ASP — Dashboard</title>
  <style>
    :root {
      --bg:        #0b0f1a;
      --card:      #131929;
      --border:    #1e2d45;
      --text:      #e2e8f0;
      --muted:     #64748b;
      --accent:    #3b82f6;
      --green:     #22c55e;
      --yellow:    #eab308;
      --red:       #ef4444;
      --purple:    #a855f7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 14px;
      min-height: 100vh;
    }

    /* ── Header ───────────────────────────────────────────── */
    header {
      padding: 18px 28px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    .logo { display: flex; align-items: center; gap: 10px; }
    .logo-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 8px var(--accent);
    }
    .logo h1 { font-size: 16px; font-weight: 600; letter-spacing: .02em; }
    .logo p  { font-size: 12px; color: var(--muted); }
    .header-right { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .badge {
      padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;
      background: rgba(59,130,246,.15); color: var(--accent); border: 1px solid rgba(59,130,246,.3);
    }
    .refresh-info { font-size: 12px; color: var(--muted); }
    #countdown { color: var(--text); font-weight: 600; }

    /* ── Main layout ─────────────────────────────────────── */
    main { padding: 24px 28px; display: flex; flex-direction: column; gap: 24px; }

    /* ── Stat cards ──────────────────────────────────────── */
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 18px 20px;
    }
    .card-label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 8px; }
    .card-value { font-size: 30px; font-weight: 700; line-height: 1; }
    .card-sub   { font-size: 12px; color: var(--muted); margin-top: 6px; }
    .accent  { color: var(--accent); }
    .green   { color: var(--green); }
    .yellow  { color: var(--yellow); }
    .purple  { color: var(--purple); }

    /* ── Section title ───────────────────────────────────── */
    .section { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 20px 24px; }
    .section-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 16px; }

    /* ── Status bars ─────────────────────────────────────── */
    .status-grid { display: flex; flex-direction: column; gap: 10px; }
    .status-row  { display: flex; align-items: center; gap: 12px; }
    .status-label { width: 80px; font-size: 12px; color: var(--muted); flex-shrink: 0; }
    .bar-wrap { flex: 1; background: rgba(255,255,255,.06); border-radius: 4px; height: 8px; overflow: hidden; }
    .bar      { height: 100%; border-radius: 4px; transition: width .4s ease; min-width: 2px; }
    .bar.open      { background: var(--yellow); }
    .bar.funded    { background: var(--accent); }
    .bar.submitted { background: var(--purple); }
    .bar.completed { background: var(--green); }
    .bar.rejected  { background: var(--red); }
    .bar.expired   { background: var(--muted); }
    .status-count  { width: 28px; text-align: right; font-size: 12px; font-weight: 600; }

    /* ── Contracts table ─────────────────────────────────── */
    .contracts-table { width: 100%; border-collapse: collapse; }
    .contracts-table td { padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12px; vertical-align: middle; }
    .contracts-table tr:last-child td { border-bottom: none; }
    .contract-name { color: var(--muted); width: 160px; }
    .contract-addr { font-family: monospace; color: var(--text); }
    .contract-link {
      padding: 3px 8px; border-radius: 5px; font-size: 11px; font-weight: 600;
      background: rgba(59,130,246,.12); color: var(--accent);
      text-decoration: none; border: 1px solid rgba(59,130,246,.25);
      transition: background .15s;
    }
    .contract-link:hover { background: rgba(59,130,246,.25); }

    /* ── Two-column layout ───────────────────────────────── */
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 700px) { .two-col { grid-template-columns: 1fr; } }

    /* ── Protocol config ─────────────────────────────────── */
    .config-list { display: flex; flex-direction: column; gap: 10px; }
    .config-row  { display: flex; justify-content: space-between; font-size: 13px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    .config-row:last-child { border-bottom: none; padding-bottom: 0; }
    .config-key   { color: var(--muted); }
    .config-value { font-weight: 600; }

    /* ── Error banner ────────────────────────────────────── */
    #error-banner {
      display: none;
      background: rgba(239,68,68,.12);
      border: 1px solid rgba(239,68,68,.3);
      color: var(--red);
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 12px;
    }

    /* ── Footer ──────────────────────────────────────────── */
    footer {
      text-align: center;
      padding: 16px;
      font-size: 11px;
      color: var(--muted);
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>

<header>
  <div class="logo">
    <div class="logo-dot"></div>
    <div>
      <h1>Agent Settlement Protocol</h1>
      <p>Supervision infrastructure — ERC-8183</p>
    </div>
  </div>
  <div class="header-right">
    <span class="badge" id="network-badge">base-sepolia</span>
    <span class="refresh-info">Mise à jour dans <span id="countdown">30</span>s — <span id="generated-at">—</span></span>
  </div>
</header>

<main>

  <div id="error-banner"></div>

  <!-- Stat cards -->
  <div class="cards">
    <div class="card">
      <div class="card-label">Jobs total</div>
      <div class="card-value accent" id="stat-total-jobs">—</div>
      <div class="card-sub" id="stat-total-budget">— USDC engagé</div>
    </div>
    <div class="card">
      <div class="card-label">Complétés</div>
      <div class="card-value green" id="stat-completed">—</div>
      <div class="card-sub" id="stat-completion-rate">taux de succès</div>
    </div>
    <div class="card">
      <div class="card-label">En cours</div>
      <div class="card-value yellow" id="stat-active">—</div>
      <div class="card-sub">open + funded + submitted</div>
    </div>
    <div class="card">
      <div class="card-label">Agents</div>
      <div class="card-value accent" id="stat-agents">—</div>
      <div class="card-sub">wallets managés</div>
    </div>
    <div class="card">
      <div class="card-label">Évaluateurs</div>
      <div class="card-value purple" id="stat-evaluators">—</div>
      <div class="card-sub">actifs on-chain</div>
    </div>
    <div class="card">
      <div class="card-label">Fee protocole</div>
      <div class="card-value accent" id="stat-fee">—</div>
      <div class="card-sub">par job complété</div>
    </div>
  </div>

  <!-- Status bars -->
  <div class="section">
    <div class="section-title">Répartition des jobs par statut</div>
    <div class="status-grid" id="status-grid">
      <!-- generated by JS -->
    </div>
  </div>

  <!-- Contracts + Config -->
  <div class="two-col">

    <div class="section">
      <div class="section-title">Contrats déployés (Base Sepolia)</div>
      <table class="contracts-table" id="contracts-table">
        <!-- generated by JS -->
      </table>
    </div>

    <div class="section">
      <div class="section-title">Configuration protocole</div>
      <div class="config-list" id="config-list">
        <!-- generated by JS -->
      </div>
    </div>

  </div>

</main>

<footer>
  Agent Settlement Protocol · Base Sepolia (chainId 84532) · BUSL-1.1
</footer>

<script>
  const API_BASE = '${apiBase}'
  const BASESCAN  = '${basescan}'
  const STATUSES  = ['open','funded','submitted','completed','rejected','expired']
  const STATUS_LABELS = {
    open:'Open', funded:'Funded', submitted:'Submitted',
    completed:'Completed', rejected:'Rejected', expired:'Expired'
  }

  const SHORT_NAMES = {
    agentJobManager:   'AgentJobManager',
    evaluatorRegistry: 'EvaluatorRegistry',
    reputationBridge:  'ReputationBridge',
    protocolToken:     'ProtocolToken (VRT)',
    mockUsdc:          'MockUSDC',
  }

  function shortAddr(addr) {
    return addr.slice(0, 6) + '…' + addr.slice(-4)
  }

  function setText(id, val) {
    const el = document.getElementById(id)
    if (el) el.textContent = val
  }

  function render(d) {
    const p = d.protocol
    const j = d.jobs

    // Header
    setText('network-badge', p.network)
    setText('generated-at', new Date(d.generatedAt).toLocaleTimeString('fr-FR'))

    // Stat cards
    setText('stat-total-jobs',    j.total)
    setText('stat-total-budget',  j.totalBudgetUsdc + ' USDC engagé')
    setText('stat-completed',     j.byStatus.completed ?? 0)
    setText('stat-completion-rate', j.completionRate + ' taux de succès')
    const active = (j.byStatus.open ?? 0) + (j.byStatus.funded ?? 0) + (j.byStatus.submitted ?? 0)
    setText('stat-active',     active)
    setText('stat-agents',     d.agents.total)
    setText('stat-evaluators', p.evaluatorCount)
    setText('stat-fee',        p.feeRatePercent)

    // Status bars
    const total = j.total || 1
    const grid = document.getElementById('status-grid')
    grid.innerHTML = STATUSES.map(s => {
      const count = j.byStatus[s] ?? 0
      const pct   = Math.max((count / total) * 100, count > 0 ? 1 : 0)
      return \`<div class="status-row">
        <span class="status-label">\${STATUS_LABELS[s]}</span>
        <div class="bar-wrap"><div class="bar \${s}" style="width:\${pct}%"></div></div>
        <span class="status-count">\${count}</span>
      </div>\`
    }).join('')

    // Contracts table
    const tbl = document.getElementById('contracts-table')
    tbl.innerHTML = Object.entries(p.contracts).map(([key, addr]) =>
      \`<tr>
        <td class="contract-name">\${SHORT_NAMES[key] ?? key}</td>
        <td class="contract-addr">\${shortAddr(addr)}</td>
        <td style="text-align:right">
          <a class="contract-link" href="\${BASESCAN}/\${addr}#readContract" target="_blank">Basescan ↗</a>
        </td>
      </tr>\`
    ).join('')

    // Config list
    const cfg = document.getElementById('config-list')
    cfg.innerHTML = [
      ['Réseau',       p.network],
      ['Chain ID',     p.chainId],
      ['Fee rate',     p.feeRatePercent + ' (' + p.feeRateBps + ' bps)'],
      ['Évaluateurs',  p.evaluatorCount + ' actif(s)'],
      ['Jobs total',   j.total + ' (API)'],
    ].map(([k,v]) =>
      \`<div class="config-row"><span class="config-key">\${k}</span><span class="config-value">\${v}</span></div>\`
    ).join('')
  }

  function showError(msg) {
    const el = document.getElementById('error-banner')
    el.style.display = 'block'
    el.textContent = '⚠ ' + msg
  }
  function clearError() {
    document.getElementById('error-banner').style.display = 'none'
  }

  async function refresh() {
    try {
      const r = await fetch(API_BASE + '/v1/stats')
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const d = await r.json()
      render(d)
      clearError()
    } catch(e) {
      showError('Impossible de joindre l\\'API : ' + e.message)
    }
    countdown = 30
  }

  let countdown = 30
  setInterval(() => {
    setText('countdown', countdown)
    if (--countdown < 0) refresh()
  }, 1000)

  refresh()
</script>
</body>
</html>`
}
