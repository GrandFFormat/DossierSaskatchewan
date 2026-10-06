// Scraper — le registre des lobbyistes de la Saskatchewan (Office of the Registrar of Lobbyists).
//
// AVEC L'ACCORD ÉCRIT DU BUREAU (registraire adjointe, 6 oct. 2026) : « we have no objection to
// you collecting information that is publicly available through the website ». Ses conditions,
// que ce fichier et la page du site appliquent :
//   - la source est attribuée au « Saskatchewan Lobbyist Registry », avec un lien vers la fiche ;
//   - rien ne laisse croire que le registraire appuie le site ;
//   - l'information est montrée telle qu'elle était À LA LECTURE, dont la date est gardée (`lu`)
//     et affichée ; elle est relue régulièrement ;
//   - rien n'est altéré d'une façon qui la rendrait trompeuse ;
//   - la lecture ne doit pas nuire au site : 10 secondes entre deux pages (son robots.txt le
//     demande : Crawl-delay: 10), une page à la fois, et seulement ce qui a changé.
//
// Le chemin est celui d'un visiteur : la page « Search The Registry » demande sa liste à
// forms.sasklobbyistregistry.ca/api/Search/RegistrationVersions (50 inscriptions à la fois, les
// actives par défaut) ; chaque inscription a ensuite sa fiche en HTML.
//
// Ce qu'on GARDE d'une fiche : l'organisation, le type, les dates, le cabinet-conseil, ce qui
// est demandé (description, sujets, catégories) et les titulaires de charge publique visés
// (ministères, ministres, député·e·s). Ce qu'on NE garde PAS : les adresses, les noms des
// lobbyistes eux-mêmes et ceux du personnel politique. Ils restent sur la fiche officielle, à
// un clic ; les recopier n'ajouterait rien à ce que le site veut montrer (qui parle de quoi,
// à qui).
//
// Une fiche déjà lue n'est relue que si sa version ou sa date d'effet a changé. Une inscription
// qui n'est plus dans la liste active est retirée : le fichier reflète le registre à la lecture.
//
// Usage : node scrapers/lobbyistes.js            (tout ce qui est nouveau ou changé)
//         node scrapers/lobbyistes.js --max=20   (au plus 20 fiches ce passage-ci)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { USER_AGENT } from './sk-commun.js';

const SITE = 'https://www.sasklobbyistregistry.ca';
const API = 'https://forms.sasklobbyistregistry.ca/api/Search/RegistrationVersions';
const OUT_PATH = 'data/lobbyistes.json';
const DELAI_MS = 10_000;   // Crawl-delay: 10 (robots.txt de sasklobbyistregistry.ca)
const PAR_PAGE = 50;       // la taille de page de l'outil officiel
const max = Number((process.argv.find((a) => a.startsWith('--max=')) || '').split('=')[1]) || Infinity;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const propre = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
let derniere = 0;
async function poliment() {
  const attente = derniere + DELAI_MS - Date.now();
  if (attente > 0) await pause(attente);
  derniere = Date.now();
}

// La liste, comme la page la demande (mêmes champs, mêmes statuts par défaut : les actives).
async function lireListe(start) {
  await poliment();
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      EffectiveDate: [], PostedDate: [], Keywords: '', DescriptionOfLobbyingActivities: '', Lobbyists: '',
      ClientOrganization: '', EffectiveFromDate: '', EffectiveToDate: '', PostedFromDate: '', PostedToDate: '',
      MLA: [], Minister: [], GovernmentInstitution: [], SubjectMatter: [], Category: [],
      RegistrationStatus: ['1', '165790006'],
      start, length: PAR_PAGE, draw: 1 + start / PAR_PAGE, ordercolumn: 5, orderdirection: 'desc',
    }),
  });
  if (!res.ok) throw new Error(`liste (start=${start}) : HTTP ${res.status} — on n'insiste pas`);
  return res.json();
}

async function lireFiche(url) {
  await poliment();
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  const html = await res.text();
  // Un vrai défi Cloudflare arrive en 403/503 avec le titre « Just a moment… ». (Le script
  // « challenge-platform » seul ne veut rien dire : Cloudflare le pose sur les pages normales.)
  if (!res.ok || /<title>\s*Just a moment/i.test(html)) throw new Error(`${url} : HTTP ${res.status}${res.ok ? ' (défi anti-robot — on ne le contourne pas)' : ''}`);
  return html;
}

// Les catégories du registre (filtre « Category » de la page de recherche, lu le 6 oct. 2026).
// Deux d'entre elles CONTIENNENT une virgule : on ne peut donc pas couper la cellule aux
// virgules. On y reconnaît les libellés connus ; ce qui reste (un libellé nouveau) est gardé
// tel quel plutôt que perdu.
const CATEGORIES = ['Contract', 'Directive, Guideline or Decision', 'Grant or Financial Benefit',
  'Legislative Proposal, Bill or Resolution', 'Order in Council', 'Program or Policy', 'Regulation'];
function decouperCategories(texte) {
  const trouvees = [];
  let reste = texte;
  for (const c of [...CATEGORIES].sort((a, b) => b.length - a.length)) {
    if (reste.includes(c)) { trouvees.push(c); reste = reste.replace(c, ''); }
  }
  reste = reste.replace(/^[\s,]+|[\s,]+$/g, '').replace(/\s*,\s*,\s*/g, ', ');
  if (reste) trouvees.push(reste);
  return CATEGORIES.filter((c) => trouvees.includes(c)).concat(trouvees.filter((c) => !CATEGORIES.includes(c)));
}

// La liste <ul> qui suit une étiquette (« Government Institutions: ») dans le panneau donné.
function listeSous($, panneau, etiquette) {
  const label = panneau.find('label').filter((_, l) => propre($(l).text()).replace(/:$/, '') === etiquette).first();
  if (!label.length) return [];
  return label.parent().find('li').map((_, li) => propre($(li).text())).get().filter((t) => t && t !== 'None');
}

function lireDetail(html) {
  const $ = cheerio.load(html);
  const panneau = (titre) => $('.panel-heading').filter((_, h) => propre($(h).text()).startsWith(titre)).first().closest('.panel');

  // L'en-tête : « Registration Number: », « Type: », « Posted Date: »…
  const champ = (etiquette) => {
    const label = $('label').filter((_, l) => propre($(l).text()).replace(/:$/, '') === etiquette).first();
    if (!label.length) return null;
    const groupe = label.parent().clone();
    groupe.find('label').remove();
    return propre(groupe.text()) || null;
  };

  // Le cabinet-conseil : son NOM seulement (première ligne), pas son adresse.
  const cabinetLabel = $('label').filter((_, l) => propre($(l).text()).startsWith('Lobbyist Consulting Firm')).first();
  let cabinet = null;
  if (cabinetLabel.length) {
    const g = cabinetLabel.parent().clone(); g.find('label').remove();
    cabinet = propre((g.html() || '').split(/<br\s*\/?>/i)[0].replace(/<[^>]+>/g, ' ')) || null;
  }

  // « What is being lobbied? » : une rangée par activité (description, sujets, catégories).
  const activites = [];
  panneau('What is being lobbied').find('table tr').each((_, tr) => {
    const td = $(tr).find('td');
    if (td.length < 3) return;
    activites.push({
      description: propre(td.eq(0).text()),
      sujets: propre(td.eq(1).text()).split(/\s*,\s*/).filter(Boolean),
      categories: decouperCategories(propre(td.eq(2).text())),
    });
  });

  // « Who is being lobbied? » : les ministères, puis « Nom - Ministère » pour chaque ministre.
  const qui = panneau('Who is being lobbied?');
  const ministres = listeSous($, qui, 'Government Ministers').map((t) => {
    const m = t.match(/^(.*?)\s+-\s+(.*)$/);
    return m ? { nom: m[1].trim(), institution: m[2].trim() } : { nom: t, institution: null };
  });
  return {
    numero: champ('Registration Number'),
    type: champ('Type'),
    statut: champ('Version Status'),
    publieLe: champ('Posted Date'),
    effetLe: champ('Effective'),
    finPrevue: champ('Projected End Date'),
    cabinet,
    activites,
    institutions: listeSous($, qui, 'Government Institutions'),
    ministres,
    deputes: listeSous($, qui, 'MLAs'),
  };
}

async function main() {
  const avant = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, 'utf8')) : { inscriptions: [] };
  const connues = new Map((avant.inscriptions || []).map((i) => [i.id, i]));

  // 1. La liste active, page par page.
  const liste = [];
  let total = null;
  for (let start = 0; total === null || start < total; start += PAR_PAGE) {
    const j = await lireListe(start);
    total = j.recordsFiltered;
    liste.push(...(j.data || []));
    if (!(j.data || []).length) break;
  }
  if (!liste.length || liste.length !== total) {
    throw new Error(`liste incomplète : ${liste.length} lues, ${total} annoncées — rien n'est écrit`);
  }
  console.log(`liste : ${liste.length} inscriptions actives (annoncées : ${total})`);

  // 2. Les fiches : seulement les nouvelles et celles dont la version ou la date a changé.
  const sortie = [];
  let lues = 0, gardees = 0, reportees = 0, panne = null;
  const ecrire = (fini) => writeFileSync(OUT_PATH, JSON.stringify({
    source: `${SITE}/search-the-registry/`,
    attribution: 'Saskatchewan Lobbyist Registry — Office of the Registrar of Lobbyists',
    scrapedAt: new Date().toISOString(),
    total,
    complet: fini,
    inscriptions: sortie,
  }, null, 1) + '\n');

  for (const l of liste) {
    const id = (String(l.Url).match(/id=([0-9a-f-]{36})/i) || [])[1];
    if (!id) throw new Error(`inscription sans identifiant : ${l.Url}`);
    const url = `${SITE}/search-the-registry/registration-details/?id=${id}`;
    const base = {
      id, url,
      organisation: propre(l.ClientOrganization),
      type: propre(l.RegistrationType),
      statut: propre(l.RegistrationStatus),
      effetLe: l.EffectiveDate || null,
      version: propre(l.Version),
    };
    const deja = connues.get(id);
    if (deja && deja.detail && deja.version === base.version && deja.effetLe === base.effetLe) {
      sortie.push({ ...deja, ...base });
      gardees++;
      continue;
    }
    // Plafond du passage atteint, ou panne en cours de route : la fiche viendra au prochain
    // passage. On garde l'ancienne lecture si on en a une (avec SA date de lecture), plutôt que rien.
    if (lues >= max || panne) {
      sortie.push(deja && deja.detail ? { ...deja, id, url } : { ...base, detail: null, lu: null });
      reportees++;
      continue;
    }
    try {
      const d = lireDetail(await lireFiche(url));
      // Garde-fou : une fiche lue doit porter son numéro et au moins une activité, sinon la page
      // a changé de forme et on s'arrête plutôt que de publier des fiches vides.
      if (!d.numero || !d.activites.length) throw new Error(`fiche illisible (${url}) : numéro « ${d.numero} », ${d.activites.length} activité(s)`);
      sortie.push({ ...base, detail: d, lu: new Date().toISOString().slice(0, 10) });
      lues++;
    } catch (err) {
      // Une panne n'efface pas les fiches déjà lues ce passage-ci : on écrit ce qu'on a, on
      // reporte le reste, et le scraper sort en erreur pour que la panne se voie.
      panne = err;
      sortie.push(deja && deja.detail ? { ...deja, id, url } : { ...base, detail: null, lu: null });
      reportees++;
      continue;
    }
    // Point de sauvegarde toutes les 10 fiches : si le passage est coupé (délai, panne de
    // courant), le suivant ne relit que ce qui manque. Le reste de la liste y est inscrit tel
    // qu'on le connaît (ancienne lecture, ou « pas encore lu »).
    if (lues % 10 === 0) {
      const rang = liste.indexOf(l);
      const reste = liste.slice(rang + 1).map((r) => {
        const rid = (String(r.Url).match(/id=([0-9a-f-]{36})/i) || [])[1];
        const vieux = connues.get(rid);
        return vieux && vieux.detail ? vieux : {
          id: rid, url: `${SITE}/search-the-registry/registration-details/?id=${rid}`,
          organisation: propre(r.ClientOrganization), type: propre(r.RegistrationType), statut: propre(r.RegistrationStatus),
          effetLe: r.EffectiveDate || null, version: propre(r.Version), detail: null, lu: null,
        };
      });
      const complet = sortie.slice();
      sortie.push(...reste); ecrire(false); sortie.length = complet.length;
      console.log(`  ${lues} fiches lues…`);
    }
  }
  ecrire(reportees === 0);
  if (panne) { console.error('lecture interrompue :', panne.message); process.exitCode = 1; }
  console.log(`${sortie.length} inscriptions écrites dans ${OUT_PATH} — ${lues} fiche(s) lue(s), ${gardees} inchangée(s), ${reportees} reportée(s)`);
}

main().catch((err) => {
  console.error('Échec du scraper lobbyistes.js :', err.message);
  process.exitCode = 1;
});
