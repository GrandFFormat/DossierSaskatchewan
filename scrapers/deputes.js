// Scraper — les 61 député·e·s (MLAs) : nom, circonscription, caucus, parti.
//
// Source : la page MLAs de l'Assemblée législative (HTML statique, un seul appel). Chaque
// rangée du tableau donne le nom (lien vers sa fiche), le caucus et la circonscription.
//
// Le parti se déduit du caucus (voir CAUCUS_VERS_PARTI dans sk-commun.js). Avant d'écrire quoi
// que ce soit, le scraper vérifie que la page dit toujours la même chose que lui :
//   - le total par caucus de l'encadré « Seats in the Legislature » = ce qu'il a compté ;
//   - la page renvoie encore vers le « Saskatchewan Party Caucus » et le « New Democratic
//     Party Caucus » (sinon, la correspondance caucus → parti n'est plus sûre) ;
//   - le premier ministre nommé en tête de page siège au caucus du gouvernement.
// Un seul écart, et il s'arrête sans rien écrire : les données de la veille restent.
//
// La région : la Saskatchewan n'a pas de régions administratives dans les données de
// l'Assemblée. Le champ reste vide (null) plutôt que deviné.

import { writeFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { ASSEMBLEE, lirePage, sansTitre, plierNom, CAUCUS_VERS_PARTI, LEGISLATURE } from './sk-commun.js';

const URL_MLAS = `${ASSEMBLEE}/mlas/`;
const OUT_PATH = 'data/deputes.json';

// Identifiant stable tiré de l'adresse de la fiche (« ?first=Chris&last=Beaudry » →
// « chris-beaudry »). Il sert à rapprocher la même personne d'une page à l'autre (courriel,
// votes) sans dépendre de la façon d'écrire le nom. L'Assemblée laisse parfois une espace de
// trop (« first=Nathaniel &last=Teed ») : on la retire.
function identifiant(href) {
  const u = new URL(href, ASSEMBLEE);
  const prenom = (u.searchParams.get('first') || '').trim();
  const nom = (u.searchParams.get('last') || '').trim();
  if (!prenom || !nom) return null;
  return plierNom(`${prenom} ${nom}`).replace(/ /g, '-');
}

async function main() {
  const html = await lirePage(URL_MLAS);
  const $ = cheerio.load(html);

  const deputes = [];
  const inconnus = [];
  $('tr').each((_, rangee) => {
    const lien = $(rangee).find('td.mla-name a[href*="member-details"]').first();
    if (!lien.length) return;
    const caucus = $(rangee).find('td.mla-party').text().replace(/\s+/g, ' ').trim();
    const circonscription = $(rangee).find('td').eq(2).text().replace(/\s+/g, ' ').trim();
    const parti = CAUCUS_VERS_PARTI[caucus];
    if (!parti) inconnus.push(`${lien.text().trim()} (« ${caucus} »)`);
    deputes.push({
      name: sansTitre(lien.text()),
      riding: circonscription,
      region: null,
      party: parti ? parti.code : null,
      partyFull: parti ? parti.nom : null,
      caucus,
      id: identifiant(lien.attr('href')),
    });
  });

  // --- Vérifications, avant toute écriture ---
  const erreurs = [];
  if (inconnus.length) erreurs.push(`caucus inconnu : ${inconnus.join(', ')}`);

  // L'encadré « Seats in the Legislature » : un petit tableau, une rangée par caucus
  // (<td>Government Caucus</td><td>34</td>), puis « Total: ». On lit cellule par cellule :
  // le texte des cellules, mis bout à bout, se colle (« Government Caucus34 »).
  const annonces = {};
  $('th:contains("Seats in the Legislature")').closest('table').find('tr').each((_, tr) => {
    const cellules = $(tr).find('td');
    if (cellules.length !== 2) return;
    const libelle = cellules.eq(0).text().replace(/\s+/g, ' ').replace(/:$/, '').trim();
    annonces[libelle] = Number(cellules.eq(1).text().trim());
  });
  for (const caucus of Object.keys(CAUCUS_VERS_PARTI)) {
    const annonce = annonces[caucus];
    const compte = deputes.filter((d) => d.caucus === caucus).length;
    if (annonce === undefined) erreurs.push(`l'encadré des sièges ne donne plus « ${caucus} »`);
    else if (annonce !== compte) erreurs.push(`${caucus} : la page annonce ${annonce}, j'en compte ${compte}`);
  }
  if (annonces.Total !== deputes.length) {
    erreurs.push(`total : la page annonce ${annonces.Total ?? '?'}, j'en compte ${deputes.length}`);
  }

  // La correspondance caucus → parti tient-elle encore ?
  const liens = $('a').map((_, a) => $(a).text().replace(/\s+/g, ' ').trim()).get();
  for (const attendu of ['Saskatchewan Party Caucus', 'New Democratic Party Caucus']) {
    if (!liens.includes(attendu)) erreurs.push(`la page ne renvoie plus vers « ${attendu} »`);
  }

  // Le premier ministre et le président de l'Assemblée, nommés en tête de page : un lien vers la
  // fiche, puis le rôle en gras dans la même cellule (<strong>Premier</strong>, <strong>Speaker</strong>).
  // Le président ne vote pas (seulement pour départager une égalité) : la page des ministres le
  // sort du calcul de présence aux votes. On le lit ici plutôt que de l'écrire à la main.
  let nomPremier = null, nomPresident = null;
  $('a[href*="member-details"]').each((_, a) => {
    const role = $(a).closest('td').find('strong').first().text().replace(/\s+/g, ' ').trim();
    if (role === 'Premier' && !nomPremier) nomPremier = sansTitre($(a).text());
    if (role === 'Speaker' && !nomPresident) nomPresident = sansTitre($(a).text());
  });
  const president = deputes.find((d) => plierNom(d.name) === plierNom(nomPresident));
  if (!president) erreurs.push(`président de l'Assemblée introuvable dans la liste (« ${nomPresident ?? 'aucun'} »)`);
  else president.role = 'speaker';
  const premier = deputes.find((d) => plierNom(d.name) === plierNom(nomPremier));
  if (!premier) erreurs.push(`premier ministre introuvable dans la liste (« ${nomPremier ?? 'aucun'} »)`);
  else if (premier.caucus !== 'Government Caucus') erreurs.push(`le premier ministre (${premier.name}) n'est pas au caucus du gouvernement`);

  const sansId = deputes.filter((d) => !d.id);
  if (sansId.length) erreurs.push(`sans identifiant : ${sansId.map((d) => d.name).join(', ')}`);

  if (erreurs.length) {
    console.error(`deputes.js : ${erreurs.length} vérification(s) échouée(s) — rien n'est écrit :`);
    for (const e of erreurs) console.error(`  ✗ ${e}`);
    process.exitCode = 1;
    return;
  }

  writeFileSync(OUT_PATH, JSON.stringify({
    source: URL_MLAS,
    legislature: LEGISLATURE,
    scrapedAt: new Date().toISOString(),
    count: deputes.length,
    deputes,
  }, null, 2) + '\n');

  const parParti = {};
  for (const d of deputes) parParti[d.party] = (parParti[d.party] || 0) + 1;
  console.log(`${deputes.length} député·e·s écrit·e·s dans ${OUT_PATH} — ${Object.entries(parParti).map(([p, n]) => `${p} ${n}`).join(', ')}`);
  console.log(`  premier ministre : ${premier.name} (${premier.riding}) ; président de l'Assemblée : ${president.name}`);
}

main().catch((err) => {
  console.error('Échec du scraper deputes.js :', err.message);
  process.exitCode = 1;
});
