import assert from 'node:assert/strict';
import test from 'node:test';
import { headingSlug, links, parseFrontMatter, runChecks } from './check-docs.mjs';

test('parses governance metadata', () => {
  const metadata = parseFrontMatter('---\ntitle: Example\ntype: guide\nstatus: current\nupdated: 2026-09-10\n---\n# Example\n');
  assert.equal(metadata.get('type'), 'guide');
  assert.equal(metadata.get('status'), 'current');
});

test('normalizes multilingual headings and scans links outside code fences', () => {
  assert.equal(headingSlug('委派与并行'), '委派与并行');
  assert.deepEqual(links('[Guide](docs/guide.md)\n```md\n[Ignored](missing.md)\n```'), [
    { target: 'docs/guide.md', number: 1 },
  ]);
});

test('current repository governance documents pass', () => {
  const result = runChecks();
  assert.deepEqual(result.errors, []);
});
