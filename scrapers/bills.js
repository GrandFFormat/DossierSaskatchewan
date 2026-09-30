// Scraper — les projets de loi de la législature, étape par étape.
//
// Source : les procès-verbaux déjà lus par proces-verbaux.js (data/proces-verbaux/). Chaque
// projet y apparaît jour après jour : dépôt et première lecture, deuxième lecture, renvoi en
// comité, rapport (avec ou sans amendement), troisième lecture, sanction royale — ou retrait,
// ou rejet. On les assemble ici ; on ne devine aucune étape.
//
// Le texte : un PDF par projet, à une adresse stable
// (docs.legassembly.sk.ca/legdocs/Bills/<session>/Bill<législature>-<n°>.pdf), publié le jour
// même de la première lecture. C'est le texte TEL QUE DÉPOSÉ : l'Assemblée ne réimprime pas un
// projet amendé en comité. Les notes explicatives n'existent que pour certains projets : on
// vérifie leur présence une fois (requête HEAD) et on garde la réponse.
//
// Numérotation : continue sur toute la législature (1 à 23, puis 24 à 60…) ; les projets de
// député·e·s commencent à 601, les projets privés à 901. Un numéro désigne donc un seul projet
// dans la législature.
//
// Une session se termine à la prorogation : dès que la session suivante a un procès-verbal,
// tout projet de la précédente qui n'a pas été sanctionné est mort au Feuilleton.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { USER_AGENT, LEGISLATURE } from './sk-commun.js';

const DOSSIER_PV = 'data/proces-verbaux';
const OUT_PATH = 'data/bills.json';
const DOCS = 'https://docs.legassembly.sk.ca/legdocs';

const ETAPES = { premiere: 1, deuxieme: 2, renvoi: 3, rapport: 4, troisieme: 5, sanction: 5 };

function typeDe(num) {
  if (num >= 901) return { type: 'Private Bill', typeFr: 'Projet de loi d\'intérêt privé' };
  if (num >= 601) return { type: "Private Members' Public Bill", typeFr: 'Projet de loi d\'un·e député·e' };
  return { type: 'Government Bill', typeFr: 'Projet de loi du gouvernement' };
}

const numeroSession = (code) => Number(code.match(/L(\d+)S$/)[1]);

async function existe(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } });
    return r.ok;
  } catch { return false; }
}

function note(b) {
  const d = (x) => x;
  switch (b.status) {
    case 'sanctionne': return [`Sanctionné le ${d(b.dates.sanction)}`, `Assented to on ${b.dates.sanction}`];
    case 'rejete': return [`Rejeté le ${d(b.dates.retire)}`, `Defeated on ${b.dates.retire}`];
    case 'retire': return [`Retiré du Feuilleton le ${d(b.dates.retire)}`, `Removed from the Order Paper on ${b.dates.retire}`];
    case 'mort': return [`Mort au Feuilleton à la fin de la session`, 'Died on the Order Paper when the session ended'];
    default: {
      if (b.dates.troisieme) return [`Adopté en troisième lecture le ${b.dates.troisieme}, en attente de sanction`, `Passed third reading on ${b.dates.troisieme}, awaiting Royal Assent`];
      if (b.dates.rapport) return [`Rapport du comité le ${b.dates.rapport}`, `Reported by committee on ${b.dates.rapport}`];
      if (b.dates.renvoi) return [`Renvoyé en comité le ${b.dates.renvoi}`, `Referred to committee on ${b.dates.renvoi}`];
      if (b.dates.deuxieme) return [`Deuxième lecture le ${b.dates.deuxieme}`, `Second reading on ${b.dates.deuxieme}`];
      return [`Déposé le ${b.dates.premiere}`, `Introduced on ${b.dates.premiere}`];
    }
  }
}

async function main() {
  // 1. Tous les événements, dans l'ordre des jours.
  const sessions = readdirSync(DOSSIER_PV).filter((s) => s.startsWith(`${LEGISLATURE}L`)).sort((a, b) => numeroSession(a) - numeroSession(b));
  if (!sessions.length) throw new Error('aucun procès-verbal : lancer scrapers/proces-verbaux.js d\'abord');
  const derniereSession = sessions[sessions.length - 1];

  const projets = new Map();   // num → projet en construction
  for (const session of sessions) {
    const jours = readdirSync(join(DOSSIER_PV, session)).filter((f) => f.endsWith('.json')).sort();
    for (const f of jours) {
      const jour = JSON.parse(readFileSync(join(DOSSIER_PV, session, f), 'utf-8'));
      for (const e of jour.evenements) {
        let b = projets.get(e.bill);
        if (!b) {
          b = { num: e.bill, session, dates: {}, comites: [], amende: false, titre: null, titreFr: null, parrain: null, sources: new Set() };
          projets.set(e.bill, b);
        }
        b.sources.add(jour.url);
        if (e.titre && !b.titre) b.titre = e.titre;
        if (e.titreFr && !b.titreFr) b.titreFr = e.titreFr;
        if (e.type === 'premiere') { b.session = session; if (e.parrain) b.parrain = e.parrain; }
        // La PREMIÈRE date de chaque étape (un rapport peut venir de deux comités : on les garde tous).
        if (!b.dates[e.type]) b.dates[e.type] = jour.date;
        if (e.comite && !b.comites.includes(e.comite)) b.comites.push(e.comite);
        if (e.amende) b.amende = true;
        if (e.type === 'retire') b.motifRetrait = e.motif;
      }
    }
  }

  // 2. Ce qu'on ne peut pas publier sans vérifier.
  const erreurs = [];
  for (const b of projets.values()) {
    if (!b.dates.premiere) erreurs.push(`n° ${b.num} : aucune première lecture trouvée`);
    if (!b.titre) erreurs.push(`n° ${b.num} : aucun titre`);
  }
  if (erreurs.length) {
    console.error(`bills.js : rien n'est écrit —`);
    for (const e of erreurs) console.error(`  ✗ ${e}`);
    process.exitCode = 1;
    return;
  }

  // 3. Les notes explicatives déjà vérifiées la dernière fois (on ne redemande pas).
  const avant = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, 'utf-8')).bills ?? [] : [];
  const notesConnues = new Map(avant.filter((b) => b.notesUrl !== undefined).map((b) => [b.id, b.notesUrl]));

  const bills = [];
  for (const b of [...projets.values()].sort((a, c) => a.num - c.num)) {
    const id = `${LEGISLATURE}-${numeroSession(b.session)}-${b.num}`;
    const sessionFinie = b.session !== derniereSession;
    const status = b.dates.sanction ? 'sanctionne'
      : b.dates.retire ? (b.motifRetrait === 'rejete' ? 'rejete' : 'retire')
        : sessionFinie ? 'mort'
          : 'encours';
    const step = Math.max(...Object.keys(b.dates).map((t) => ETAPES[t] ?? 0));
    const url = `${DOCS}/Bills/${b.session}/Bill${LEGISLATURE}-${b.num}.pdf`;
    let notesUrl = notesConnues.get(id);
    if (notesUrl === undefined) {
      const candidat = `${DOCS}/Explanatory%20Notes/${b.session}/Bill${LEGISLATURE}-${b.num}EN.pdf`;
      notesUrl = (await existe(candidat)) ? candidat : null;
      await new Promise((ok) => setTimeout(ok, 300));
    }
    const lastActivity = Object.values(b.dates).sort().pop();
    const [noteFr, noteEn] = note({ status, dates: b.dates });
    bills.push({
      id,
      num: b.num,
      legislature: LEGISLATURE,
      introSession: numeroSession(b.session),
      session: b.session,
      ...typeDe(b.num),
      // Le titre officiel est anglais ; le titre français n'existe que pour les projets bilingues.
      title: b.titre,
      titleEn: b.titre,
      titleFrOfficiel: b.titreFr,
      status,
      step,
      note: noteFr,
      noteEn,
      presentedOn: b.dates.premiere,
      lastActivity,
      dates: b.dates,
      comites: b.comites,
      amende: b.amende,
      sponsor: b.parrain,
      url,
      urlEn: url,
      notesUrl,
      textSource: 'texte tel que déposé en première lecture (PDF) ; l\'Assemblée ne réimprime pas un projet amendé',
      sources: [...b.sources],
      summary: null,
      summaryEn: null,
    });
  }

  writeFileSync(OUT_PATH, JSON.stringify({
    source: 'Procès-verbaux (Votes and Proceedings) de l\'Assemblée législative de la Saskatchewan',
    legislature: LEGISLATURE,
    scrapedAt: new Date().toISOString(),
    count: bills.length,
    bills,
  }, null, 2) + '\n');

  const compte = (f) => bills.filter(f).length;
  console.log(`${bills.length} projets de loi écrits dans ${OUT_PATH} (${sessions.join(', ')})`);
  console.log(`  sanctionnés ${compte((b) => b.status === 'sanctionne')}, en cours ${compte((b) => b.status === 'encours')}, morts au Feuilleton ${compte((b) => b.status === 'mort')}, retirés ${compte((b) => b.status === 'retire')}, rejetés ${compte((b) => b.status === 'rejete')}`);
  console.log(`  titre français officiel : ${compte((b) => b.titleFrOfficiel)} ; notes explicatives : ${compte((b) => b.notesUrl)} ; amendés en comité : ${compte((b) => b.amende)}`);
  const sansParrain = bills.filter((b) => !b.sponsor);
  if (sansParrain.length) console.log(`  ⚠ sans parrain lu : ${sansParrain.map((b) => b.num).join(', ')}`);
}

main().catch((err) => {
  console.error('Échec du scraper bills.js :', err.message);
  process.exitCode = 1;
});
