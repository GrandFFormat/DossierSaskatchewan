// Scraper — le Conseil des ministres (Cabinet), en anglais ET en français.
//
// Sources : la page Cabinet de saskatchewan.ca et sa version française (section « Bonjour »).
// Chaque ministre : un <h2> avec son nom (lien vers sa fiche), puis un <p> avec ses
// portefeuilles. La version française est officielle, rédigée par le gouvernement : on ne
// traduit rien.
//
// saskatchewan.ca est servi par Cloudflare. Si un défi anti-robot se présente, lirePage()
// s'arrête : on ne le contourne pas, et data/ministers.json reste celui de la veille.
//
// Le parti de chaque ministre vient de data/deputes.json (un·e ministre est d'abord
// député·e). Vérifications, sinon rien n'est écrit :
//   - les deux pages nomment les mêmes personnes, dans le même ordre ;
//   - chaque ministre se retrouve parmi les 61 député·e·s.

import { readFileSync, writeFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { lirePage, sansTitre, plierNom } from './sk-commun.js';

const URL_EN = 'https://www.saskatchewan.ca/government/government-structure/cabinet';
const URL_FR = 'https://www.saskatchewan.ca/bonjour/government/cabinet';
const DEPUTES_PATH = 'data/deputes.json';
const OUT_PATH = 'data/ministers.json';

function lireListe(html, motifLien) {
  const $ = cheerio.load(html);
  const liste = [];
  $('h2 > a').each((_, a) => {
    const href = $(a).attr('href') || '';
    if (!motifLien.test(href)) return;
    const role = $(a).parent().nextAll('p').first().text().replace(/\s+/g, ' ').trim();
    liste.push({ name: sansTitre($(a).text()), role });
  });
  return liste;
}

async function main() {
  const { deputes } = JSON.parse(readFileSync(DEPUTES_PATH, 'utf-8'));
  const deputeParNom = new Map(deputes.map((d) => [plierNom(d.name), d]));

  const en = lireListe(await lirePage(URL_EN), /\/government\/government-structure\/cabinet\/honou?rable-/);
  const fr = lireListe(await lirePage(URL_FR), /\/bonjour\/government\/cabinet\/honou?rable-/);

  const erreurs = [];
  if (en.length === 0) erreurs.push('aucun·e ministre lu·e sur la page anglaise');
  if (en.length !== fr.length) erreurs.push(`${en.length} ministres en anglais, ${fr.length} en français`);
  en.forEach((m, i) => {
    if (fr[i] && plierNom(fr[i].name) !== plierNom(m.name)) {
      erreurs.push(`rang ${i + 1} : « ${m.name} » en anglais, « ${fr[i].name} » en français`);
    }
    if (!m.role) erreurs.push(`${m.name} : aucun portefeuille lu`);
    if (!deputeParNom.has(plierNom(m.name))) erreurs.push(`${m.name} : introuvable parmi les député·e·s`);
  });
  if (erreurs.length) {
    console.error(`ministers.js : rien n'est écrit —`);
    for (const e of erreurs) console.error(`  ✗ ${e}`);
    process.exitCode = 1;
    return;
  }

  const ministers = en.map((m, i) => {
    const depute = deputeParNom.get(plierNom(m.name));
    return { name: depute.name, role: fr[i].role, roleEn: m.role, party: depute.party, id: depute.id };
  });

  writeFileSync(OUT_PATH, JSON.stringify({
    source: URL_EN,
    sourceFr: URL_FR,
    scrapedAt: new Date().toISOString(),
    count: ministers.length,
    ministers,
  }, null, 2) + '\n');

  console.log(`${ministers.length} ministres écrits dans ${OUT_PATH} (anglais et français officiels)`);
  console.log(`  1er : ${ministers[0].name} — ${ministers[0].roleEn}`);
}

main().catch((err) => {
  console.error('Échec du scraper ministers.js :', err.message);
  process.exitCode = 1;
});
