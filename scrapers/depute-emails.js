// Scraper — le courriel de chaque député·e, tel que l'Assemblée le publie.
//
// Source : la page « MLA Contact Information » de l'Assemblée législative (HTML statique, un
// seul appel). Chaque rangée : un lien vers la fiche (nom en gras, caucus, circonscription),
// puis bureau, adresse, téléphone et le lien « mailto: ».
//
// On prend l'adresse que l'Assemblée affiche, telle quelle. Certaines sont celles d'un caucus
// (…@ndpcaucus.sk.ca), d'autres une adresse personnelle choisie par la personne : c'est le
// contact que l'Assemblée donne, pas à nous d'en juger. Pas de réseaux sociaux.
//
// Vérification : les 61 fiches du tableau doivent correspondre aux 61 député·e·s de
// data/deputes.json (même identifiant). Sinon, rien n'est écrit.

import { readFileSync, writeFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { ASSEMBLEE, lirePage, sansTitre, plierNom } from './sk-commun.js';

const URL_CONTACTS = `${ASSEMBLEE}/mlas/mla-contact-information/`;
const DEPUTES_PATH = 'data/deputes.json';
const OUT_PATH = 'data/deputes-contacts.json';

function identifiant(href) {
  const u = new URL(href, ASSEMBLEE);
  const prenom = (u.searchParams.get('first') || '').trim();
  const nom = (u.searchParams.get('last') || '').trim();
  return prenom && nom ? plierNom(`${prenom} ${nom}`).replace(/ /g, '-') : null;
}

async function main() {
  const { deputes } = JSON.parse(readFileSync(DEPUTES_PATH, 'utf-8'));
  const connus = new Map(deputes.map((d) => [d.id, d]));

  const $ = cheerio.load(await lirePage(URL_CONTACTS));
  const contacts = [];
  $('tr').each((_, rangee) => {
    const lien = $(rangee).find('a[href*="member-details"]').first();
    if (!lien.length) return;
    const id = identifiant(lien.attr('href'));
    const courriel = ($(rangee).find('a[href^="mailto:"]').first().attr('href') || '')
      .replace(/^mailto:/i, '').trim() || null;
    contacts.push({ id, name: sansTitre(lien.find('b').first().text() || lien.text()), email: courriel });
  });

  const erreurs = [];
  const vus = new Set(contacts.map((c) => c.id));
  const inconnus = contacts.filter((c) => !connus.has(c.id));
  const absents = deputes.filter((d) => !vus.has(d.id));
  if (inconnus.length) erreurs.push(`fiches absentes de data/deputes.json : ${inconnus.map((c) => c.name).join(', ')}`);
  if (absents.length) erreurs.push(`député·e·s sans rangée de contact : ${absents.map((d) => d.name).join(', ')}`);
  if (erreurs.length) {
    console.error(`depute-emails.js : rien n'est écrit —`);
    for (const e of erreurs) console.error(`  ✗ ${e}`);
    process.exitCode = 1;
    return;
  }

  // Le nom de référence est celui de data/deputes.json : c'est lui que les pages rapprochent.
  for (const c of contacts) c.name = connus.get(c.id).name;

  writeFileSync(OUT_PATH, JSON.stringify({
    source: URL_CONTACTS,
    scrapedAt: new Date().toISOString(),
    count: contacts.length,
    contacts,
  }, null, 2) + '\n');

  const sansCourriel = contacts.filter((c) => !c.email);
  console.log(`${contacts.length} contacts écrits dans ${OUT_PATH} — ${contacts.length - sansCourriel.length} avec courriel`);
  if (sansCourriel.length) console.log(`  ⚠ sans courriel publié : ${sansCourriel.map((c) => c.name).join(', ')}`);
}

main().catch((err) => {
  console.error('Échec du scraper depute-emails.js :', err.message);
  process.exitCode = 1;
});
