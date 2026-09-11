import assert from 'node:assert/strict';
import test from 'node:test';
import {
  documentationMarkdownFiles,
  headingSlug,
  links,
  mermaidAndFenceErrors,
  parseFrontMatter,
  runChecks,
} from './check-docs.mjs';

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

test('checks Mermaid and Markdown fence completeness', () => {
  assert.deepEqual(mermaidAndFenceErrors('```mermaid\nflowchart TD\n  A --> B\n```\n'), []);
  assert.deepEqual(mermaidAndFenceErrors('```mermaid\nflowchart TD\n'), ['fixture.md:1 unclosed Markdown fence']);
  assert.deepEqual(mermaidAndFenceErrors('```mermaid\n```\n'), ['fixture.md:1 empty Mermaid block']);
  assert.deepEqual(mermaidAndFenceErrors('```mermaid\nnot-a-diagram\n```\n'), ['fixture.md:1 Mermaid block has unknown diagram type']);
  assert.deepEqual(mermaidAndFenceErrors('````mermaid\nflowchart TD\n```\n'), ['fixture.md:1 unclosed Markdown fence']);
  assert.deepEqual(mermaidAndFenceErrors('~~~~mermaid\nflowchart TD\n```\n'), ['fixture.md:1 unclosed Markdown fence']);
  assert.deepEqual(mermaidAndFenceErrors('```mermaid extra\nflowchart TD\n```\n'), []);
  assert.deepEqual(mermaidAndFenceErrors('```mermaid\nflowchart TD\n``` trailing-info\n'), ['fixture.md:1 unclosed Markdown fence']);
  assert.deepEqual(mermaidAndFenceErrors('```mermaid\nflowchart TD\n````not-a-close\n'), ['fixture.md:1 unclosed Markdown fence']);
  assert.deepEqual(mermaidAndFenceErrors('    ```mermaid\nflowchart TD\n'), []);
  assert.deepEqual(mermaidAndFenceErrors('\t```mermaid\nflowchart TD\n'), []);
  assert.deepEqual(mermaidAndFenceErrors('```mermaid\nflowchart TD\n    ```\n'), ['fixture.md:1 unclosed Markdown fence']);
});

test('checks links across every docs Markdown file', () => {
  const files = documentationMarkdownFiles();
  assert.ok(files.length > 20);
  assert.ok(files.some((file) => file.endsWith('AGENTS.md')));
  assert.ok(files.some((file) => file.endsWith('README.md') && !file.includes('docs')));
  assert.ok(files.some((file) => file.endsWith('CONTRIBUTING.md')));
});

test('current repository governance documents pass', () => {
  const result = runChecks();
  assert.deepEqual(result.errors, []);
});
