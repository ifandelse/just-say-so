import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contextSize, lastAssistantText } from '../src/lib/transcript.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcript.jsonl');

test('contextSize sums input + cache tokens of the newest usage block', () => {
  assert.equal(contextSize(FIXTURE), 450);
});

test('lastAssistantText joins every entry of the last assistant message', () => {
  assert.equal(lastAssistantText(FIXTURE), 'we leverage synergy\nsecond block');
});

test('missing transcript degrades to null/empty, never throws', () => {
  assert.equal(contextSize('/nope/missing.jsonl'), null);
  assert.equal(lastAssistantText('/nope/missing.jsonl'), '');
});
