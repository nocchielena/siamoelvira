// Downloads every image used by the site into src/assets/img (and originals/ for archival).
// Run once while the old site is still online: `npm run download`.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SRC, loadProject, collectAssets, collectOriginals, localAssetName } from './lib.mjs';

const data = loadProject();

async function fetchTo(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return 'skip';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return 'ok';
    } catch (err) {
      if (attempt === 3) return `error ${err.message}`;
    }
  }
}

async function run(urls, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const queue = [...urls];
  const failed = [];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const url = queue.shift();
      const name = dir.endsWith('originals') ? path.basename(url) : localAssetName(url);
      const status = await fetchTo(url, path.join(dir, name));
      if (status.startsWith('error')) failed.push(`${url} (${status})`);
    }
  }));
  console.log(`${dir}: ${urls.length - failed.length}/${urls.length}`);
  failed.forEach((f) => console.log('  FAILED', f));
}

await run(collectAssets(data), path.join(SRC, 'assets/img'));
await run(collectOriginals(data), path.join(ROOT, 'originals'));
