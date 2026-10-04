import { describe, it, expect, beforeEach } from 'vitest';
import { matchGhTrigger, matchesMcpTool, collectStrings, tokenize, extractGhTexts } from './addons.js';

/*
 * Branch map — src/lib/addons.js
 *   matchGhTrigger: publishing subcommand → normalized phrase · matched inside
 *                   a compound command · non-publishing gh command → null ·
 *                   null/undefined input → null
 *   matchesMcpTool: wildcard pattern match · exact name match · no pattern
 *                   matches → false · patterns undefined → false
 *   collectStrings: bare string · nested objects and arrays · non-string
 *                   leaves dropped · null → []
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
        { label: '--title', text: 'a title' },
        { label: '--body', text: 'a body' }
      ]);
      expect(out.unresolved).toEqual([]);
    });

    it('should read the =-joined form', () => {
      const out = extractGhTexts('gh issue comment 7 --body="joined words"');
      expect(out.payloads).toEqual([{ label: '--body', text: 'joined words' }]);
    });
  });

  describe('when text arrives through a file flag', () => {
    it('should return the file contents as the payload', () => {
      const readFile = (p) => {
        expect(p).toBe('/notes/body.md');
        return 'file words';
      };
      const out = extractGhTexts('gh pr edit 9 --body-file /notes/body.md', { readFile });
      expect(out.payloads).toEqual([{ label: '--body-file', text: 'file words' }]);
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
      expect(out.payloads).toEqual([{ label: '-f body', text: 'api words' }]);
    });

    it('should read @file field values', () => {
      const readFile = () => 'from the file';
      const out = extractGhTexts('gh api -X PATCH repos/o/r/pulls/7 -F body=@/tmp/b.md', { readFile });
      expect(out.payloads).toEqual([{ label: '-F body', text: 'from the file' }]);
    });

    it('should mark --input unresolved', () => {
      const out = extractGhTexts('gh api -X POST repos/o/r/issues --input req.json');
      expect(out.unresolved).toEqual([
        { label: '--input', reason: 'request body from a file the checker does not parse' }
      ]);
    });
  });

  describe('when the command is compound', () => {
    it('should read flags only inside the gh segment', () => {
      const readFile = () => 'clean words';
      const out = extractGhTexts('cd /x && gh pr edit 1 --body-file notes.md && grep --body-file q', {
        readFile
      });
      expect(out.payloads).toEqual([{ label: '--body-file', text: 'clean words' }]);
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
