// Scraper — Lois et règlements touchés par chaque projet de loi (sans IA, sans coût).
//
// Source : le PDF du projet tel que déposé en première lecture (champ `url` de
// data/bills.json, sur docs.legassembly.sk.ca). Chaque modification d'une autre loi y est
// annoncée par une note en marge (« SS 2000, c I-2.01 amended », « RRS c A-1 Reg 2 repealed »)
// suivie de la phrase qui nomme le texte (« The Income Tax Act, 2000 is amended… »). On ne
// retient que ces paires note + phrase : une loi simplement citée (« as amended from time to
// time ») n'a pas de note en marge et n'entre jamais dans la liste.
//
// Cache par projet dans data/lois-touchees.json : un PDF déjà lu n'est jamais retéléchargé
// (l'Assemblée ne réimprime pas un projet amendé). Les titres restent en anglais : la
// Saskatchewan ne publie pas de version française.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { USER_AGENT } from './sk-commun.js';

const BILLS_PATH = 'data/bills.json';
const CACHE_PATH = 'data/lois-touchees.json';
const DELAI_MS = 1200;
// Version de l'extraction : la changer force une relecture des PDF (après une correction de regex).
const VERSION = 4;

// La note en marge : « SS 2000, c I-2.01 amended », « RRS c W-13.12 Reg 6 repealed »,
// « SS 2013, c S-15.1, section 5-6 amended ».
const NOTE = String.raw`\b(?:R?SS|RRS)\s[\w\s,.()-]{0,80}?\b(?:amended|repealed)`;
// Puis l'article (« 2 », « 3(1) », « 13-2 », « 5-1 ») et la phrase qui nomme le texte, au besoin
// précédée de « Subsection 32(4) of ». Les vieilles lois privées s'appellent « An Act respecting… ».
const PHRASE = String.raw`\s*\d+(?:[-.]\d+)*(?:\(\d+\))?\s+(?:(?:In\s+)?(?:[Ss]ub)?(?:[Ss]ections?|[Cc]lauses?|[Ss]ubclauses?|[Pp]arts?|[Ss]chedules?|[Pp]aragraphs?)\b[^"]{0,80}?\sof\s)?((?:The|An)\s.{3,200}?)\s+(?:is|are)\s+(?:hereby\s+)?(?:amended|repealed)`;
const MOTIF = new RegExp(NOTE + PHRASE, 'g');

export function extraireLois(texte) {
  const plat = texte
    .replace(/[‐‑‒–]/g, '-') // tirets insécables des numéros d'article
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ');
  const vus = new Set();
  const lois = [];
  for (const m of plat.matchAll(MOTIF)) {
    const titre = m[1].trim()
      .replace(/\s+,/g, ',')
      .replace(/^The Schedule to (?=The )/, '')
      .replace(/,\s+(?:the|section|subsection|clause)\b.*$/i, ''); // « …Act, 1997, the definition of… »
    // Une phrase qui avale une autre note en marge n'est pas un titre.
    if (/\b(?:amended|repealed|SS|RRS)\b|"/.test(titre)) continue;
    if (!vus.has(titre)) { vus.add(titre); lois.push(titre); }
  }
  return lois;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const brut = JSON.parse(readFileSync(BILLS_PATH, 'utf-8'));
  const bills = Array.isArray(brut) ? brut : brut.bills;
  const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) : {};
  let lus = 0, erreurs = 0;
  for (const b of bills) {
    const url = b.url;
    if (!url || !/\.pdf$/i.test(url)) continue;
    const deja = cache[b.id];
    if (deja && deja.url === url && deja.version === VERSION) continue;
    if (lus + erreurs > 0) await dormir(DELAI_MS);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.subarray(0, 4).toString() !== '%PDF') throw new Error('pas un PDF');
      const { text } = await pdfParse(buf);
      cache[b.id] = { url, version: VERSION, lu: new Date().toISOString().slice(0, 10), lois: extraireLois(text) };
      lus++;
    } catch (e) {
      erreurs++;
      console.warn(`  ! projet ${b.num} (${b.session}) : ${e.message}`);
    }
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
  const avecBoite = Object.values(cache).filter((c) => c.lois.length >= 2).length;
  console.log(`Lois touchées : ${lus} PDF lus, ${erreurs} erreur(s), ${avecBoite} projet(s) avec au moins 2 textes.`);
}

if (process.argv[1] && process.argv[1].endsWith('lois-touchees.js')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
