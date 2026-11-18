// With assetPrefix './', Next writes CSS font URLs relative to the page
// ("_next/static/media/..."), but browsers resolve CSS URLs relative to the
// stylesheet. Point them at the sibling media folder instead.
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const dir = 'out/_next/static/css';
let fixed = 0;
for (const name of readdirSync(dir)) {
  if (!name.endsWith('.css')) continue;
  const file = join(dir, name);
  const css = readFileSync(file, 'utf8');
  const next = css.replace(/url\((["']?)(?:\.\/)?_next\/static\/media\//g, 'url($1../media/');
  if (next !== css) {
    writeFileSync(file, next);
    fixed++;
  }
}
console.log(`fix-export: rewrote font URLs in ${fixed} stylesheet(s)`);
