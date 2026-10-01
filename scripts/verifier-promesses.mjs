// Vérifie que chaque citation de data/promises.json se retrouve MOT POUR MOT dans sa source
// (la page officielle du parti). Une citation introuvable fait échouer le script : on la
// corrige ou on la retire, on ne la publie jamais « à peu près ».
//
// Usage : node scripts/verifier-promesses.mjs

import { readFileSync } from 'node:fs';
import { USER_AGENT } from '../scrapers/sk-commun.js';

const norm = (s) => s
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#8217;|&rsquo;|&#39;|&#039;|’/g, "'")
  .replace(/&#8211;|&ndash;|–/g, '-')
  .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|“|”/g, '"')
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

const { promises } = JSON.parse(readFileSync('data/promises.json', 'utf8'));
const pages = {};
let erreurs = 0;
for (const p of promises) {
  if (!pages[p.sourceUrl]) {
    const r = await fetch(p.sourceUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!r.ok) throw new Error(`${p.sourceUrl} : HTTP ${r.status}`);
    pages[p.sourceUrl] = norm(await r.text());
  }
  if (!pages[p.sourceUrl].includes(norm(p.quote))) {
    erreurs++;
    console.error(`✗ ${p.id} introuvable telle quelle dans ${p.sourceUrl}`);
  }
}
if (erreurs) { process.exitCode = 1; } else console.log(`✓ ${promises.length} citations retrouvées mot pour mot dans leur source`);
