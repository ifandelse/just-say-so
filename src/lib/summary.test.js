import { describe, it, expect, beforeEach } from 'vitest';
import { summarize, formatSummary, recordTime } from './summary.js';

/*
 * Branch map — src/lib/summary.js
 *   recordTime: id prefix · bad id → null
 *   window: since/until on both kinds (a rejection's time is its id) ·
 *     project filter · from/to · sessions, projects, versions ·
 *     flags for an empty events log and no rejections
 *   volume: turns are pass+standdown, block lines are attempts · linted vs
 *     unlinted (alerts null) · withError · joined/unjoined (promptIndex-1
 *     in the same session) · restate cross-check · allows
 *   rejection rate: overall · per project · per week only past four weeks ·
 *     null when no turns
 *   distance: five buckets, rate per bucket from the record's own
 *     sinceReminder
 *   rules firing: error-level, once per turn, share of linted, top terms by
 *     n, mode from the session event
 *   rejected: per rule per level once per record · clean with reasons ·
 *     warnings-only with rules · unlinted apart
 *   rewrites: clean, keptError, unlinted, surviving rules
 *   reasons grouped lowercase · allows per term with projects · settings ·
 *   tags: stored or derived from the reason, classified by the record's
 *     own project manifest as judgment, vale (with fires on linted rejected
 *     replies), or none · a tag two projects cover differently prints once
 *     per coverage with the projects named
 *   situations: per project, a tag at 3+ rejections lands in one kind, in
 *     order: uncovered · judgment (short text or not) · insufficient (under
 *     3 linted at restate-time, or no joined linted reply) · fired-shipped
 *     (ship-time alert from its rules, with modes and levels; stood-down
 *     turns counted) · stood-down (every ship-time fire was the reply gate
 *     standing down: block mode, an error-level hit; a stand-down under
 *     warn mode or a warning hit is the file gate's and stays
 *     fired-shipped) · a ship-time event that holds only other rules'
 *     alerts is ambiguous, since overlapping alerts fold to one: it never
 *     proves silence, and all-ambiguous evidence is insufficient · silent
 *     (restate-time catch under half) · detects-now (restate-time catch at
 *     half or more, none at ship-time) · untagged-clean per project · the
 *     same tag in two projects below 3 each earns nothing · a stood-down
 *     block counts as shipped · formatSituation renders each kind
 *   observations: frequentNeverRejected at 20+ turns
 *   compaction: a counter reset mid-session changes no count · a mode
 *     change mid-session attributes each reply to the snapshot in force
 *   rates: joined rejections only, overall, per project, per week, per
 *     bucket · unlogged sessions and a window boundary between the
 *     rejected turn and the restate leave the rejection out of every rate ·
 *     the join is chronological and bounded by the latest compaction or
 *     clear before the restate, so neither a reused index after compaction
 *     nor a pre-compaction turn stands in for the rejected turn
 *   formatSummary: empty · full · unavailable rates
 */

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0); // 2026-10-01T12:00:00Z
const at = (minutes) => new Date(T0 + minutes * 60_000).toISOString();

function session(id, project, minutes, reply = 'warn', over = {}) {
  return { t: at(minutes), e: 'session', session: id, project, v: '0.14.0', source: 'startup', vale: true, config: { files: { mode: 'warn' }, publish: { mode: 'block', gh: false, mcp: 0, artifact: true }, reply: { mode: reply }, rules: { onViolation: true } }, ...over };
}
function reply(id, project, minutes, promptIndex, sinceReminder, outcome, alerts) {
  return { t: at(minutes), e: 'reply', session: id, project, v: '0.14.0', promptIndex, sinceReminder, outcome, model: 'm', alerts };
}
function restate(id, project, minutes, promptIndex) {
  return { t: at(minutes), e: 'restate', session: id, project, v: '0.14.0', promptIndex, sinceReminder: 1, record: 'x', reasonGiven: true };
}
function allow(project, minutes, term, added = true) {
  return { t: at(minutes), e: 'allow', session: null, project, v: '0.14.0', term, file: '/x/accept.txt', added };
}
function rejection(id, project, minutes, promptIndex, sinceReminder, reason, rejectedAlerts, rewriteAlerts = undefined) {
  return {
    id: `${at(minutes)}-abcd`,
    session: id,
    project,
    promptIndex,
    sinceReminder,
    model: 'm',
    reason,
    prompt: 'p',
    rejected: { text: 'r', alerts: rejectedAlerts },
    rewrite: rewriteAlerts === undefined ? null : { text: 'w', alerts: rewriteAlerts },
    version: '0.14.0'
  };
}
const BUZZ = { check: 'JustSaySo.Buzzwords', severity: 'error', n: 1, match: 'synergy' };
const LEV = { check: 'JustSaySo.Leverage', severity: 'error', n: 2, match: 'leverage' };
const INT = { check: 'JustSaySo.Intensifiers', severity: 'suggestion', n: 1, match: 'very' };
const rb = (check, severity, match) => ({ check, severity, line: 1, match, message: 'm' });

describe('summary', () => {
  describe('recordTime', () => {
    it('should read the time from the id prefix and return null for anything else', () => {
      expect([recordTime({ id: '2026-10-01T12:00:00.000Z-abcd' }), recordTime({ id: 'nope' }), recordTime({})]).toEqual(['2026-10-01T12:00:00.000Z', null, null]);
    });
  });

  describe('when two projects, three sessions, and every record kind are summarized', () => {
    let s, text;

    beforeEach(() => {
      const A = '/p/a';
      const B = '/p/b';
      const events = [
        session('s1', A, 0, 'warn'),
        reply('s1', A, 1, 1, 0, 'pass', [BUZZ]),
        reply('s1', A, 2, 2, 1, 'pass', []),
        reply('s1', A, 3, 3, 2, 'pass', [LEV, INT]),
        restate('s1', A, 4, 4),
        reply('s1', A, 5, 4, 0, 'pass', []), // the rewrite
        reply('s1', A, 6, 5, 1, 'pass', null), // unlinted
        session('s2', A, 10, 'block'),
        reply('s2', A, 11, 1, 0, 'block', [BUZZ]),
        reply('s2', A, 12, 1, 0, 'block', [BUZZ]),
        reply('s2', A, 13, 1, 0, 'standdown', [BUZZ]),
        reply('s2', A, 14, 2, 1, 'pass', [LEV]),
        session('s3', B, 20, 'warn'),
        reply('s3', B, 21, 1, 0, 'pass', [LEV]),
        reply('s3', B, 22, 2, 7, 'pass', []),
        allow(A, 30, 'robust regression'),
        allow(B, 31, 'robust regression'),
        allow(A, 32, 'TLS', false)
      ];
      const rejections = [
        rejection('s1', A, 4, 4, 2, 'Too Much Jargon', [rb('JustSaySo.Leverage', 'error', 'leverage'), rb('JustSaySo.Intensifiers', 'suggestion', 'very')], []),
        rejection('s3', B, 23, 3, 7, 'too much jargon', [], [rb('JustSaySo.Buzzwords', 'error', 'synergy')]),
        rejection('s3', B, 24, 9, 12, null, [rb('JustSaySo.Intensifiers', 'suggestion', 'very')], null),
        rejection('s9', B, 25, 2, 0, 'flat', null)
      ];
      s = summarize(events, rejections);
      text = formatSummary(s);
    });

    it('should count turns, attempts, linted, unlinted, errors, rejections, joins, and allows', () => {
      expect(s.volume).toEqual({ turns: 9, attempts: 2, linted: 8, unlinted: 1, withError: 5, rejections: 4, restateEvents: 1, joined: 2, unjoined: 2, allows: 3 });
      expect(s.window).toEqual({
        from: at(0), to: at(32), since: null, until: null, project: null,
        sessions: 4, projects: ['/p/a', '/p/b'], versions: ['0.14.0'], eventsPresent: true, rejectionsPresent: true
      });
    });

    it('should rate rejections per 100 turns overall and per project, without weeks under a month', () => {
      expect(s.rejectionRate).toEqual({
        per100: 22.2,
        joined: 2,
        perProject: [
          { project: '/p/a', turns: 7, rejections: 1, joined: 1, per100: 14.3 },
          { project: '/p/b', turns: 2, rejections: 3, joined: 1, per100: 50 }
        ],
        perWeek: null
      });
    });

    it('should rate each distance bucket from the records own distance', () => {
      expect(s.distance).toEqual([
        { bucket: '0', turns: 4, rejections: 0, per100: 0 },
        { bucket: '1-2', turns: 4, rejections: 1, per100: 25 },
        { bucket: '3-5', turns: 0, rejections: 0, per100: null },
        { bucket: '6-10', turns: 1, rejections: 1, per100: 100 },
        { bucket: '11+', turns: 0, rejections: 0, per100: null }
      ]);
    });

    it('should list error rules once per turn with terms and the reply mode in force', () => {
      expect(s.rulesFiring).toEqual([
        { check: 'JustSaySo.Leverage', turns: 3, share: 37.5, terms: [{ term: 'leverage', count: 6 }], modes: { warn: 2, block: 1 } },
        { check: 'JustSaySo.Buzzwords', turns: 2, share: 25, terms: [{ term: 'synergy', count: 2 }], modes: { block: 1, warn: 1 } }
      ]);
    });

    it('should describe the rejected replies by rule and level, the clean ones, and the warnings-only ones', () => {
      expect(s.rejected).toEqual({
        linted: 3,
        unlinted: 1,
        rules: [
          { check: 'JustSaySo.Intensifiers', error: 0, warning: 0, suggestion: 2, records: 2 },
          { check: 'JustSaySo.Leverage', error: 1, warning: 0, suggestion: 0, records: 1 }
        ],
        clean: { count: 1, reasons: ['too much jargon'] },
        warningsOnly: { count: 1, rules: [{ check: 'JustSaySo.Intensifiers', count: 1 }] }
      });
    });

    it('should count rewrites, reasons, allows, and settings', () => {
      expect(s.rewrites).toEqual({ total: 3, clean: 1, keptError: 1, unlinted: 1, surviving: [] });
      expect(s.reasons).toEqual({ given: [{ reason: 'too much jargon', count: 2, projects: ['/p/a', '/p/b'] }, { reason: 'flat', count: 1, projects: ['/p/b'] }], none: 1 });
      expect(s.situations).toEqual([
        { kind: 'untagged-clean', project: '/p/b', tag: null, count: 1, rules: [], short: false, linted: 1, fired: 0, joinedLinted: 0, firedAtShip: 0, ambiguousAtShip: 0, cleanAtShip: 0, stoodDown: 0, modes: {}, levels: [], reasons: ['too much jargon'] }
      ]);
      expect(text).toContain('What the tags point at (per project; a tag needs 3 rejections');
      expect(text).toContain('/p/b · untagged and clean: 1 rejections with no tag that Vale passed clean. Points at tagging them: too much jargon');
      expect(s.allows).toEqual([
        { term: 'robust regression', count: 2, added: 2, projects: ['/p/a', '/p/b'] },
        { term: 'TLS', count: 1, added: 0, projects: ['/p/a'] }
      ]);
      expect(s.settings.map((x) => [x.sessions, x.config.reply.mode])).toEqual([[2, 'warn'], [1, 'block']]);
      expect(s.observations).toEqual({ frequentNeverRejected: [] });
    });

    it('should render every section as text', () => {
      expect(text).toContain('turns 9 (block attempts 2) · linted 8 · unlinted 1 · with an error 5');
      expect(text).toContain('overall: 2 joined rejections over 9 turns, 22.2 per 100 turns');
      expect(text).toContain('/p/b: 1 of 2 turns, 50 per 100 (2 unjoined)');
      expect(text).toContain('3-5   prompts: 0 rejected of 0 turns, rate unavailable');
      expect(text).toContain('JustSaySo.Leverage: 3 turns (37.5%) · terms: leverage 6 · mode: warn 2, block 1');
      expect(text).toContain('rejected and clean: 1 · reasons: too much jargon');
      expect(text).toContain('robust regression: 2 (new 2) · in 2 projects');
      expect(text).toContain('1 rejected replies passed Vale clean');
    });
  });

  describe('when the counter resets after compaction and the window starts mid-session', () => {
    let full, windowed;

    beforeEach(() => {
      const A = '/p/a';
      const events = [session('s1', A, 0)];
      for (let i = 1; i <= 40; i++) events.push(reply('s1', A, i, i, i - 1, 'pass', []));
      events.push({ ...session('s1', A, 41), source: 'compact' });
      for (let i = 1; i <= 10; i++) events.push(reply('s1', A, 41 + i, i, i - 1, 'pass', []));
      full = summarize(events, []);
      windowed = summarize(events, [], { since: at(45) });
    });

    it('should count fifty turns, not ten, and only the turns inside the window', () => {
      expect(full.volume.turns).toBe(50);
      expect(windowed.volume.turns).toBe(7);
      expect(windowed.window.from).toBe(at(45));
    });
  });

  describe('when the events log is off and only rejections exist', () => {
    let s, text;

    beforeEach(() => {
      s = summarize([], [rejection('s1', '/p/a', 1, 2, 0, 'x', [rb('JustSaySo.Buzzwords', 'error', 'synergy')])]);
      text = formatSummary(s);
    });

    it('should count the rejections, mark every rate unavailable, and say the log is empty', () => {
      expect(s.volume.rejections).toBe(1);
      expect(s.rejectionRate.per100).toBeNull();
      expect(s.window.eventsPresent).toBe(false);
      expect(text).toContain('the events log holds nothing for this window, so every rate is unavailable');
      expect(text).toContain('overall: 0 joined rejections over 0 turns, rate unavailable turns');
    });
  });

  describe('when null alerts appear on a turn, a rejected reply, and a rewrite', () => {
    let s;

    beforeEach(() => {
      const A = '/p/a';
      s = summarize(
        [session('s1', A, 0), reply('s1', A, 1, 1, 0, 'pass', null)],
        [rejection('s1', A, 2, 2, 0, 'x', null, null), rejection('s1', A, 3, 3, 0, 'y', [rb('JustSaySo.Buzzwords', 'error', 'synergy')], null)]
      );
    });

    it('should keep them out of clean, fixed, and error counts', () => {
      expect(s.volume).toMatchObject({ turns: 1, linted: 0, unlinted: 1, withError: 0 });
      expect(s.rejected).toMatchObject({ linted: 1, unlinted: 1, clean: { count: 0, reasons: [] } });
      expect(s.rewrites).toEqual({ total: 2, clean: 0, keptError: 0, unlinted: 2, surviving: [] });
    });
  });

  describe('when a rewrite is unlinted and another keeps the same rule', () => {
    let s;

    beforeEach(() => {
      const A = '/p/a';
      s = summarize(
        [],
        [
          rejection('s1', A, 1, 2, 0, 'x', [rb('JustSaySo.Buzzwords', 'error', 'synergy')], null),
          rejection('s1', A, 2, 3, 0, 'x', [rb('JustSaySo.Buzzwords', 'error', 'synergy')], [rb('JustSaySo.Buzzwords', 'error', 'synergy')])
        ]
      );
    });

    it('should count the unlinted rewrite apart and name the surviving rule', () => {
      expect(s.rewrites).toEqual({ total: 2, clean: 0, keptError: 1, unlinted: 1, surviving: [{ check: 'JustSaySo.Buzzwords', count: 1 }] });
    });
  });

  describe('when the window spans more than four weeks and a rule fires often with no rejection', () => {
    let s;

    beforeEach(() => {
      const A = '/p/a';
      const events = [session('s1', A, 0, 'block')];
      for (let i = 1; i <= 25; i++) events.push(reply('s1', A, i * 60 * 24 * 2, i, 0, 'pass', [LEV]));
      s = summarize(events, [rejection('s1', A, 3000, 2, 0, 'x', [rb('JustSaySo.Buzzwords', 'error', 'synergy')])]);
    });

    it('should report weeks and the frequent rule with its mode', () => {
      expect(s.rejectionRate.perWeek.length).toBeGreaterThan(4);
      expect(s.rejectionRate.perWeek.reduce((n, w) => n + w.turns, 0)).toBe(25);
      expect(s.observations.frequentNeverRejected).toEqual([{ check: 'JustSaySo.Leverage', turns: 25, modes: { block: 25 } }]);
      expect(formatSummary(s)).toContain('JustSaySo.Leverage (25). In block mode you never see the flagged reply');
    });
  });

  describe('when one session is logged and five rejections come from a session the log never saw', () => {
    let s;

    beforeEach(() => {
      const A = '/p/a';
      const events = [session('sA', A, 0), reply('sA', A, 1, 1, 0, 'pass', [])];
      const rejections = [1, 2, 3, 4, 5].map((i) => rejection('sB', A, 10 + i, i + 1, 0, 'x', [rb('JustSaySo.Buzzwords', 'error', 'synergy')]));
      s = summarize(events, rejections);
    });

    it('should keep the raw count, join nothing, and leave every rate at zero over the logged turn', () => {
      expect(s.volume).toMatchObject({ turns: 1, rejections: 5, joined: 0, unjoined: 5 });
      expect(s.rejectionRate).toMatchObject({ per100: 0, joined: 0, perProject: [{ project: '/p/a', turns: 1, rejections: 5, joined: 0, per100: 0 }] });
      expect(s.distance[0]).toEqual({ bucket: '0', turns: 1, rejections: 0, per100: 0 });
      expect(formatSummary(s)).toContain('5 do not and count in no rate');
    });
  });

  describe('when the window starts between a rejected reply and its restate', () => {
    let s;

    beforeEach(() => {
      const A = '/p/a';
      const events = [session('s1', A, 0), reply('s1', A, 1, 1, 3, 'pass', [LEV]), reply('s1', A, 5, 2, 0, 'pass', []), reply('s1', A, 6, 3, 1, 'pass', [])];
      // The restate at minute 3 rejects the turn at minute 1; the window opens at minute 2.
      s = summarize(events, [rejection('s1', A, 3, 2, 3, 'x', [rb('JustSaySo.Leverage', 'error', 'leverage')])], { since: at(2) });
    });

    it('should count the rejection raw, join it to nothing in the window, and charge no later turn', () => {
      expect(s.volume).toMatchObject({ turns: 2, rejections: 1, joined: 0, unjoined: 1 });
      expect(s.rejectionRate.per100).toBe(0);
      expect(s.distance.map((d) => d.rejections)).toEqual([0, 0, 0, 0, 0]);
    });
  });

  describe('when a compaction changes the reply mode mid-session', () => {
    let s;

    beforeEach(() => {
      const A = '/p/a';
      const events = [
        session('s1', A, 0, 'warn'),
        reply('s1', A, 1, 1, 0, 'pass', [LEV]),
        { ...session('s1', A, 2, 'block'), source: 'compact' },
        reply('s1', A, 3, 1, 0, 'pass', [LEV]),
        reply('s1', A, 4, 2, 1, 'pass', [BUZZ])
      ];
      s = summarize(events, [], { since: at(3) });
    });

    it('should attribute each reply to the snapshot in force when it happened, pre-window snapshots included', () => {
      expect(s.rulesFiring.map((r) => [r.check, r.modes])).toEqual([
        ['JustSaySo.Buzzwords', { block: 1 }],
        ['JustSaySo.Leverage', { block: 1 }]
      ]);
      const whole = summarize(events(), [], {});
      expect(whole.rulesFiring.find((r) => r.check === 'JustSaySo.Leverage').modes).toEqual({ block: 1, warn: 1 });
    });

    function events() {
      const A = '/p/a';
      return [
        session('s1', A, 0, 'warn'),
        reply('s1', A, 1, 1, 0, 'pass', [LEV]),
        { ...session('s1', A, 2, 'block'), source: 'compact' },
        reply('s1', A, 3, 1, 0, 'pass', [LEV]),
        reply('s1', A, 4, 2, 1, 'pass', [BUZZ])
      ];
    }
  });

  describe('when compaction reuses the rejected turn index and the window opens after the original reply', () => {
    let whole, windowed;

    beforeEach(() => {
      const A = '/p/a';
      const events = [
        session('s1', A, 0),
        reply('s1', A, 1, 1, 1, 'pass', []),
        reply('s1', A, 2, 2, 2, 'pass', []),
        reply('s1', A, 3, 3, 3, 'pass', [LEV]),
        restate('s1', A, 4, 4),
        reply('s1', A, 5, 4, 0, 'pass', []),
        { ...session('s1', A, 6), source: 'compact' },
        reply('s1', A, 7, 1, 0, 'pass', []),
        reply('s1', A, 8, 2, 0, 'pass', []),
        reply('s1', A, 9, 3, 0, 'pass', []),
        reply('s1', A, 10, 4, 0, 'pass', [])
      ];
      const rejections = [rejection('s1', A, 4, 4, 3, 'x', [rb('JustSaySo.Leverage', 'error', 'leverage')], [])];
      whole = summarize(events, rejections);
      windowed = summarize(events, rejections, { since: at(4) });
    });

    it('should join to the turn before the restate, never to the reused index after compaction', () => {
      expect(whole.volume).toMatchObject({ turns: 8, rejections: 1, joined: 1, unjoined: 0 });
      expect(whole.distance.map((d) => [d.bucket, d.rejections])).toEqual([['0', 0], ['1-2', 0], ['3-5', 1], ['6-10', 0], ['11+', 0]]);
      expect(windowed.volume).toMatchObject({ turns: 5, rejections: 1, joined: 0, unjoined: 1 });
      expect(windowed.rejectionRate.per100).toBe(0);
      expect(windowed.distance.map((d) => d.rejections)).toEqual([0, 0, 0, 0, 0]);
    });
  });

  describe('when the log goes quiet after a compaction and a rejection arrives at a reused index', () => {
    let s;

    beforeEach(() => {
      const A = '/p/a';
      const events = [
        session('s1', A, 0),
        reply('s1', A, 1, 1, 1, 'pass', []),
        reply('s1', A, 2, 2, 2, 'pass', []),
        reply('s1', A, 3, 3, 3, 'pass', [LEV]),
        { ...session('s1', A, 6), source: 'compact' }
        // the log is off from here: three prompts, then a restate at index 4
      ];
      s = summarize(events, [rejection('s1', A, 10, 4, 3, 'x', [rb('JustSaySo.Leverage', 'error', 'leverage')])]);
    });

    it('should leave the rejection unjoined rather than borrow the pre-compaction turn', () => {
      expect(s.volume).toMatchObject({ turns: 3, rejections: 1, joined: 0, unjoined: 1 });
      expect(s.rejectionRate.per100).toBe(0);
      expect(s.distance.map((d) => d.rejections)).toEqual([0, 0, 0, 0, 0]);
    });
  });

  describe('when rejections carry tags and a manifest is given', () => {
    let s, text;

    beforeEach(() => {
      const A = '/p/a';
      const manifest = {
        sections: [
          { rules: [{ id: 'end-with-fact', vale: ['ai-tells.MicDrop', 'ai-tells.PointVerdict'] }, { id: 'define-on-first-use', vale: [] }] }
        ]
      };
      const tagged = (minutes, reason, alerts, tags) => ({ ...rejection('s1', A, minutes, 2, 0, reason, alerts), tags });
      const rejections = [
        tagged(1, '#end-with-fact punchline', [rb('ai-tells.MicDrop', 'error', 'x')], ['end-with-fact']),
        tagged(2, '#end-with-fact again', [], ['end-with-fact']),
        tagged(3, '#end-with-fact unlinted', null, ['end-with-fact']),
        tagged(4, '#define-on-first-use what is a pin', [], ['define-on-first-use']),
        tagged(5, '#undefined-term #flourish', [], ['undefined-term', 'flourish']),
        { ...rejection('s1', A, 6, 2, 0, 'old record #undefined-term', []), tags: undefined }
      ];
      s = summarize([], rejections, { manifest });
      text = formatSummary(s);
    });

    it('should count each tag, classify its cover, and count rule fires for Vale-backed ones', () => {
      expect(s.tags).toEqual([
        { tag: 'end-with-fact', count: 3, fired: 1, linted: 2, covers: 'vale', rules: ['ai-tells.MicDrop', 'ai-tells.PointVerdict'], projects: ['/p/a'] },
        { tag: 'undefined-term', count: 2, fired: 0, linted: 0, covers: 'none', rules: [], projects: ['/p/a'] },
        { tag: 'define-on-first-use', count: 1, fired: 0, linted: 0, covers: 'judgment', rules: [], projects: ['/p/a'] },
        { tag: 'flourish', count: 1, fired: 0, linted: 0, covers: 'none', rules: [], projects: ['/p/a'] }
      ]);
      expect(text).toContain('end-with-fact: 3 · covered by a bullet backed by ai-tells.MicDrop, ai-tells.PointVerdict; those rules fired on 1 of 2 linted rejected replies');
      expect(text).toContain('define-on-first-use: 1 · covered by a judgment bullet; no Vale rule can check it');
      expect(text).toContain('what the rules do not cover yet: undefined-term (2), flourish (1).');
    });
  });

  describe('when two projects cover the same tag differently', () => {
    let s, text;

    beforeEach(() => {
      const shipped = { sections: [{ rules: [{ id: 'one-idea', vale: ['STE.SentenceLength'] }] }] };
      const withExtra = { sections: [...shipped.sections, { rules: [{ id: 'domain-term', vale: ['Project.DomainTerm'] }] }] };
      const manifestFor = (project) => (project === '/p/b' ? withExtra : shipped);
      const rejections = [
        { ...rejection('s1', '/p/a', 1, 2, 0, '#domain-term x', []), tags: ['domain-term'] },
        { ...rejection('s2', '/p/b', 2, 2, 0, '#domain-term y', [rb('Project.DomainTerm', 'error', 'q')]), tags: ['domain-term'] },
        { ...rejection('s2', '/p/b', 3, 3, 0, '#one-idea z', []), tags: ['one-idea'] }
      ];
      s = summarize([], rejections, { manifestFor });
      text = formatSummary(s);
    });

    it('should classify each record by its own project and print the differing coverages apart', () => {
      expect(s.tags).toEqual([
        { tag: 'domain-term', count: 1, fired: 0, linted: 0, covers: 'none', rules: [], projects: ['/p/a'] },
        { tag: 'domain-term', count: 1, fired: 1, linted: 1, covers: 'vale', rules: ['Project.DomainTerm'], projects: ['/p/b'] },
        { tag: 'one-idea', count: 1, fired: 0, linted: 1, covers: 'vale', rules: ['STE.SentenceLength'], projects: ['/p/b'] }
      ]);
      expect(text).toContain('domain-term: 1 (in /p/a) · no bullet covers it yet');
      expect(text).toContain('domain-term: 1 (in /p/b) · covered by a bullet backed by Project.DomainTerm; those rules fired on 1 of 1 linted rejected replies');
      expect(text).toContain('one-idea: 1 · covered by');
    });
  });

  describe('when tags recur enough to earn a situation', () => {
    let s, text;

    beforeEach(() => {
      const A = '/p/a';
      const B = '/p/b';
      const manifest = {
        sections: [
          { rules: [
            { id: 'fact', vale: ['ai-tells.MicDrop'] },
            { id: 'tune', vale: ['JustSaySo.Leverage'] },
            { id: 'late', vale: ['JustSaySo.Buzzwords'] },
            { id: 'thin', vale: ['JustSaySo.Intensifiers'] },
            { id: 'fold', vale: ['ai-tells.MicDrop'] },
            { id: 'plain', vale: [] },
            { id: 'terse', vale: [], short: 'Be terse.' }
          ] }
        ]
      };
      const MIC = { check: 'ai-tells.MicDrop', severity: 'warning', n: 1 };
      const events = [session('s1', A, 0, 'warn'), session('s2', B, 0, 'block')];
      const rejections = [];
      let m = 1;
      const add = (sid, proj, tag, shipAlerts, restateAlerts, { outcome = 'pass', join = true } = {}) => {
        const idx = m;
        if (join) events.push(reply(sid, proj, m, idx, 0, outcome, shipAlerts));
        rejections.push({ ...rejection(sid, proj, m + 0.5, idx + 1, 0, tag ? `#${tag} why` : 'no tag here', restateAlerts), tags: tag ? [tag] : [] });
        m += 1;
      };
      // fact: fired at ship-time, reply shipped, one of them a stood-down block.
      add('s1', A, 'fact', [MIC], [rb('ai-tells.MicDrop', 'warning', 'x')]);
      add('s1', A, 'fact', [MIC], [rb('ai-tells.MicDrop', 'warning', 'x')]);
      add('s2', B, 'fact', [MIC], [rb('ai-tells.MicDrop', 'warning', 'x')], { outcome: 'standdown' });
      add('s1', A, 'fact', [MIC], [rb('ai-tells.MicDrop', 'warning', 'x')]);
      // tune: linted, joined, never fires either way (three clean turns, then the overlap turns below).
      for (let i = 0; i < 3; i++) add('s1', A, 'tune', [], []);
      // late: catches at restate-time, silent at ship-time.
      for (let i = 0; i < 3; i++) add('s1', A, 'late', [], [rb('JustSaySo.Buzzwords', 'error', 'synergy')]);
      // thin: three rejections, none joined (the file-gate turns join below).
      for (let i = 0; i < 3; i++) add('s1', A, 'thin', [], [], { join: false });
      // fold: restate-time catches, but every ship-time event only holds another rule's alert.
      for (let i = 0; i < 3; i++) add('s1', A, 'fold', [{ check: 'JustSaySo.Leverage', severity: 'error', n: 1 }], [rb('ai-tells.MicDrop', 'warning', 'x'), rb('JustSaySo.Leverage', 'error', 'leverage')]);
      // gate: block mode in B, the rules fired at error, and every turn stood down.
      for (let i = 0; i < 3; i++) add('s2', B, 'late', [{ check: 'JustSaySo.Buzzwords', severity: 'error', n: 1 }], [rb('JustSaySo.Buzzwords', 'error', 'synergy')], { outcome: 'standdown' });
      // file-gate stand-down in A (warn mode, a warning-level hit): the reply gate never blocked.
      for (let i = 0; i < 3; i++) add('s1', A, 'thin', [{ check: 'JustSaySo.Intensifiers', severity: 'warning', n: 1 }], [rb('JustSaySo.Intensifiers', 'warning', 'very')], { outcome: 'standdown' });
      // overlap on tune: another rule fires at both times, the tagged rule at neither; those ship-time events are ambiguous, not proof.
      for (let i = 0; i < 3; i++) add('s1', A, 'tune', [{ check: 'JustSaySo.Buzzwords', severity: 'error', n: 1 }], [rb('JustSaySo.Buzzwords', 'error', 'synergy')]);
      // uncovered, judgment with and without short, below threshold across projects.
      for (let i = 0; i < 3; i++) add('s1', A, 'nope', [], []);
      for (let i = 0; i < 3; i++) add('s1', A, 'plain', [], []);
      for (let i = 0; i < 3; i++) add('s2', B, 'terse', [], []);
      add('s1', A, 'split', [], []);
      add('s1', A, 'split', [], []);
      add('s2', B, 'split', [], []);
      // untagged and clean, in B.
      add('s2', B, null, [], []);
      add('s2', B, null, [], []);
      s = summarize(events, rejections, { manifest });
      text = formatSummary(s);
    });

    it('should land each tag in one kind by the evidence rules, per project', () => {
      const brief = s.situations.map((x) => [x.project, x.tag, x.kind, x.count]);
      expect(brief).toEqual([
        ['/p/a', 'thin', 'fired-shipped', 6],
        ['/p/a', 'tune', 'silent', 6],
        ['/p/a', 'fact', 'fired-shipped', 3],
        ['/p/a', 'fold', 'insufficient', 3],
        ['/p/a', 'late', 'detects-now', 3],
        ['/p/a', 'nope', 'uncovered', 3],
        ['/p/a', 'plain', 'judgment', 3],
        ['/p/b', 'late', 'stood-down', 3],
        ['/p/b', 'terse', 'judgment', 3],
        ['/p/b', null, 'untagged-clean', 2]
      ]);
      expect(s.situations.find((x) => x.tag === 'fact')).toEqual({
        kind: 'fired-shipped', project: '/p/a', tag: 'fact', count: 3, rules: ['ai-tells.MicDrop'], short: false,
        linted: 3, fired: 3, joinedLinted: 3, firedAtShip: 3, ambiguousAtShip: 0, cleanAtShip: 0, stoodDown: 0, modes: { warn: 3 }, levels: ['warning'], reasons: ['#fact why', '#fact why', '#fact why']
      });
      expect(s.situations.find((x) => x.project === '/p/b' && x.tag === 'late')).toMatchObject({ kind: 'stood-down', firedAtShip: 3, stoodDown: 3, modes: { block: 3 }, levels: ['error'] });
      // A stand-down under warn mode with a warning-level hit is the file gate's, not the reply gate's.
      expect(s.situations.find((x) => x.project === '/p/a' && x.tag === 'thin')).toMatchObject({ kind: 'fired-shipped', linted: 6, joinedLinted: 3, firedAtShip: 3, stoodDown: 0, modes: { warn: 3 }, levels: ['warning'] });
      // The tagged rule is absent from every ship-time event, but each event holds another rule's alert: ambiguous, so no diagnosis.
      expect(s.situations.find((x) => x.tag === 'fold')).toMatchObject({ kind: 'insufficient', fired: 3, linted: 3, joinedLinted: 3, firedAtShip: 0, ambiguousAtShip: 3, cleanAtShip: 0 });
      // Silent, with the overlap turns counted as ambiguous rather than as proof of silence.
      expect(s.situations.find((x) => x.tag === 'tune')).toMatchObject({ kind: 'silent', fired: 0, linted: 6, ambiguousAtShip: 3, cleanAtShip: 3 });
      expect(s.situations.find((x) => x.project === '/p/b' && x.tag === null)).toMatchObject({ count: 2, reasons: ['no tag here', 'no tag here'] });
    });

    it('should render each kind with its counts', () => {
      expect(text).toContain('/p/a · #fact: 3 · backed by ai-tells.MicDrop · fired at ship-time on 3 of 3 joined replies (reply mode warn 3; levels warning) and the reply still went out. Points at enforcement');
      expect(text).toContain('/p/a · #late: 3 · backed by JustSaySo.Buzzwords · the rules catch 3 of 3 rejected replies at restate-time; at ship-time 3 joined events carry no alert at all. Where the event is empty the rules did not fire then');
      expect(text).toContain('/p/a · #nope: 3 · uncovered: no bullet has this id.');
      expect(text).toContain('/p/a · #plain: 3 · judgment bullet without a short text, so it is not in the condensed reminder.');
      expect(text).toContain('/p/a · #thin: 6 · backed by JustSaySo.Intensifiers · fired at ship-time on 3 of 3 joined replies (reply mode warn 3; levels warning) and the reply still went out. Points at enforcement');
      expect(text).toContain('/p/a · #fold: 3 · backed by ai-tells.MicDrop · 3 linted at restate-time, 3 joined replies linted at ship-time: not enough linted evidence to judge the rules. Every ship-time event carries other alerts and none names these rules; an overlapping alert folds to one, so that shows nothing either way.');
      expect(text).toContain('/p/a · #tune: 6 · backed by JustSaySo.Leverage · the rules caught 0 of 6 linted rejected replies at restate-time and none at ship-time (3 ship-time events carry other alerts, which can hide an overlapping one). Points at a Vale tune');
      expect(text).toContain('/p/b · untagged and clean: 2 rejections with no tag that Vale passed clean. Points at tagging them: no tag here | no tag here');
      expect(text).toContain('/p/b · #terse: 3 · judgment bullet with a short text.');
      expect(text).toContain('/p/b · #late: 3 · backed by JustSaySo.Buzzwords · fired at ship-time on 3 of 3 joined replies and every one was the reply gate standing down: reply mode block, an error-level hit, and a rewrite that kept the same alerts, so the gate let the turn end (reply mode block 3; levels error). Blocking and the level were in force. Points at the rule itself, its terms or its message, or a bullet the model can act on; not at a setting.');
      expect(text.split('What the tags point at')[1]).not.toContain('#split');
    });
  });

  describe('when a project filter is given', () => {
    let s;

    beforeEach(() => {
      s = summarize(
        [session('s1', '/p/a', 0), reply('s1', '/p/a', 1, 1, 0, 'pass', []), session('s2', '/p/b', 2), reply('s2', '/p/b', 3, 1, 0, 'pass', [])],
        [rejection('s2', '/p/b', 4, 2, 0, 'x', [])],
        { project: '/p/b' }
      );
    });

    it('should keep one project only', () => {
      expect([s.volume.turns, s.volume.rejections, s.window.projects]).toEqual([1, 1, ['/p/b']]);
    });
  });

  describe('when nothing is in the window', () => {
    it('should say so', () => {
      expect(formatSummary(summarize([], []))).toBe('just-say-so summary\n\nNo records in the window. The events log and the rejections file are empty, missing, or outside the window.\n');
    });
  });
});
