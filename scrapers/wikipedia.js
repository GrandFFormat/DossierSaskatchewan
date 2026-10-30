// La page Wikipédia de chaque député·e, pour le bouton « W » des fiches (Martin, 30 oct. 2026, comme
// sur DossierQuébec et DossierCanada). Par lots de 50 titres (API publique de Wikipédia en anglais,
// où les élu·e·s de la Saskatchewan sont bien mieux couverts) : le titre nu, puis les titres
// d'homonymie usuels. Une page n'est retenue que si sa description parle d'une personne politique
// de la Saskatchewan ou du Canada ; la page française vient du lien interlangue de la page anglaise.
// Écrit data/wikipedia.json { identifiant: { en, fr } }.
//
// Se relance à la main après une élection (node scrapers/wikipedia.js, puis npm run build:deputes
// et node scripts/build-section-pages.js). Hors du rafraîchissement automatique.
import { readFileSync, writeFileSync } from 'node:fs';

const UA = 'DossierSaskatchewan/1.0 (https://dossiersaskatchewan.ca)';
const OUT = 'data/wikipedia.json';
const SUFFIXES = ['', ' (politician)', ' (Saskatchewan politician)', ' (Canadian politician)'];
const LIEU = /Saskatchewan|Canad/i;
const POLITIQUE = /politician|MLA|legislator|member of the Legislative Assembly|minister|premier/i;

async function lot(titres) {
  const url = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', redirects: '1', prop: 'description|pageprops|langlinks|info',
    inprop: 'url', lllang: 'fr', lllimit: 'max', ppprop: 'disambiguation', titles: titres.join('|'), formatversion: '2',
  });
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Wikipédia : HTTP ${r.status}`);
  const j = await r.json();
  // Titre demandé → titre final (normalisation et redirections), puis page.
  const vers = new Map();
  for (const n of j.query?.normalized ?? []) vers.set(n.from, n.to);
  for (const n of j.query?.redirects ?? []) vers.set(n.from, n.to);
  const pages = new Map((j.query?.pages ?? []).map((p) => [p.title, p]));
  const final = (t) => { let x = t; for (let i = 0; i < 3 && vers.has(x); i++) x = vers.get(x); return x; };
  return (t) => pages.get(final(t));
}

async function main() {
  const liste = JSON.parse(readFileSync('data/deputes.json', 'utf-8')).deputes;
  const liens = {};
  let restants = liste.slice();
  for (const s of SUFFIXES) {
    const suivants = [];
    for (let i = 0; i < restants.length; i += 50) {
      const groupe = restants.slice(i, i + 50);
      const trouver = await lot(groupe.map((d) => d.name + s));
      for (const d of groupe) {
        const p = trouver(d.name + s);
        const desc = p?.description ?? '';
        const bon = p && !p.missing && !p.pageprops?.disambiguation && LIEU.test(desc) && POLITIQUE.test(desc);
        if (bon) {
          const fr = p.langlinks?.[0]?.title;
          liens[d.id] = { en: p.fullurl, fr: fr ? `https://fr.wikipedia.org/wiki/${encodeURIComponent(fr.replace(/ /g, '_'))}` : null };
        } else suivants.push(d);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    restants = suivants;
    if (!restants.length) break;
  }
  writeFileSync(OUT, JSON.stringify({ source: 'en.wikipedia.org (API publique)', lu: new Date().toISOString().slice(0, 10), liens }, null, 2) + '\n');
  console.log(`${Object.keys(liens).length} pages trouvées sur ${liste.length}`);
  if (restants.length) console.log(`  sans page sûre (${restants.length}) : ${restants.map((d) => d.name).join(', ')}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
