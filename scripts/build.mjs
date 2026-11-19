import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const entry of ['index.html', 'styles.css', 'manifest.webmanifest', 'privacy.html', 'assets', 'src', 'data', '.nojekyll']) {
  await cp(path.join(root, entry), path.join(dist, entry), { recursive: true, dereference: false });
}
let commit = process.env.GITHUB_SHA || 'local';
if (commit === 'local') {
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
}
const builtAt = new Date().toISOString();
const data = JSON.parse(await readFile(path.join(root, 'data/sources.json'), 'utf8'));
await writeFile(path.join(dist, 'build-info.json'), JSON.stringify({ version: '0.1.0', commit, builtAt, rulesCheckedAt: data.checkedAt }, null, 2) + '\n');
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
await writeFile(path.join(dist, 'data-status.html'), `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>상속한눈 · 자료 확인 상태</title><link rel="stylesheet" href="./styles.css"></head><body><main style="max-width:900px;margin:3rem auto;padding:1.25rem;font-size:1rem;line-height:1.8"><a href="./">상속한눈으로 돌아가기</a><h1>자료 확인 상태</h1><p><strong>자료 갱신 방식: 공식 안내 수동 검토 · 자동 수집 일정 없음</strong></p><p><strong>마지막 법령·안내 확인일: ${escape(data.checkedAt)}</strong></p><p>배포 패키지 생성: ${escape(builtAt)} · 소스 ${escape(commit.slice(0, 12))}</p><p>${escape(data.sourcePolicy)}</p><h2>지원 범위</h2><p>${escape(data.supportedScope)}</p><p>${escape(data.deadlinePolicy)}</p><h2>공식 출처</h2><ul>${data.sources.map(s => `<li><a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">${escape(s.title)}</a> · 확인 ${escape(s.checkedAt)}</li>`).join('')}</ul></main></body></html>`);
console.log(`Static Pages package: ${dist}`);
