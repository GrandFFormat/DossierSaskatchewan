// Rafraîchissement TOLÉRANT des données (local ET CI).
//
// Avant, un seul scraper en échec (source bloquée, 403, panne réseau) arrêtait
// TOUT le rafraîchissement — donc aucune donnée n'était publiée, même celles des
// sources qui fonctionnaient (cf. l'échec transitoire du 2026-08-12). Désormais :
// chaque scraper est lancé à tour de rôle ; s'il échoue, on le NOTE et on
// CONTINUE. Le scraper en échec garde simplement ses données de la veille (son
// data/*.json n'est pas réécrit) et le build assemble le site avec ce qui est
// disponible.
//
// Politique de sortie :
//   - Un scraper qui échoue N'ARRÊTE PAS la chaîne (données partielles = publiables).
//   - Le garde-fou anti-corruption OU un build qui échoue EST fatal : on ne publie
//     pas un site cassé (exit 1 → le workflow saute le commit).
//   - En CI, on écrit `builds_ok` et `failed` dans $GITHUB_OUTPUT : le workflow
//     committe les données fraîches si builds_ok, PUIS marque le run en échec si
//     « failed » n'est pas vide (alerte visuelle sans perdre les données).
//
// L'étape des résumés IA (bill-summaries) reste « best effort » : traitée comme
// un scraper tolérant, un échec (clé absente, API en panne) ne bloque rien.
//
// La clé API vient de api.env en local (chargé si le fichier existe) ou des
// variables d'environnement en CI (secret GitHub) — jamais codée en dur.

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';

// Lance un script node. Lève une erreur si le code de sortie n'est pas 0.
function runOrThrow(label, nodeArgs) {
  console.log(`\n=== ${label} ===`);
  const res = spawnSync(process.execPath, nodeArgs, { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`code ${res.status}`);
}

// Saskatchewan. Pas encore de résumés IA ni de promesses (étapes à venir), pas de pétitions :
// elles sont sur papier, sans liste publiée (voir le message de la page d'accueil).
const doPetitions = false;

// 1) Scrapers (source -> data/*.json) — TOLÉRANT. L'ordre compte : les procès-verbaux ont
// besoin de la liste des député·e·s (pour lire les noms des votes), les projets de loi ont
// besoin des procès-verbaux, et les votes des projets de loi.
const SCRAPERS = [
  ['Scrape : député·e·s (legassembly.sk.ca)', ['scrapers/deputes.js']],
  ['Scrape : courriels des député·e·s (legassembly.sk.ca)', ['scrapers/depute-emails.js']],
  // saskatchewan.ca est derrière Cloudflare : si un défi arrive, ministers.js s'arrête sans
  // écrire (on ne le contourne pas) et les ministres de la veille restent.
  ['Scrape : ministres (saskatchewan.ca)', ['scrapers/ministers.js']],
  ['Scrape : procès-verbaux (legassembly.sk.ca)', ['scrapers/proces-verbaux.js']],
  ['Scrape : projets de loi (depuis les procès-verbaux)', ['scrapers/bills.js']],
  ['Scrape : votes nominatifs (depuis les procès-verbaux)', ['scrapers/votes.js']],
  // Résumés IA (payants) : seulement les projets nouveaux ou dont le texte a changé — le cache
  // (data/resumes.json) évite de repayer. « soft » : sans clé ou si l'API est en panne, le reste
  // du site se met à jour quand même, et la carte dit simplement « résumé non disponible ».
  ['Résumés IA des projets de loi (Claude Sonnet 5)', ['scrapers/resumes.js'], { soft: true }],
  // Le registre des lobbyistes (accord écrit du registraire, 6 oct. 2026) : la liste active, puis
  // SEULEMENT les fiches nouvelles ou changées, à 10 secondes d'intervalle (son robots.txt). Au
  // plus 60 fiches par passage (10 minutes) : le workflow en a 30. « soft » : si le registre ne
  // répond pas, le reste du site se met à jour et la page garde sa dernière lecture, datée.
  ['Scrape : registre des lobbyistes (sasklobbyistregistry.ca)', ['scrapers/lobbyistes.js', '--max=60'], { soft: true }],
  ['Liens registre → projets de loi (seulement quand la loi est nommée)', ['scrapers/lobby-liens.js'], { soft: true }],
];

const failed = [];      // sources critiques → déclenchent l'alerte (run rouge)
const softFailed = [];  // sources « douces » (pétitions) → juste un log, run vert
for (const [label, args, opts = {}] of SCRAPERS) {
  try {
    runOrThrow(label, args);
  } catch (e) {
    (opts.soft ? softFailed : failed).push(label);
    console.error(`⚠ « ${label} » a échoué (${e.message}) — on garde ses données précédentes et on continue.`);
  }
}

// 1.5) Garde-fou anti-corruption : refuse de publier si les données fraîches
// semblent catastrophiquement cassées (une source qui change de format et vide
// un champ pour tout le monde — déjà vu : régions des députés passées à 0).
// Seuils très bas : on n'attrape que les effondrements évidents. Un scraper qui
// a ÉCHOUÉ garde ses données de la veille → il passe ce garde-fou (normal).
function sanityCheck() {
  const arr = (path, key) => {
    try { return JSON.parse(readFileSync(path, 'utf-8'))[key] || []; }
    catch { return []; }
  };
  const deputes = arr('data/deputes.json', 'deputes');
  // Projets de loi : scrapers/bills.js ne garde que la législature la plus récente. Au premier
  // projet de la 44e (après le 17 nov. 2026), la liste passe de ~143 à 1, puis grandit : un
  // plancher fixe de 50 bloquerait TOUT le rafraîchissement pendant des semaines. Le plancher
  // suit donc la veille (git HEAD) : 1 le jour où la législature change, sinon min(50, veille).
  // Une législature qui recule, ou absente, reste suspecte.
  const bills = arr('data/bills.json', 'bills');
  let plancherBills = 50;
  try {
    const veille = JSON.parse(execFileSync('git', ['show', 'HEAD:data/bills.json'], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })).bills || [];
    const leg = bills[0]?.legislature, legVeille = veille[0]?.legislature;
    if (!leg || (legVeille && leg < legVeille)) plancherBills = Infinity;
    else if (legVeille && leg > legVeille) plancherBills = 1;
    else plancherBills = Math.max(1, Math.min(50, veille.length));
  } catch { /* pas de veille lisible : on garde 50 */ }
  // Saskatchewan : 61 sièges (quelques-uns peuvent être vacants), pas de régions, une
  // vingtaine de votes nominatifs par session seulement.
  const checks = [
    ['projets de loi', bills.length, plancherBills],
    ['député·e·s', deputes.length, 55],
    ['député·e·s avec parti', deputes.filter((d) => d.party).length, 55],
    ['votes', arr('data/votes.json', 'votes').length, 20],
    ['ministres', arr('data/ministers.json', 'ministers').length, 12],
  ];
  const failures = checks.filter(([, n, min]) => n < min);
  if (failures.length) {
    console.error('\n✖ Garde-fou : données suspectes — AUCUNE injection, aucun commit.');
    for (const [label, n, min] of failures) console.error(`   - ${label} : ${n} (minimum attendu : ${min})`);
    throw new Error('garde-fou anti-corruption déclenché');
  }
  console.log('\n✓ Garde-fou OK : ' + checks.map(([l, n]) => `${l}=${n}`).join(', '));
}

// 2) Builds (data/*.json -> gabarit.html) — FATAL : on ne publie pas un site cassé.
let publishOk = true;
try {
  sanityCheck();
  const BUILDS = [
    ['Build : projets de loi -> gabarit.html', ['scrapers/build-frontend-data.js']],
    ['Build : députés -> gabarit.html', ['scrapers/build-deputes-data.js']],
    ['Build : courriels -> gabarit.html', ['scrapers/build-depute-emails-data.js']],
    ['Build : votes -> gabarit.html', ['scrapers/build-votes-data.js']],
    ['Build : ministres -> gabarit.html', ['scrapers/build-ministers-data.js']],
    ...(doPetitions ? [['Build : pétitions -> gabarit.html (hebdo)', ['scrapers/build-petitions-data.js']]] : []),
    // Promesses électorales : données saisies à la main (data/promises.json),
    // pas scrapées. Le build tourne quand même chaque jour pour que toute
    // édition du JSON se retrouve dans la page sans étape manuelle.
    ['Build : promesses -> gabarit.html', ['scrapers/build-promises-data.js']],
    // « Quoi de neuf » dérivé des projets de loi et des votes déjà scrapés —
    // APRÈS eux, donc, pour refléter les données du jour.
    ['Build : quoi de neuf -> gabarit.html', ['scrapers/build-news-data.js']],
    // Pages de section pré-rendues (SEO) : APRÈS toutes les injections ci-dessus.
    ['Build : les 7 pages, depuis gabarit.html', ['scripts/build-section-pages.js']],
  ];
  for (const [label, args] of BUILDS) runOrThrow(label, args);
} catch (e) {
  publishOk = false;
  console.error(`\n✖ Étape critique échouée (${e.message}) — rien ne sera publié.`);
}

console.log('\n──────── Résumé du rafraîchissement ────────');
console.log(`  scrapers critiques en échec : ${failed.length ? failed.join(' | ') : 'aucun'}`);
console.log(`  sources douces en échec     : ${softFailed.length ? softFailed.join(' | ') : 'aucune'} (garde les données de la veille, pas d'alerte)`);
console.log(`  garde-fou + build           : ${publishOk ? 'OK' : 'ÉCHEC'}`);

// Sorties pour GitHub Actions (ignorées en local, où $GITHUB_OUTPUT n'existe pas).
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `builds_ok=${publishOk}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `failed=${failed.join(' | ')}\n`);
}

// Fatal UNIQUEMENT si le garde-fou/build a cassé. Un scraper raté ne fait pas
// échouer ce process (sinon l'étape de commit serait sautée et on ne publierait
// pas les données fraîches des autres) : c'est le workflow qui transforme
// « failed » en échec de run APRÈS le commit, pour l'alerte.
process.exit(publishOk ? 0 : 1);
