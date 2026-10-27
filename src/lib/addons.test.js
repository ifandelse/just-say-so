import { describe, it, expect, beforeEach } from 'vitest';
import { matchGhTrigger, matchesMcpTool, collectStrings, collectProseFields, tokenize, extractGhTexts } from './addons.js';

/*
 * Branch map — src/lib/addons.js
 *   matchGhTrigger: publishing subcommand → normalized phrase · matched inside
 *                   a compound command · non-publishing gh command → null ·
 *                   null/undefined input → null
 *   matchesMcpTool: wildcard pattern match · exact name match · no pattern
 *                   matches → false · patterns undefined → false
 *   collectStrings: bare string · nested objects and arrays · non-string
 *                   leaves dropped · null → []
 *   collectProseFields: strings with whitespace only, with path and leaf
 *                   field · arrays carry the parent's field · bare string ·
 *                   null → []
 */

describe('addons', () => {
  describe('matchGhTrigger', () => {
    describe('when commands of each shape are matched', () => {
      let simple, compound, nonPublishing, missing;

      beforeEach(() => {
        simple = matchGhTrigger('gh issue comment 42 --body "words"');
        compound = matchGhTrigger('git add . && gh pr create --title "words"');
        nonPublishing = matchGhTrigger('gh pr view 42 --json body');
        missing = matchGhTrigger(undefined);
      });

      it('should return the normalized phrase for publishing commands and null otherwise', () => {
        expect({ simple, compound, nonPublishing, missing }).toEqual({
          simple: 'gh issue comment',
          compound: 'gh pr create',
          nonPublishing: null,
          missing: null
        });
      });
    });
  });

  describe('matchesMcpTool', () => {
    describe('when patterns of each shape are tested', () => {
      let wildcard, exact, noMatch, noPatterns;

      beforeEach(() => {
        wildcard = matchesMcpTool('mcp__confluence__createPage', ['mcp__confluence__*']);
        exact = matchesMcpTool('mcp__jira__addComment', ['mcp__jira__addComment']);
        noMatch = matchesMcpTool('mcp__slack__postMessage', ['mcp__confluence__*']);
        noPatterns = matchesMcpTool('mcp__confluence__createPage', undefined);
      });

      it('should match wildcards and exact names, and reject the rest', () => {
        expect({ wildcard, exact, noMatch, noPatterns }).toEqual({
          wildcard: true,
          exact: true,
          noMatch: false,
          noPatterns: false
        });
      });
    });
  });

  describe('collectProseFields', () => {
    describe('when a tool input mixes prose, ids, and nested arrays', () => {
      let fields, bare, empty;

      beforeEach(() => {
        fields = collectProseFields({
          space: 'ENG',
          url: 'https://x.test/a?b=c',
          title: 'Q3 plan',
          page: { body: { text: 'pure synergy here', format: 'adf' } },
          comments: [{ body: 'first note' }, { body: 'nospace' }, { author: 'me', body: 'third note' }],
          tags: ['one word', 'single']
        });
        bare = collectProseFields('two words');
        empty = collectProseFields(null);
      });

      it('should keep only strings with whitespace, naming each by path and leaf field', () => {
        expect({ fields, bare, empty }).toEqual({
          fields: [
            { path: 'title', field: 'title', text: 'Q3 plan' },
            { path: 'page.body.text', field: 'text', text: 'pure synergy here' },
            { path: 'comments[0].body', field: 'body', text: 'first note' },
            { path: 'comments[2].body', field: 'body', text: 'third note' },
            { path: 'tags[0]', field: 'tags', text: 'one word' }
          ],
          bare: [{ path: '$', field: 'value', text: 'two words' }],
          empty: []
        });
      });
    });
  });

  describe('collectStrings', () => {
    describe('when inputs of each shape are collected', () => {
      let bare, nested, empty;

      beforeEach(() => {
        bare = collectStrings('words');
        nested = collectStrings({
          space: 'ENG',
          count: 3,
          draft: true,
          page: { title: 'Notes', labels: ['alpha', 7], body: null }
        });
        empty = collectStrings(null);
      });

      it('should return every string leaf and nothing else', () => {
        expect({ bare, nested, empty }).toEqual({
          bare: ['words'],
          nested: ['ENG', 'Notes', 'alpha'],
          empty: []
        });
      });
    });
  });
});

describe('tokenize', () => {
  it('should split on whitespace and keep quoted values whole', () => {
    expect(tokenize('gh pr edit 5 --body "two words"')).toEqual([
      { value: 'gh', unsafe: false },
      { value: 'pr', unsafe: false },
      { value: 'edit', unsafe: false },
      { value: '5', unsafe: false },
      { value: '--body', unsafe: false },
      { value: 'two words', unsafe: false }
    ]);
  });

  it('should mark expansions unsafe and single-quoted text safe', () => {
    const tokens = tokenize('echo "$(cat f)" \'$literal\' $VAR `cmd`');
    expect(tokens.map((t) => t.unsafe)).toEqual([false, true, false, true, true]);
  });

  it('should split separators into their own tokens', () => {
    const values = tokenize('cd x && gh pr view|head').map((t) => t.value);
    expect(values).toEqual(['cd', 'x', '&&', 'gh', 'pr', 'view', '|', 'head']);
  });
});

describe('extractGhTexts', () => {
  describe('when the command is not a covered gh invocation', () => {
    it('should return null', () => {
      expect(extractGhTexts('gh pr view 42 --json body')).toBeNull();
      expect(extractGhTexts('git commit -m "words"')).toBeNull();
      expect(extractGhTexts(undefined)).toBeNull();
    });
  });

  describe('when text arrives through value flags', () => {
    it('should return one payload per flag and never the command itself', () => {
      const out = extractGhTexts('gh pr create --title "a title" --body "a body" --draft');
      expect(out.target).toBe('gh pr create');
      expect(out.payloads).toEqual([
        { label: '--title', text: 'a title', target: expect.any(String) },
        { label: '--body', text: 'a body', target: expect.any(String) }
      ]);
      expect(out.unresolved).toEqual([]);
    });

    it('should read the =-joined form', () => {
      const out = extractGhTexts('gh issue comment 7 --body="joined words"');
      expect(out.payloads).toEqual([{ label: '--body', text: 'joined words', target: expect.any(String) }]);
    });
  });

  describe('when text arrives through a file flag', () => {
    it('should return the file contents as the payload', () => {
      const readFile = (p) => {
        expect(p).toBe('/notes/body.md');
        return 'file words';
      };
      const out = extractGhTexts('gh pr edit 9 --body-file /notes/body.md', { readFile });
      expect(out.payloads).toEqual([{ label: '--body-file', text: 'file words', target: expect.any(String) }]);
    });

    it('should mark stdin and unreadable files unresolved', () => {
      const readFile = () => {
        throw new Error('nope');
      };
      const stdin = extractGhTexts('gh pr edit 9 --body-file -', { readFile });
      const broken = extractGhTexts('gh pr edit 9 --body-file /gone.md', { readFile });
      expect(stdin.unresolved).toEqual([{ label: '--body-file', reason: 'reads stdin' }]);
      expect(broken.unresolved).toEqual([{ label: '--body-file', reason: 'cannot read /gone.md' }]);
    });
  });

  describe('when a value depends on the shell', () => {
    it('should mark substitutions, variables, and heredocs unresolved', () => {
      const sub = extractGhTexts('gh pr edit 9 --body "$(cat f)"');
      const variable = extractGhTexts('gh pr edit 9 --body $BODY');
      const heredoc = extractGhTexts('gh pr comment 9 --body-file - <<EOF');
      expect(sub.unresolved).toEqual([{ label: '--body', reason: 'shell expansion in the value' }]);
      expect(variable.unresolved).toEqual([{ label: '--body', reason: 'shell expansion in the value' }]);
      expect(heredoc.unresolved.map((u) => u.reason)).toContain('reads stdin');
    });
  });

  describe('when the command is gh api', () => {
    it('should check prose field keys and skip protocol keys', () => {
      const out = extractGhTexts('gh api -X PATCH repos/o/r/pulls/7 -f body="api words" -f state=closed');
      expect(out.target).toBe('gh api');
      expect(out.payloads).toEqual([{ label: '-f body', text: 'api words', target: expect.any(String) }]);
    });

    it('should read @file field values', () => {
      const readFile = () => 'from the file';
      const out = extractGhTexts('gh api -X PATCH repos/o/r/pulls/7 -F body=@/tmp/b.md', { readFile });
      expect(out.payloads).toEqual([{ label: '-F body', text: 'from the file', target: expect.any(String) }]);
    });

    it('should match a nested field key by its last bracketed segment', () => {
      const out = extractGhTexts(
        "gh api repos/o/r/pulls/7/reviews -f 'comments[][body]=nested words' -f 'comments[][path]=a.md' -f event=COMMENT"
      );
      expect(out.payloads).toEqual([{ label: '-f comments[][body]', text: 'nested words', target: expect.any(String) }]);
    });
  });

  describe('when the command is gh api with --input', () => {
    const review = JSON.stringify({
      event: 'COMMENT',
      body: 'summary words',
      comments: [
        { path: 'README.md', line: 1, side: 'RIGHT', body: 'first comment' },
        { path: 'README.md', line: 9, body: 'second comment', meta: { title: 'deep title' } }
      ]
    });

    it('should lint every prose key in the JSON body, labeled by its path', () => {
      const readFile = () => review;
      const out = extractGhTexts('gh api --method POST repos/o/r/pulls/7/reviews --input review.json', { readFile });
      expect(out).toEqual({
        target: 'gh api',
        payloads: [
          { label: '--input body', text: 'summary words', target: expect.any(String) },
          { label: '--input comments[0].body', text: 'first comment', target: expect.any(String) },
          { label: '--input comments[1].body', text: 'second comment', target: expect.any(String) },
          { label: '--input comments[1].meta.title', text: 'deep title', target: expect.any(String) }
        ],
        unresolved: []
      });
    });

    it('should read the =-joined form and a body with no prose keys', () => {
      const readFile = () => '{"state":"closed","labels":["bug"]}';
      const out = extractGhTexts('gh api -X PATCH repos/o/r/issues/3 --input=req.json', { readFile });
      expect(out).toEqual({ target: 'gh api', payloads: [], unresolved: [] });
    });

    it('should mark stdin, an unreadable file, a non-JSON file, and an expanded path unresolved', () => {
      const readFile = (p) => {
        if (p === 'text.md') return 'not json';
        throw new Error('ENOENT');
      };
      const cases = [
        'gh api repos/o/r/issues --input -',
        'gh api repos/o/r/issues --input missing.json',
        'gh api repos/o/r/issues --input text.md',
        'gh api repos/o/r/issues --input "$FILE"',
        'gh api repos/o/r/issues --input'
      ].map((c) => extractGhTexts(c, { readFile }).unresolved);
      expect(cases).toEqual([
        [{ label: '--input', reason: 'reads stdin' }],
        [{ label: '--input', reason: 'cannot read missing.json' }],
        [{ label: '--input', reason: 'text.md is not JSON' }],
        [{ label: '--input', reason: 'shell expansion in the file path' }],
        [{ label: '--input', reason: 'missing value' }]
      ]);
    });
  });

  describe('when -F stands in for a file flag', () => {
    it('should label it as the field the subcommand reads it into', () => {
      const readFile = () => 'file words';
      const pr = extractGhTexts('gh pr create -F body.md', { readFile });
      const release = extractGhTexts('gh release create v1 -F notes.md', { readFile });
      const missing = extractGhTexts('gh issue comment 3 -F', { readFile });
      expect({ pr: pr.payloads, release: release.payloads, missing: missing.unresolved }).toEqual({
        pr: [{ label: '--body-file', text: 'file words', target: 'gh pr create' }],
        release: [{ label: '--notes-file', text: 'file words', target: 'gh release create' }],
        missing: [{ label: '--body-file', reason: 'missing value' }]
      });
    });
  });

  describe('when the command is compound', () => {
    it('should stamp each payload with the gh invocation it came from', () => {
      const out = extractGhTexts('gh pr create --body clean && gh api repos/o/r/issues/1 -f title=synergy');
      expect(out).toEqual({
        target: 'gh pr create',
        payloads: [
          { label: '--body', text: 'clean', target: 'gh pr create' },
          { label: '-f title', text: 'synergy', target: 'gh api' }
        ],
        unresolved: []
      });
    });

    it('should read flags only inside the gh segment', () => {
      const readFile = () => 'clean words';
      const out = extractGhTexts('cd /x && gh pr edit 1 --body-file notes.md && grep --body-file q', {
        readFile
      });
      expect(out.payloads).toEqual([{ label: '--body-file', text: 'clean words', target: expect.any(String) }]);
      expect(out.unresolved).toEqual([]);
    });
  });

  describe('when a covered command carries no text flags', () => {
    it('should return the match with empty payloads', () => {
      const out = extractGhTexts('gh pr edit 5 --add-label bug');
      expect(out).toEqual({ target: 'gh pr edit', payloads: [], unresolved: [] });
    });
  });
});
