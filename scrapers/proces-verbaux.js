// Scraper — les procès-verbaux de la Chambre (« Votes and Proceedings »), un par jour de séance.
//
// C'est LA source des étapes des projets de loi et des votes nominatifs : l'Assemblée les publie
// en HTML le soir même ou le lendemain matin. On les liste par l'API que le calendrier du site de
// l'Assemblée utilise lui-même (/api/documents), puis on lit chacun avec sk-proces-verbal.js.
//
// Cache : on n'écrit pas le HTML (100 ko par jour), seulement ce qu'on en tire, dans
// data/proces-verbaux/<session>/<date>.json, avec la « version » que l'API donne au document.
// Un jour déjà lu n'est relu que si l'Assemblée a publié une nouvelle version (correction), ou si
// le lecteur lui-même a changé (VERSION_LECTEUR). Le passage quotidien ne télécharge donc que
// le procès-verbal de la veille.
//
// Usage : node scrapers/proces-verbaux.js [--tout]   (--tout : relit tous les jours)

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ASSEMBLEE, USER_AGENT, LEGISLATURE } from './sk-commun.js';
import { decoder, lireProcesVerbal } from './sk-proces-verbal.js';

// À changer à chaque modification de sk-proces-verbal.js qui change ce qu'il rend.
const VERSION_LECTEUR = 3;

// La 30e législature siège depuis le 2 décembre 2024 (élection du 28 octobre 2024).
const DEBUT_LEGISLATURE = '2024-11-01';
const DOSSIER = 'data/proces-verbaux';
const CHAMBRE = '280140000';          // « Legislative Assembly » dans l'API
const PROCES_VERBAL = '280140004';    // « Minutes »

const tout = process.argv.includes('--tout');
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function listerDocuments() {
  const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const url = `${ASSEMBLEE}/api/documents?` + new URLSearchParams({
    start: DEBUT_LEGISLATURE, end: demain, committee: CHAMBRE, type: PROCES_VERBAL, sort: 'committee',
  });
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`API des documents : HTTP ${res.status}`);
  const docs = await res.json();
  if (!Array.isArray(docs)) throw new Error('API des documents : réponse inattendue');
  // Seulement la législature en cours, et seulement ce qui a une version HTML.
  return docs
    .map((d) => ({ ...d, session: (d.htmlUrl || '').match(/\/(\d+L\d+S)\//)?.[1] ?? null }))
    .filter((d) => d.htmlUrl && d.session && d.session.startsWith(`${LEGISLATURE}L`));
}

async function main() {
  const { deputes } = JSON.parse(readFileSync('data/deputes.json', 'utf-8'));
  if (!deputes?.length) throw new Error('data/deputes.json vide : lancer scrapers/deputes.js d\'abord');

  const docs = await listerDocuments();
  let lus = 0, gardes = 0;
  const alertes = [];

  for (const d of docs) {
    const date = d.start.slice(0, 10);
    const dossier = join(DOSSIER, d.session);
    mkdirSync(dossier, { recursive: true });
    const chemin = join(dossier, `${date}.json`);

    if (!tout && existsSync(chemin)) {
      const avant = JSON.parse(readFileSync(chemin, 'utf-8'));
      if (avant.version === d.version && avant.lecteur === VERSION_LECTEUR) { gardes++; continue; }
    }

    const res = await fetch(d.htmlUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) { alertes.push(`${date} : HTTP ${res.status} — gardé tel quel`); continue; }
    const lu = lireProcesVerbal(decoder(Buffer.from(await res.arrayBuffer())), deputes);
    if (lu.date && lu.date !== date) alertes.push(`${date} : le document dit ${lu.date}`);
    for (const v of lu.divisions.filter((x) => !x.valide)) alertes.push(`${date} : vote non publié — ${v.raisons.join(' ; ')}`);

    writeFileSync(chemin, JSON.stringify({
      session: d.session,
      date,
      numero: lu.numero,
      url: d.htmlUrl,
      urlPdf: d.mainUrl,
      version: d.version,
      lecteur: VERSION_LECTEUR,
      evenements: lu.evenements,
      divisions: lu.divisions,
    }, null, 1) + '\n');
    lus++;
    await pause(700);   // un appel à la fois, sans presser le serveur de l'Assemblée
  }

  const parSession = {};
  for (const s of readdirSync(DOSSIER)) parSession[s] = readdirSync(join(DOSSIER, s)).filter((f) => f.endsWith('.json')).length;
  console.log(`procès-verbaux : ${docs.length} publiés, ${lus} lus, ${gardes} déjà à jour — ${Object.entries(parSession).map(([s, n]) => `${s} ${n}`).join(', ')}`);
  for (const a of alertes) console.log(`  ⚠ ${a}`);
}

main().catch((err) => {
  console.error('Échec du scraper proces-verbaux.js :', err.message);
  process.exitCode = 1;
});
