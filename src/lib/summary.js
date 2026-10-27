// The summary: facts over the two state files, as plain objects a test can
// assert whole. Nothing here reads a file; the CLI feeds the records in.
//
// Definitions the numbers rest on. A turn is a reply event whose outcome
// is pass or standdown; a block line is an attempt and is counted apart.
// The prompt counter resets on compaction and /clear, so no count ever
// comes from a prompt index. A rejection is a record in rejections.jsonl,
// which exists even when the events log is off; restate events are a
// cross-check. The rejected reply is the turn at the record's prompt index
// minus one in the same session, and a record that joins to no turn is
// counted as unjoined. Every rate counts only the rejections that join
// to a turn inside the window, so a rejection from a session the events
// log never saw, or one whose rejected turn precedes the window, shows in
// the raw counts and in no rate. Unlinted (alerts null) is its own
// category and never counts as clean or as fixed. A rate prints only
// when its denominator exists in the window. A reply's mode is the
// session snapshot in force when the reply happened, pre-window
// snapshots included.
const FINAL = new Set(['pass', 'standdown']);
const BUCKETS = [
  ['0', (n) => n === 0],
  ['1-2', (n) => n >= 1 && n <= 2],
  ['3-5', (n) => n >= 3 && n <= 5],
  ['6-10', (n) => n >= 6 && n <= 10],
  ['11+', (n) => n >= 11]
];
const TOP = 15;
const FREQUENT = 20;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// A rejection record carries its time in its id prefix.
export function recordTime(record) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/.exec(String(record?.id ?? ''));
  return m ? m[1] : null;
}

function inWindow(t, since, until) {
  if (!t) return false;
  if (since && t < since) return false;
  if (until && t > until) return false;
  return true;
}

function rate(num, den) {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : null;
}

function hasError(alerts) {
  return Array.isArray(alerts) && alerts.some((a) => a.severity === 'error');
}

function bump(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function sortedEntries(map, limit = Infinity) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit);
}

function weekStart(t) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/**
 * Summarize events and rejection records. `since` and `until` are ISO
 * strings; `project` filters both kinds by exact project path.
 */
export function summarize(events, rejections, { since = null, until = null, project = null } = {}) {
  const scoped = (events ?? []).filter((e) => e.t && (!project || e.project === project));
  const ev = scoped.filter((e) => inWindow(e.t, since, until));
  const rec = (rejections ?? [])
    .map((r) => ({ ...r, t: recordTime(r) }))
    .filter((r) => inWindow(r.t, since, until) && (!project || r.project === project));

  const replies = ev.filter((e) => e.e === 'reply');
  const turns = replies.filter((e) => FINAL.has(e.outcome));
  const attempts = replies.filter((e) => e.outcome === 'block');
  const linted = turns.filter((e) => Array.isArray(e.alerts));
  const unlinted = turns.filter((e) => !Array.isArray(e.alerts));

  // Window.
  const times = [...ev.map((e) => e.t), ...rec.map((r) => r.t)].filter(Boolean).sort();
  const sessions = new Set([...ev.map((e) => e.session), ...rec.map((r) => r.session)].filter(Boolean));
  const projects = new Map();
  for (const e of ev) if (e.project) bump(projects, e.project, 0);
  for (const r of rec) if (r.project) bump(projects, r.project, 0);
  const versions = new Set([...ev.map((e) => e.v), ...rec.map((r) => r.version)].filter(Boolean));

  // Reply mode per reply: the latest session snapshot of that session at
  // or before the reply, window or not, so a compaction that changed the
  // mode mid-session is attributed from that point on.
  const snapshots = new Map();
  for (const e of scoped) {
    if (e.e !== 'session') continue;
    const list = snapshots.get(e.session) ?? [];
    list.push(e);
    snapshots.set(e.session, list);
  }
  for (const list of snapshots.values()) list.sort((a, b) => a.t.localeCompare(b.t));
  const modeOf = (reply) => {
    let mode = 'unknown';
    for (const snap of snapshots.get(reply.session) ?? []) {
      if (snap.t <= reply.t) mode = snap.config?.reply?.mode ?? 'unknown';
      else break;
    }
    return mode;
  };

  // Join each rejection to the turn it rejected: the turn at the record's
  // prompt index minus one in the same session, inside the window. The
  // joined turn supplies the time, project, and distance a rate uses.
  const turnByKey = new Map(turns.map((t) => [`${t.session}|${t.promptIndex}`, t]));
  const joinedRec = rec
    .map((r) => ({ record: r, turn: turnByKey.get(`${r.session}|${(r.promptIndex ?? 0) - 1}`) ?? null }))
    .filter((x) => x.turn !== null);
  const joined = joinedRec.length;

  // Rejection rate, overall, per project, per week.
  const turnsByProject = new Map();
  for (const t of turns) bump(turnsByProject, t.project ?? '(none)');
  const recByProject = new Map();
  for (const { turn } of joinedRec) bump(recByProject, turn.project ?? '(none)');
  const rawByProject = new Map();
  for (const r of rec) bump(rawByProject, r.project ?? '(none)');
  const perProject = [...new Set([...turnsByProject.keys(), ...rawByProject.keys()])].sort().map((p) => ({
    project: p,
    turns: turnsByProject.get(p) ?? 0,
    rejections: rawByProject.get(p) ?? 0,
    joined: recByProject.get(p) ?? 0,
    per100: rate(recByProject.get(p) ?? 0, turnsByProject.get(p) ?? 0)
  }));
  let perWeek = null;
  if (times.length > 1 && Date.parse(times[times.length - 1]) - Date.parse(times[0]) >= 4 * WEEK_MS) {
    const tw = new Map();
    const rw = new Map();
    for (const t of turns) bump(tw, weekStart(t.t));
    for (const { turn } of joinedRec) bump(rw, weekStart(turn.t));
    perWeek = [...new Set([...tw.keys(), ...rw.keys()])].sort().map((w) => ({
      week: w,
      turns: tw.get(w) ?? 0,
      rejections: rw.get(w) ?? 0,
      per100: rate(rw.get(w) ?? 0, tw.get(w) ?? 0)
    }));
  }

  // Distance from the last injection, by the joined turn's own distance.
  const distance = BUCKETS.map(([label, test]) => {
    const t = turns.filter((x) => test(Number(x.sinceReminder ?? 0))).length;
    const rj = joinedRec.filter(({ turn }) => test(Number(turn.sinceReminder ?? 0))).length;
    return { bucket: label, turns: t, rejections: rj, per100: rate(rj, t) };
  });

  // Rules that fire on final replies, with terms and the mode in force.
  const ruleTurns = new Map();
  const ruleTerms = new Map();
  const ruleModes = new Map();
  for (const t of linted) {
    const seen = new Set();
    for (const a of t.alerts) {
      if (a.severity !== 'error' || seen.has(a.check)) continue;
      seen.add(a.check);
      bump(ruleTurns, a.check);
      const modes = ruleModes.get(a.check) ?? new Map();
      bump(modes, modeOf(t));
      ruleModes.set(a.check, modes);
    }
    for (const a of t.alerts) {
      if (a.severity !== 'error' || !a.match) continue;
      const terms = ruleTerms.get(a.check) ?? new Map();
      bump(terms, a.match, a.n ?? 1);
      ruleTerms.set(a.check, terms);
    }
  }
  const rulesFiring = sortedEntries(ruleTurns, TOP).map(([check, n]) => ({
    check,
    turns: n,
    share: rate(n, linted.length),
    terms: sortedEntries(ruleTerms.get(check) ?? new Map(), 3).map(([term, count]) => ({ term, count })),
    modes: Object.fromEntries(sortedEntries(ruleModes.get(check) ?? new Map()))
  }));

  // Rules on rejected replies.
  const rejLinted = rec.filter((r) => Array.isArray(r.rejected?.alerts));
  const rejUnlinted = rec.length - rejLinted.length;
  const rejRules = new Map(); // check → { error, warning, suggestion }
  for (const r of rejLinted) {
    const seen = new Set();
    for (const a of r.rejected.alerts) {
      const key = `${a.check}|${a.severity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = rejRules.get(a.check) ?? { error: 0, warning: 0, suggestion: 0 };
      row[a.severity] = (row[a.severity] ?? 0) + 1;
      rejRules.set(a.check, row);
    }
  }
  const rulesOnRejected = [...rejRules.entries()]
    .map(([check, row]) => ({ check, ...row, records: row.error + row.warning + row.suggestion }))
    .sort((a, b) => b.records - a.records || a.check.localeCompare(b.check));
  const clean = rejLinted.filter((r) => r.rejected.alerts.length === 0);
  const warningsOnly = rejLinted.filter((r) => r.rejected.alerts.length > 0 && !hasError(r.rejected.alerts));
  const warningsOnlyRules = new Map();
  for (const r of warningsOnly) for (const a of new Set(r.rejected.alerts.map((x) => x.check))) bump(warningsOnlyRules, a);

  // Rewrites.
  const withRewrite = rec.filter((r) => r.rewrite && typeof r.rewrite === 'object');
  const rewriteLinted = withRewrite.filter((r) => Array.isArray(r.rewrite.alerts));
  const surviving = new Map();
  for (const r of rewriteLinted) {
    if (!Array.isArray(r.rejected?.alerts)) continue;
    const before = new Set(r.rejected.alerts.filter((a) => a.severity === 'error').map((a) => a.check));
    for (const check of new Set(r.rewrite.alerts.filter((a) => a.severity === 'error').map((a) => a.check))) {
      if (before.has(check)) bump(surviving, check);
    }
  }
  const rewrites = {
    total: withRewrite.length,
    clean: rewriteLinted.filter((r) => !hasError(r.rewrite.alerts)).length,
    keptError: rewriteLinted.filter((r) => hasError(r.rewrite.alerts)).length,
    unlinted: withRewrite.length - rewriteLinted.length,
    surviving: sortedEntries(surviving, TOP).map(([check, count]) => ({ check, count }))
  };

  // Reasons.
  const reasonCounts = new Map();
  let noReason = 0;
  for (const r of rec) {
    const text = String(r.reason ?? '').trim().toLowerCase();
    if (text) bump(reasonCounts, text);
    else noReason++;
  }

  // Allows.
  const allowMap = new Map();
  for (const e of ev.filter((x) => x.e === 'allow')) {
    const row = allowMap.get(e.term) ?? { term: e.term, count: 0, added: 0, projects: new Set() };
    row.count++;
    if (e.added) row.added++;
    if (e.project) row.projects.add(e.project);
    allowMap.set(e.term, row);
  }
  const allows = [...allowMap.values()]
    .map((r) => ({ term: r.term, count: r.count, added: r.added, projects: [...r.projects].sort() }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));

  // Settings, grouped by the four fields the line prints, so snapshots
  // that differ only in a field added by a later version share a row.
  const settings = new Map();
  for (const e of ev) {
    if (e.e !== 'session') continue;
    const c = e.config ?? {};
    const key = JSON.stringify({
      files: { mode: c.files?.mode ?? null },
      publish: { mode: c.publish?.mode ?? null },
      reply: { mode: c.reply?.mode ?? null },
      rules: { onViolation: c.rules?.onViolation ?? null }
    });
    bump(settings, key);
  }
  const settingsRows = sortedEntries(settings).map(([config, n]) => ({ config: JSON.parse(config), sessions: n }));

  // Observations.
  const rejectedChecks = new Set(rejLinted.flatMap((r) => r.rejected.alerts.map((a) => a.check)));
  const frequentNeverRejected = rulesFiring.filter((r) => r.turns >= FREQUENT && !rejectedChecks.has(r.check));

  return {
    window: {
      from: times[0] ?? null,
      to: times[times.length - 1] ?? null,
      since,
      until,
      project,
      sessions: sessions.size,
      projects: [...projects.keys()].sort(),
      versions: [...versions].sort(),
      eventsPresent: ev.length > 0,
      rejectionsPresent: rec.length > 0
    },
    volume: {
      turns: turns.length,
      attempts: attempts.length,
      linted: linted.length,
      unlinted: unlinted.length,
      withError: linted.filter((t) => hasError(t.alerts)).length,
      rejections: rec.length,
      restateEvents: ev.filter((e) => e.e === 'restate').length,
      joined,
      unjoined: rec.length - joined,
      allows: ev.filter((e) => e.e === 'allow').length
    },
    rejectionRate: { per100: rate(joined, turns.length), joined, perProject, perWeek },
    distance,
    rulesFiring,
    rejected: {
      linted: rejLinted.length,
      unlinted: rejUnlinted,
      rules: rulesOnRejected,
      clean: { count: clean.length, reasons: clean.map((r) => r.reason ?? null) },
      warningsOnly: { count: warningsOnly.length, rules: sortedEntries(warningsOnlyRules).map(([check, count]) => ({ check, count })) }
    },
    rewrites,
    reasons: { given: sortedEntries(reasonCounts).map(([reason, count]) => ({ reason, count })), none: noReason },
    allows,
    settings: settingsRows,
    observations: { frequentNeverRejected: frequentNeverRejected.map((r) => ({ check: r.check, turns: r.turns, modes: r.modes })) }
  };
}

function pct(v) {
  return v === null ? 'rate unavailable' : `${v} per 100`;
}

export function formatSummary(s) {
  const L = [];
  const w = s.window;
  L.push('just-say-so summary');
  if (!w.eventsPresent && !w.rejectionsPresent) {
    L.push('', 'No records in the window. The events log and the rejections file are empty, missing, or outside the window.');
    return L.join('\n') + '\n';
  }
  L.push(`  window: ${w.from ?? '?'} to ${w.to ?? '?'}${w.since ? ` (since ${w.since})` : ''}${w.project ? ` · project ${w.project}` : ''}`);
  L.push(`  sessions ${w.sessions} · projects ${w.projects.length} · plugin ${w.versions.join(', ') || 'unknown'}`);
  if (!w.eventsPresent) L.push('  the events log holds nothing for this window, so every rate is unavailable');
  if (!w.rejectionsPresent) L.push('  no rejections in this window');

  const v = s.volume;
  L.push('', 'Volume');
  L.push(`  turns ${v.turns} (block attempts ${v.attempts}) · linted ${v.linted} · unlinted ${v.unlinted} · with an error ${v.withError}`);
  L.push(`  rejections ${v.rejections} (restate events ${v.restateEvents}; ${v.joined} join to a turn in the window, ${v.unjoined} do not and count in no rate) · allows ${v.allows}`);

  const r = s.rejectionRate;
  L.push('', 'Rejection rate');
  L.push(`  overall: ${r.joined} joined rejections over ${v.turns} turns, ${pct(r.per100)} turns`);
  for (const p of r.perProject) L.push(`  ${p.project}: ${p.joined} of ${p.turns} turns, ${pct(p.per100)}${p.rejections > p.joined ? ` (${p.rejections - p.joined} unjoined)` : ''}`);
  if (r.perWeek) for (const k of r.perWeek) L.push(`  week of ${k.week}: ${k.rejections} of ${k.turns}, ${pct(k.per100)}`);

  L.push('', 'Distance from the last rules injection (association only: a violation itself resets the distance)');
  for (const d of s.distance) L.push(`  ${d.bucket.padEnd(5)} prompts: ${d.rejections} rejected of ${d.turns} turns, ${pct(d.per100)}`);

  L.push('', `Rules with an error on final replies (share of ${v.linted} linted turns; mode = reply mode of those sessions)`);
  if (s.rulesFiring.length === 0) L.push('  none');
  for (const f of s.rulesFiring) {
    const terms = f.terms.length ? ` · terms: ${f.terms.map((t) => `${t.term} ${t.count}`).join(', ')}` : '';
    const modes = Object.entries(f.modes).map(([m, n]) => `${m} ${n}`).join(', ');
    L.push(`  ${f.check}: ${f.turns} turns (${f.share ?? '?'}%)${terms} · mode: ${modes || 'unknown'}`);
  }

  const j = s.rejected;
  L.push('', `Rules on rejected replies (${j.linted} linted, ${j.unlinted} unlinted)`);
  if (j.rules.length === 0) L.push('  none');
  for (const x of j.rules) L.push(`  ${x.check}: ${x.records} records (error ${x.error}, warning ${x.warning}, suggestion ${x.suggestion})`);
  L.push(`  rejected and clean: ${j.clean.count}${j.clean.count ? ` · reasons: ${j.clean.reasons.map((x) => x ?? '(none)').join(' | ')}` : ''}`);
  L.push(`  rejected with warnings or suggestions only: ${j.warningsOnly.count}${j.warningsOnly.rules.length ? ` · rules: ${j.warningsOnly.rules.map((x) => `${x.check} ${x.count}`).join(', ')}` : ''}`);

  const rw = s.rewrites;
  L.push('', `Rewrites: ${rw.total} · clean ${rw.clean} · kept an error ${rw.keptError} · unlinted ${rw.unlinted}`);
  if (rw.surviving.length) L.push(`  rules that survive a rewrite: ${rw.surviving.map((x) => `${x.check} ${x.count}`).join(', ')}`);

  L.push('', `Reasons given (${s.reasons.none} without one)`);
  if (s.reasons.given.length === 0) L.push('  none');
  for (const x of s.reasons.given) L.push(`  ${x.count} × ${x.reason}`);

  L.push('', 'Allows');
  if (s.allows.length === 0) L.push('  none');
  for (const a of s.allows) L.push(`  ${a.term}: ${a.count} (new ${a.added})${a.projects.length > 1 ? ` · in ${a.projects.length} projects` : ''}`);

  L.push('', 'Sessions per setting');
  if (s.settings.length === 0) L.push('  none recorded');
  for (const x of s.settings) {
    const c = x.config ?? {};
    L.push(`  ${x.sessions}: files ${c.files?.mode ?? '?'} · publish ${c.publish?.mode ?? '?'} · reply ${c.reply?.mode ?? '?'} · onViolation ${c.rules?.onViolation ?? '?'}`);
  }

  L.push('', 'Observations');
  const o = s.observations;
  if (j.clean.count) L.push(`  ${j.clean.count} rejected replies passed Vale clean: something Vale cannot see. A prose bullet or a new Vale rule covers it; /just-say-so:draft helps only for a rule that already exists.`);
  if (j.warningsOnly.count) L.push(`  ${j.warningsOnly.count} rejected replies carried only warnings or suggestions; the rules are listed above. The data does not say a warning caused the rejection.`);
  if (o.frequentNeverRejected.length) {
    L.push(`  error-level rules on ${FREQUENT}+ turns and on no rejected reply: ${o.frequentNeverRejected.map((x) => `${x.check} (${x.turns})`).join(', ')}. In block mode you never see the flagged reply, so this is what working enforcement looks like there.`);
  }
  if (!j.clean.count && !j.warningsOnly.count && !o.frequentNeverRejected.length) L.push('  nothing to note at these counts');
  return L.join('\n') + '\n';
}
