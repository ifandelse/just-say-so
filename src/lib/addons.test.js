import { describe, it, expect, beforeEach } from 'vitest';
import { matchGhTrigger, matchesMcpTool, collectStrings } from './addons.js';

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
