// Rattache une inscription du registre des lobbyistes à un projet de loi — SEULEMENT quand
// l'inscription NOMME la loi en toutes lettres. Lancé après scrapers/lobbyistes.js.
//
// La règle (Martin, 6 oct. 2026) : aucun lien « à peu près ». Le registraire demande que rien
// ne soit présenté d'une façon trompeuse ; un sujet commun (« Health & Wellness ») ne prouve
// rien. Trois conditions, toutes requises :
//   1. le TITRE COMPLET du projet (sans « The », mais AVEC son année s'il en porte une) se lit,
//      mot pour mot, dans la description d'une activité de l'inscription ;
//   2. les DATES sont dites : si la version en vigueur de l'inscription a pris effet pendant que
//      le projet était devant l'Assemblée, c'est un lien « pendant ». Si elle a pris effet APRÈS
//      la sanction, elle parle de la loi en vigueur (sa mise en œuvre) : le lien est gardé mais
//      marqué `apres`, et la page affiche les deux dates. Projet mort, retiré ou rejeté : pas de
//      lien après coup. Fin prévue antérieure au dépôt : pas de lien ;
//   3. un seul projet porte ce titre dans la législature (sinon : ambigu, pas de lien).
// Un titre de moins de quatre mots est écarté : trop court pour ne pas se retrouver par hasard.
//
// Écrit `projets` sur chaque inscription de data/lobbyistes.json (num, phrase du registre), et
// data/lobby-projets.json, le même lien vu depuis le projet, que charge la page des projets.

import { readFileSync, writeFileSync } from 'node:fs';

const IN_PATH = 'data/lobbyistes.json';
const OUT_PROJETS = 'data/lobby-projets.json';

const plier = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// L'ANNÉE RESTE dans le titre : « The Credit Union Amendment Act, 2020 » (une loi de 2020, nommée
// par une inscription) n'est pas le projet 33, « The Credit Union Amendment Act, 2025 ». Vu le
// 6 oct. 2026 à la première lecture complète : sans l'année, le lien aurait été faux.
const titrePlie = (t) => plier(String(t).replace(/^The\s+/i, ''));
// La phrase du registre qui nomme la loi (pour la montrer telle quelle).
function phraseAutour(description, titre) {
  const phrases = description.split(/(?<=[.;!?])\s+/);
  return phrases.find((p) => plier(p).includes(titre)) || description;
}

const reg = JSON.parse(readFileSync(IN_PATH, 'utf8'));
const { bills } = JSON.parse(readFileSync('data/bills.json', 'utf8'));

// Les titres uniques dans la législature, assez longs pour être sûrs.
const parTitre = new Map();
for (const b of bills) {
  const t = titrePlie(b.titleEn || b.title);
  if (t.split(' ').length < 4) continue;
  parTitre.set(t, parTitre.has(t) ? null : b);   // null = titre porté par deux projets : ambigu
}
const finDuProjet = (b) => (b.dates && (b.dates.sanction || b.dates.retrait || b.dates.rejet)) || (['sanctionne', 'mort', 'retire', 'rejete'].includes(b.status) ? b.lastActivity : null);

const parProjet = {};
let liens = 0;
for (const i of reg.inscriptions) {
  delete i.projets;
  if (!i.detail) continue;
  const trouves = [];
  for (const a of i.detail.activites) {
    const d = plier(a.description);
    for (const [t, b] of parTitre) {
      if (!b || !d.includes(t)) continue;
      if (trouves.some((x) => x.num === b.num)) continue;
      const fin = finDuProjet(b);                       // null : encore devant l'Assemblée
      const effet = i.detail.effetLe || i.effetLe;
      if (!effet || !b.presentedOn) continue;           // pas de date : on ne peut rien prouver
      if (i.detail.finPrevue && i.detail.finPrevue < b.presentedOn) continue;
      // Inscription prise APRÈS la fin du projet. Si le projet est devenu loi, elle nomme LA LOI
      // (sa mise en œuvre, par exemple) : on la montre, mais étiquetée « après la sanction », avec
      // les deux dates (Martin, 6 oct. 2026 : les dentistes et les optométristes, projet 18). Si
      // le projet est mort, retiré ou rejeté, il n'y a pas de loi à nommer : pas de lien.
      const apres = Boolean(fin && effet > fin);
      if (apres && b.status !== 'sanctionne') continue;
      trouves.push({ num: b.num, legislature: b.legislature, titre: b.titleEn || b.title, phrase: phraseAutour(a.description, t), apres, sanction: apres ? fin : null });
    }
  }
  if (!trouves.length) continue;
  i.projets = trouves;
  for (const p of trouves) {
    const b = bills.find((x) => x.num === p.num);
    (parProjet[b.id] ||= []).push({ organisation: i.organisation, cabinet: i.detail.cabinet, numero: i.detail.numero, url: i.url, phrase: p.phrase, effetLe: i.detail.effetLe || i.effetLe, lu: i.lu, apres: p.apres, sanction: p.sanction });
    liens++;
  }
}
for (const id of Object.keys(parProjet)) parProjet[id].sort((a, b) => a.organisation.localeCompare(b.organisation));

writeFileSync(IN_PATH, JSON.stringify(reg, null, 1) + '\n');
writeFileSync(OUT_PROJETS, JSON.stringify({
  source: reg.source, attribution: reg.attribution, scrapedAt: reg.scrapedAt,
  regle: "Lien fait seulement quand l'inscription nomme la loi en toutes lettres et que les dates concordent (scrapers/lobby-liens.js).",
  projets: parProjet,
}, null, 1) + '\n');
console.log(`${liens} lien(s) inscription → projet de loi, sur ${Object.keys(parProjet).length} projet(s) : ${Object.entries(parProjet).map(([id, l]) => `${Number(id) % 10000} (${l.length})`).join(', ') || 'aucun'}`);
