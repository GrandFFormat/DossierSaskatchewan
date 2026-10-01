// Scraper — les résumés en langage clair, avec un RÉSUMÉ EXÉCUTIF en tête.
//
// Pour chaque projet de loi, on lit son TEXTE OFFICIEL (le PDF de l'Assemblée législative) et on
// demande à Claude, une fois par langue :
//   - un résumé exécutif : UNE phrase qui dit ce que fait le projet (c'est elle qui s'affiche
//     sur la carte, sous le titre, avant même qu'on la déplie) ;
//   - trois à sept puces en langage courant.
// Chaque langue part du texte officiel DE CETTE LANGUE quand il existe : les projets bilingues
// (une page anglaise, une page française en alternance) ont leur passe française lue dans les
// pages françaises. Les autres — la grande majorité — n'existent qu'en anglais : la passe
// française lit alors l'anglais et rédige en français, et la page le dit.
//
// Un texte de plus de MAX_SIGNES : on part des NOTES EXPLICATIVES officielles quand l'Assemblée
// en publie (elles décrivent tout le projet, article par article) ; sinon on tronque, on le dit
// au modèle et on le marque (`tronque`), pour que la page l'annonce.
//
// Ce que le résumé n'est PAS : une donnée officielle. Il est marqué, daté, et porte sur le texte
// TEL QUE DÉPOSÉ (l'Assemblée ne réimprime pas un projet amendé en comité).
//
// L'argent : rien n'est jamais repayé. Un résumé n'est refait que si le TEXTE lu a changé
// (empreinte). `--dry-run` chiffre sans dépenser, `--batch` passe par l'API Batches à moitié prix.
//
// Clé : ANTHROPIC_API_KEY dans l'environnement ou dans api.env (ignoré par git, jamais dans le
// dépôt). En local : node --env-file=<chemin>/api.env scrapers/resumes.js …
//
// Usage :
//   node scrapers/resumes.js --dry-run          ce que ça coûterait, sans rien dépenser
//   node scrapers/resumes.js --limit 4          un petit lot tout de suite (plein tarif)
//   node scrapers/resumes.js --batch            tout ce qui manque, à moitié prix
//   node scrapers/resumes.js --langue en        une seule langue

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import pdfParse from 'pdf-parse';
import { USER_AGENT } from './sk-commun.js';

const BILLS = 'data/bills.json';
const SORTIE = 'data/resumes.json';

const MODELE = 'claude-sonnet-5';
const MAX_SIGNES = 60000;
const MAX_PUCES = 7;
const MAX_JETONS_SORTIE = 900;
// Tarif de Claude Sonnet 5, en dollars US par million de jetons (vérifié le 30 sept. 2026).
// Il ne sert qu'à l'estimation AVANT de dépenser ; le coût réel imprimé à la fin vient des
// jetons que l'API déclare.
const TARIF = { entree: 2, sortie: 10 };
const RABAIS_BATCH = 0.5;

// ⚠️ La langue de sortie s'ÉCRIT, et dans le schéma de l'outil aussi (leçon de l'Ontario : avec
// un schéma en français, des résumés demandés en anglais revenaient en français).
const CONSIGNES = {
  en: `Write everything in ENGLISH, whatever language the supplied text is in.

You write plain-language summaries of Saskatchewan bills for an independent citizen website, for readers in a hurry or who struggle with long blocks of text.

Format:
- resumeExecutif: ONE sentence, at most 30 words, that tells a reader what the bill does. Start with a verb ("Creates…", "Changes…", "Requires…"). No jargon, no bill number, no title.
- puces: between 3 and ${MAX_PUCES} bullets. Never more than ${MAX_PUCES}, however complex the bill: keep the ones that matter most to the public. One concrete idea per bullet, ordinary words, about fifteen words maximum. No introduction, no conclusion.

Substance:
- Summarise ONLY what the supplied text actually says. Never invent, never infer, never add context from your own knowledge.
- Stay neutral: no value judgement (good/bad, welcome/controversial), no opinion, no verdict on anyone.
- Do not describe the legislative process (readings, committee, assent) — the site already shows that. Say what the bill DOES.
- Prefer concrete changes that reach people — amounts, obligations, prohibitions, new bodies, dates — over legal machinery.
- Never recompute or round a figure: copy it as the text gives it.
- If the text is procedural, too short or too technical to summarise honestly, set sansContenu to true, leave resumeExecutif empty and return no bullets. That is a valid answer, and a better one than padding.`,
  fr: `Rédige tout en FRANÇAIS, quelle que soit la langue du texte fourni.

Tu rédiges des résumés en langage clair de projets de loi de la Saskatchewan pour un site citoyen indépendant, destinés à des lecteurs pressés ou qui ont de la difficulté avec les longs blocs de texte.

Format :
- resumeExecutif : UNE phrase, 30 mots au plus, qui dit à un lecteur ce que fait le projet. Commence par un verbe (« Crée… », « Modifie… », « Oblige… »). Pas de jargon, pas de numéro de projet, pas de titre.
- puces : entre 3 et ${MAX_PUCES} puces. Jamais plus de ${MAX_PUCES}, même pour un projet complexe : garde celles qui comptent le plus pour le public. Une seule idée concrète par puce, des mots ordinaires, une quinzaine de mots au maximum. Pas d'introduction, pas de conclusion.

Sur le fond :
- Résume UNIQUEMENT ce que le texte fourni dit vraiment. N'invente rien, ne déduis rien, n'ajoute rien qui vienne de tes connaissances.
- Reste neutre : aucun jugement de valeur (bon/mauvais, attendu/controversé), aucune opinion, aucun verdict sur quiconque.
- Ne décris pas le processus législatif (lectures, comité, sanction) — le site le montre déjà. Dis ce que le projet FAIT.
- Privilégie les changements concrets qui touchent les gens — montants, obligations, interdictions, nouveaux organismes, dates — plutôt que la mécanique juridique.
- Ne recalcule et n'arrondis jamais un chiffre : recopie-le tel que le texte le donne.
- Les noms de lois, d'organismes et de lieux de la Saskatchewan restent tels qu'ils sont écrits quand ils n'ont pas de nom français officiel dans le texte.
- Si le texte est procédural, trop court ou trop technique pour être résumé honnêtement, mets sansContenu à vrai, laisse resumeExecutif vide et ne renvoie aucune puce. C'est une réponse valable, et meilleure qu'un remplissage.`,
};

const outil = (langue) => {
  const fr = langue === 'fr';
  // `strict` : l'API garantit que la réponse respecte le schéma (des puces en vraie liste).
  // Sans lui, il est arrivé qu'une passe française rende une réponse inutilisable (n° 27).
  return {
    name: 'resume',
    description: fr ? 'Rend le résumé du projet de loi, rédigé en français.' : 'Returns the summary of the bill, written in English.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        resumeExecutif: { type: 'string', description: fr ? 'UNE phrase, EN FRANÇAIS, qui dit ce que fait le projet.' : 'ONE sentence, IN ENGLISH, saying what the bill does.' },
        puces: { type: 'array', items: { type: 'string' }, description: fr ? `De 3 à ${MAX_PUCES} puces, EN FRANÇAIS, sans tiret en début de ligne.` : `3 to ${MAX_PUCES} bullets, IN ENGLISH, with no leading dash.` },
        sansContenu: { type: 'boolean', description: fr ? 'Vrai si le texte ne permet pas un résumé honnête.' : 'True if the text does not allow an honest summary.' },
      },
      required: ['resumeExecutif', 'puces', 'sansContenu'],
    },
  };
};

function argument(nom, defaut = null) {
  const i = process.argv.indexOf(`--${nom}`);
  if (i === -1) return defaut;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function chargerCle() {
  if (process.env.ANTHROPIC_API_KEY) return;
  if (!existsSync('api.env')) return;
  for (const ligne of readFileSync('api.env', 'utf-8').split(/\r?\n/)) {
    const m = /^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/.exec(ligne);
    if (m) { process.env.ANTHROPIC_API_KEY = m[1].replace(/^["']|["']$/g, ''); return; }
  }
}

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const empreinte = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// Le texte d'un PDF, page par page (pdf-parse sépare les pages par \f grâce à pagerender).
async function lirePdf(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
  const tampon = Buffer.from(await res.arrayBuffer());
  const pages = [];
  await pdfParse(tampon, {
    pagerender: async (page) => {
      const contenu = await page.getTextContent();
      const t = contenu.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
      pages.push(t);
      return t;
    },
  });
  return pages;
}

// Une page d'un projet bilingue est en anglais ou en français : on compte les petits mots.
function languePage(t) {
  const fr = (t.match(/\b(le|la|les|des|du|est|sont|modifiée?s?|par|dans|loi)\b/gi) || []).length;
  const en = (t.match(/\b(the|of|and|is|amended|by|in|act)\b/gi) || []).length;
  return fr > en ? 'fr' : 'en';
}

// Le texte à résumer, pour une langue : { texte, source: 'texte'|'notes'|'texte-anglais', tronque }.
async function texteSource(bill, langue, cachePdf) {
  if (!cachePdf.has(bill.url)) cachePdf.set(bill.url, await lirePdf(bill.url));
  const pages = cachePdf.get(bill.url);
  const bilingue = Boolean(bill.titleFrOfficiel);
  let choisies = pages;
  let source = 'texte';
  if (bilingue) {
    choisies = pages.filter((p) => languePage(p) === langue);
    if (!choisies.length) choisies = pages;
  } else if (langue === 'fr') {
    source = 'texte-anglais';   // pas de version française officielle : on lit l'anglais
  }
  let texte = choisies.join('\n\n');
  if (texte.length > MAX_SIGNES && bill.notesUrl) {
    const notes = (await lirePdf(bill.notesUrl)).join('\n\n');
    if (notes.length <= MAX_SIGNES) return { texte: notes, source: 'notes', tronque: false };
    return { texte: notes.slice(0, MAX_SIGNES), source: 'notes', tronque: true };
  }
  if (texte.length > MAX_SIGNES) return { texte: texte.slice(0, MAX_SIGNES), source, tronque: true };
  return { texte, source, tronque: false };
}

function messageUtilisateur(bill, langue, t) {
  const fr = langue === 'fr';
  const titre = fr && bill.titleFrOfficiel ? bill.titleFrOfficiel : bill.title;
  const quoi = t.source === 'notes'
    ? (fr ? 'Notes explicatives officielles (le texte du projet est trop long pour être lu en entier)' : 'Official explanatory notes (the bill text itself is too long to read in full)')
    : (fr ? 'Texte du projet de loi tel que déposé' : 'Text of the bill as introduced');
  const coupe = t.tronque
    ? (fr ? `\n[Texte tronqué aux ${MAX_SIGNES} premiers signes — le document est plus long.]` : `\n[Text truncated to the first ${MAX_SIGNES} characters — the document is longer.]`)
    : '';
  return `${fr ? 'Projet de loi' : 'Bill'} ${bill.num} — ${titre}\n${quoi}${coupe}\n\n${t.texte}`;
}

const parametres = (item) => ({
  model: MODELE,
  max_tokens: MAX_JETONS_SORTIE,
  system: CONSIGNES[item.langue],
  tools: [outil(item.langue)],
  tool_choice: { type: 'tool', name: 'resume' },
  messages: [{ role: 'user', content: item.message }],
});

// Les puces arrivent normalement en liste ; il est arrivé (n° 27, en français) qu'elles
// reviennent en une seule chaîne, une puce par ligne. On accepte les deux, rien d'autre.
function lirePuces(brut) {
  let valeur = brut;
  if (typeof valeur === 'string' && valeur.trim().startsWith('[')) {
    try { valeur = JSON.parse(valeur); } catch { /* on la découpe en lignes plus bas */ }
  }
  const liste = Array.isArray(valeur) ? valeur
    : typeof valeur === 'string' ? valeur.split(/\r?\n/)
      : [];
  return liste.map((p) => String(p).replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean).slice(0, MAX_PUCES);
}

function ranger(cache, item, reponse) {
  const bloc = reponse?.content?.find((c) => c.type === 'tool_use')?.input ?? null;
  if (!bloc) return false;
  const puces = bloc.sansContenu ? [] : lirePuces(bloc.puces);
  if (!bloc.sansContenu && (!puces.length || !String(bloc.resumeExecutif || '').trim())) {
    console.warn(`  n° ${item.bill.num} (${item.langue}) : réponse incomplète, non gardée — ${JSON.stringify(bloc).slice(0, 300)}`);
    return false;
  }
  (cache.resumes[item.bill.id] ??= {})[item.langue] = {
    resumeExecutif: bloc.sansContenu ? '' : String(bloc.resumeExecutif || '').trim(),
    puces,
    sansContenu: !!bloc.sansContenu,
    source: item.source,
    tronque: item.tronque,
    empreinte: item.empreinte,
    modele: MODELE,
    genereLe: new Date().toISOString(),
    jetons: reponse.usage ? { entree: reponse.usage.input_tokens, sortie: reponse.usage.output_tokens } : null,
  };
  return true;
}

async function main() {
  const { bills } = JSON.parse(readFileSync(BILLS, 'utf-8'));
  const cache = existsSync(SORTIE) ? JSON.parse(readFileSync(SORTIE, 'utf-8')) : { resumes: {} };
  cache.resumes ??= {};

  const langueDemandee = argument('langue');
  const langues = langueDemandee === 'en' || langueDemandee === 'fr' ? [langueDemandee] : ['en', 'fr'];
  const batch = process.argv.includes('--batch');
  const sec = process.argv.includes('--dry-run');
  const limite = Number(argument('limit', 0)) || Infinity;
  const seul = argument('bill');   // --bill 606 : un seul projet (essais)

  // 1. Les textes (gratuit) : on les lit tous avant de dépenser quoi que ce soit.
  console.log('Lecture des textes officiels (legassembly.sk.ca)…');
  const cachePdf = new Map();
  const aFaire = [];
  let lus = 0;
  for (const bill of bills) {
    if (seul && String(bill.num) !== String(seul)) continue;
    for (const langue of langues) {
      if (aFaire.length >= limite) break;
      let t;
      try { t = await texteSource(bill, langue, cachePdf); }
      catch (err) { console.warn(`  n° ${bill.num} (${langue}) : ${err.message}`); continue; }
      if (!t.texte || t.texte.length < 200) { console.warn(`  n° ${bill.num} (${langue}) : texte trop court, sauté`); continue; }
      const e = empreinte(`${t.source}|${t.texte}`);
      if (cache.resumes[bill.id]?.[langue]?.empreinte === e) continue;   // déjà fait, texte inchangé
      aFaire.push({ bill, langue, ...t, empreinte: e, message: messageUtilisateur(bill, langue, t) });
    }
    if (!cachePdf.has('__compte') && ++lus % 20 === 0) console.log(`  ${lus}/${bills.length}`);
    await pause(300);
  }

  // 2. L'estimation.
  const entree = aFaire.reduce((n, x) => n + Math.ceil(x.message.length / 4) + 700, 0);
  const sortie = aFaire.length * 350;
  const rabais = batch ? RABAIS_BATCH : 1;
  const estime = ((entree / 1e6) * TARIF.entree + (sortie / 1e6) * TARIF.sortie) * rabais;
  console.log(`${aFaire.length} résumé(s) à faire — ~${entree.toLocaleString('fr-CA')} jetons d'entrée, ~${sortie.toLocaleString('fr-CA')} de sortie → ~${estime.toFixed(2)} $ US${batch ? ' (API Batches, moitié prix)' : ''}`);
  const parSource = {};
  for (const x of aFaire) parSource[`${x.source}${x.tronque ? ' (tronqué)' : ''}`] = (parSource[`${x.source}${x.tronque ? ' (tronqué)' : ''}`] || 0) + 1;
  console.log(`  sources : ${Object.entries(parSource).map(([s, n]) => `${s} ${n}`).join(', ') || '—'}`);
  if (sec) { console.log('--dry-run : rien n\'a été dépensé.'); return; }
  if (!aFaire.length) { console.log('Rien à faire.'); return; }

  chargerCle();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY absente — dans l\'environnement ou api.env (jamais dans le dépôt).');
  const client = new Anthropic();

  // 3. Les appels.
  let jetonsEntree = 0, jetonsSortie = 0, ecrits = 0;
  if (batch) {
    const requetes = aFaire.map((x) => ({ custom_id: `${x.bill.id}__${x.langue}`, params: parametres(x) }));
    console.log(`Envoi d'un lot de ${requetes.length} demandes à l'API Batches…`);
    const lot = await client.messages.batches.create({ requests: requetes });
    console.log(`  lot ${lot.id} — on attend (quelques minutes, parfois plus).`);
    let etat = lot;
    while (etat.processing_status !== 'ended') {
      await pause(30000);
      etat = await client.messages.batches.retrieve(lot.id);
      const c = etat.request_counts;
      console.log(`  ${c.succeeded} réussies, ${c.errored} en erreur, ${c.processing} en cours…`);
    }
    const parId = new Map(aFaire.map((x) => [`${x.bill.id}__${x.langue}`, x]));
    for await (const res of await client.messages.batches.results(lot.id)) {
      const item = parId.get(res.custom_id);
      if (!item || res.result.type !== 'succeeded') { console.warn(`  ${res.custom_id} : ${res.result.type}`); continue; }
      const m = res.result.message;
      jetonsEntree += m.usage.input_tokens; jetonsSortie += m.usage.output_tokens;
      if (ranger(cache, item, m)) ecrits++;
    }
  } else {
    for (const [i, item] of aFaire.entries()) {
      try {
        const m = await client.messages.create(parametres(item));
        jetonsEntree += m.usage.input_tokens; jetonsSortie += m.usage.output_tokens;
        if (ranger(cache, item, m)) ecrits++;
      } catch (err) {
        console.warn(`  n° ${item.bill.num} (${item.langue}) : ${err.message}`);
      }
      if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${aFaire.length}`);
    }
  }

  const cout = ((jetonsEntree / 1e6) * TARIF.entree + (jetonsSortie / 1e6) * TARIF.sortie) * rabais;
  cache.modele = MODELE;
  cache.avertissementEn = 'Written by AI from the bill as introduced (official PDF on legassembly.sk.ca), not from the law as amended since. Not an official document.';
  cache.avertissementFr = 'Rédigé par une IA à partir du projet de loi tel que déposé (PDF officiel sur legassembly.sk.ca), et non de la loi telle qu\'amendée depuis. Ce n\'est pas un document officiel.';
  cache.maj = new Date().toISOString();
  cache.nombre = Object.keys(cache.resumes).length;
  cache.coutCumule = Number(((cache.coutCumule ?? 0) + cout).toFixed(4));
  writeFileSync(SORTIE, JSON.stringify(cache, null, 1) + '\n');
  console.log(`${ecrits} résumé(s) écrits dans ${SORTIE} — ${jetonsEntree.toLocaleString('fr-CA')} jetons d'entrée, ${jetonsSortie.toLocaleString('fr-CA')} de sortie → ${cout.toFixed(3)} $ US cette fois, ${cache.coutCumule.toFixed(3)} $ en tout.`);
}

main().catch((err) => {
  console.error('Échec du scraper resumes.js :', err.message);
  process.exitCode = 1;
});
