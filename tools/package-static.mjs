import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Include license notices in each distributable, not only in the source tree.
for (const directory of ['dist', 'dist/embed']) {
  await mkdir(directory, { recursive: true });
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'LICENSES']) {
    await cp(resolve(name), resolve(directory, name), { recursive: true });
  }
}
await cp('examples/embed.html', 'dist/embed.html');
