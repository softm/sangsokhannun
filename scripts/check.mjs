import { readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const file of await readdir(path.join(root, 'src'))) {
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', path.join(root, 'src', file)], { stdio: 'inherit' });
}
const html = await readFile(path.join(root, 'index.html'), 'utf8');
assert.match(html, /lang=["']ko["']/);
assert.match(html, /name=["']viewport["']/);
for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const reference = match[1];
  if (/^(?:https?:|data:|#|mailto:)/.test(reference)) continue;
  const local = path.resolve(root, reference.split(/[?#]/)[0]);
  assert.ok(local.startsWith(root + path.sep), `Asset escapes project: ${reference}`);
  assert.ok((await stat(local)).isFile(), `Missing asset: ${reference}`);
}
assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i, 'Personal records must not be exposed to third-party scripts.');
JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
const sources = JSON.parse(await readFile(path.join(root, 'data/sources.json'), 'utf8'));
assert.ok(sources.checkedAt && sources.sources.length >= 5);
console.log('JavaScript syntax, local asset references, manifest and source metadata: OK');
