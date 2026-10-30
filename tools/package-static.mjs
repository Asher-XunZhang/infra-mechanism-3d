import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Include license notices in each distributable, not only in the source tree.
for (const directory of ['dist', 'dist/embed']) {
  await mkdir(directory, { recursive: true });
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'LICENSES']) {
    await cp(resolve(name), resolve(directory, name), { recursive: true });
  }
}
await cp('examples/embed.html', 'dist/embed.html');

// A calling site can verify the exact pinned payload without a runtime CDN.
const files = [];
async function inventory(directory, relative = '') {
  for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = relative ? `${relative}/${item.name}` : item.name;
    if (item.isDirectory()) await inventory(resolve(directory, item.name), path);
    else if (item.name !== 'manifest.json') {
      const bytes = await readFile(resolve(directory, item.name));
      files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
await inventory(resolve('dist/embed'));
let sourceCommit = null, dirty = null;
try {
  sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
} catch { /* Source archives may not contain Git metadata. */ }
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile('dist/embed/manifest.json', JSON.stringify({ version, sourceCommit, dirty, files }, null, 2) + '\n');
