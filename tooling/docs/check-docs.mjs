import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '../..');
const requiredMetadata = ['title', 'type', 'status', 'updated'];
const allowedTypes = new Set([
  'navigation', 'guide', 'reference', 'architecture', 'protocol', 'decision',
  'proposal', 'status', 'governance', 'operations', 'archive',
]);
const allowedStatuses = new Set(['current', 'proposed', 'historical', 'archived']);
const skippedDirectories = new Set(['.git', '.turbo', 'node_modules', 'dist', 'coverage']);

function collectMarkdown(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) files.push(...collectMarkdown(join(directory, entry.name)));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

function managedMarkdownFiles(projectRoot = rootDir) {
  const fixed = ['AGENTS.md', 'README.md', 'CONTRIBUTING.md', 'docs/README.md', 'docs/STYLE.md']
    .map((path) => join(projectRoot, path))
    .filter((path) => existsSync(path));
  return [
    ...fixed,
    ...collectMarkdown(join(projectRoot, 'docs/guides')),
    ...collectMarkdown(join(projectRoot, 'docs/reference')),
  ].sort();
}

function documentationMarkdownFiles(projectRoot = rootDir) {
  return [...new Set([
    ...managedMarkdownFiles(projectRoot),
    ...collectMarkdown(join(projectRoot, 'docs')),
  ])].sort();
}

function parseFrontMatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return null;
  const metadata = new Map();
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (match) metadata.set(match[1], match[2]);
  }
  return metadata;
}

function headingSlug(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fenceToken(line) {
  const match = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  return { char: match[2][0], length: match[2].length, info: match[3] };
}

function closesFence(token, opening) {
  return token
    && token.char === opening.char
    && token.length >= opening.length
    && token.info.trim() === '';
}

function markdownLines(content) {
  const output = [];
  let fence = null;
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const token = fenceToken(line);
    if (token) {
      if (!fence) fence = token;
      else if (closesFence(token, fence)) fence = null;
      continue;
    }
    if (!fence) output.push({ line, number: index + 1 });
  }
  return output;
}

function mermaidAndFenceErrors(content, shown = 'fixture.md') {
  const errors = [];
  let fence = null;
  let fenceLine = 0;
  let mermaid = null;
  let mermaidHasBody = false;
  let mermaidFirstLine = '';
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const token = fenceToken(line);
    const info = token?.info.trim();
    if (!fence && token && /^mermaid$/i.test(info)) {
      fence = token;
      fenceLine = index + 1;
      mermaid = { line: fenceLine };
      mermaidHasBody = false;
      mermaidFirstLine = '';
      continue;
    }
    if (!fence && token) {
      fence = token;
      fenceLine = index + 1;
      continue;
    }
    if (fence && closesFence(token, fence)) {
      if (mermaid && !mermaidHasBody) errors.push(`${shown}:${mermaid.line} empty Mermaid block`);
      if (mermaid && mermaidHasBody && !/^(flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|erDiagram|classDiagram|gantt|journey|mindmap|timeline|quadrantChart|pie|gitGraph)\b/i.test(mermaidFirstLine)) {
        errors.push(`${shown}:${mermaid.line} Mermaid block has unknown diagram type`);
      }
      fence = null;
      mermaid = null;
      continue;
    }
    if (mermaid && line.trim()) {
      mermaidHasBody = true;
      if (!mermaidFirstLine) mermaidFirstLine = line.trim();
    }
  }
  if (fence) errors.push(`${shown}:${fenceLine} unclosed Markdown fence`);
  return errors;
}

function headings(content) {
  return markdownLines(content)
    .map(({ line, number }) => {
      const match = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
      return match ? { slug: headingSlug(match[1]), number } : null;
    })
    .filter(Boolean);
}

function links(content) {
  const found = [];
  for (const { line, number } of markdownLines(content)) {
    const expression = /\[[^\]]*\]\(([^)]+)\)/g;
    for (const match of line.matchAll(expression)) found.push({ target: match[1].trim(), number });
  }
  return found;
}

function isWithinRoot(candidate, projectRoot) {
  const rel = relative(resolve(projectRoot), resolve(candidate));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function validateFile(file, projectRoot, errors) {
  const content = readFileSync(file, 'utf8');
  const shown = relative(projectRoot, file).replaceAll('\\', '/');
  const existingManagedDoc = shown === 'docs/README.md'
    || shown === 'docs/STYLE.md'
    || shown.startsWith('docs/guides/')
    || shown.startsWith('docs/reference/');
  const metadata = parseFrontMatter(content);
  const migratedCurrentDoc = metadata?.get('status') === 'current';
  if (existingManagedDoc || migratedCurrentDoc) {
    if (!metadata) errors.push(`${shown}:1 missing YAML front matter`);
    else {
      for (const key of requiredMetadata) if (!metadata.get(key)) errors.push(`${shown}:1 missing metadata: ${key}`);
      if (metadata.get('type') && !allowedTypes.has(metadata.get('type'))) errors.push(`${shown}:1 unsupported type: ${metadata.get('type')}`);
      if (metadata.get('status') && !allowedStatuses.has(metadata.get('status'))) errors.push(`${shown}:1 unsupported status: ${metadata.get('status')}`);
      if (metadata.get('updated') && !/^\d{4}-\d{2}-\d{2}$/.test(metadata.get('updated'))) errors.push(`${shown}:1 updated must use YYYY-MM-DD`);
    }
  }

  errors.push(...mermaidAndFenceErrors(content, shown));

  const seen = new Map();
  for (const heading of headings(content)) {
    if (seen.has(heading.slug)) errors.push(`${shown}:${heading.number} duplicate heading #${heading.slug}`);
    else seen.set(heading.slug, heading.number);
  }

  for (const link of links(content)) {
    if (/^(?:https?:|mailto:|data:)/i.test(link.target)) continue;
    const [rawPath, rawFragment = ''] = link.target.split('#', 2);
    let decodedPath;
    let decodedFragment;
    try {
      decodedPath = decodeURIComponent(rawPath);
      decodedFragment = decodeURIComponent(rawFragment);
    } catch {
      errors.push(`${shown}:${link.number} invalid link encoding: ${link.target}`);
      continue;
    }
    if (isAbsolute(decodedPath) || /^[A-Za-z]:[\\/]/.test(decodedPath)) {
      errors.push(`${shown}:${link.number} absolute local link: ${link.target}`);
      continue;
    }
    const destination = decodedPath ? resolve(dirname(file), decodedPath) : file;
    if (!isWithinRoot(destination, projectRoot)) {
      errors.push(`${shown}:${link.number} link escapes repository: ${link.target}`);
      continue;
    }
    if (!existsSync(destination)) {
      errors.push(`${shown}:${link.number} missing link target: ${link.target}`);
      continue;
    }
    const stats = statSync(destination);
    const target = stats.isDirectory() ? join(destination, 'README.md') : destination;
    if (!existsSync(target)) {
      errors.push(`${shown}:${link.number} directory link has no README.md: ${link.target}`);
      continue;
    }
    if (decodedFragment) {
      const targetHeadings = headings(readFileSync(target, 'utf8'));
      if (!targetHeadings.some((heading) => heading.slug === headingSlug(decodedFragment))) {
        errors.push(`${shown}:${link.number} missing heading fragment: ${link.target}`);
      }
    }
  }
}

function runChecks(projectRoot = rootDir) {
  const errors = [];
  const files = documentationMarkdownFiles(projectRoot);
  for (const file of files) validateFile(file, projectRoot, errors);
  return { files, errors };
}

function main() {
  const result = runChecks();
  if (result.errors.length) {
    console.error(`Documentation checks failed with ${result.errors.length} error(s):`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Documentation checks passed (${result.files.length} Markdown files).`);
  }
}

export {
  documentationMarkdownFiles,
  headingSlug,
  links,
  managedMarkdownFiles,
  mermaidAndFenceErrors,
  parseFrontMatter,
  runChecks,
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
