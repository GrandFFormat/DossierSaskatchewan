// Ce que les scrapers de la Saskatchewan partagent.
//
// Règle n° 1 : jamais de donnée inventée, jamais de protection contournée. Le robot se
// présente pour ce qu'il est (USER_AGENT), et si un site répond par un défi (Cloudflare,
// CAPTCHA, 403), lirePage() lève une erreur au lieu d'insister : le scraper s'arrête sans
// écrire, et les données de la veille restent en place.

export const USER_AGENT =
  'dossier-saskatchewan-scraper/0.1 (projet citoyen independant, usage non commercial; +https://dossiersaskatchewan.ca)';

// Toujours avec « www » : legassembly.sk.ca sans www ne répond pas (vérifié le 19 sept. 2026).
export const ASSEMBLEE = 'https://www.legassembly.sk.ca';

export async function lirePage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  const texte = await res.text();
  // Un défi Cloudflare arrive en 403 ou 503, avec « cf-chl » ou « Just a moment » dans la page.
  const defi = /cf-chl|challenge-platform|Just a moment\.\.\./i.test(texte);
  if (!res.ok || defi) {
    throw new Error(`${url} : HTTP ${res.status}${defi ? ' (défi anti-robot — on ne le contourne pas)' : ''}`);
  }
  return texte;
}

// Même logique que norm() côté page : insensible aux accents, à la casse et aux tirets,
// pour rapprocher un même nom écrit un peu différemment d'une page à l'autre.
export function plierNom(nom) {
  return (nom || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-–—'’.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// « Hon. Chris Beaudry » → « Chris Beaudry » ; « Honourable Jim Reiter » → « Jim Reiter ».
export function sansTitre(nom) {
  return (nom || '')
    .replace(/\s+/g, ' ')
    .replace(/^(Hon\.|Honourable|L['’]honorable)\s+/i, '')
    .trim();
}

// L'Assemblée ne donne pas le PARTI de chaque député·e, seulement son caucus :
// « Government Caucus », « Opposition Caucus » ou « Independent ». La correspondance vient de
// l'Assemblée elle-même : son plan de la Chambre (/media/i0mfyimz/seatingplan.pdf) marque
// chaque siège « Saskatchewan Party Caucus Member » ou « New Democratic Party Caucus Member »,
// et sa page MLAs renvoie vers les deux caucus sous ces noms.
//
// Elle ne vaut que pour la 30e législature : après une élection, le gouvernement peut changer
// de parti. deputes.js vérifie donc, à chaque passage, que la page renvoie encore vers ces deux
// caucus et que le premier ministre siège bien au caucus du gouvernement ; sinon il s'arrête
// plutôt que d'étiqueter tout le monde du mauvais parti.
export const LEGISLATURE = 30;
export const CAUCUS_VERS_PARTI = {
  'Government Caucus': { code: 'SKP', nom: 'Saskatchewan Party' },
  'Opposition Caucus': { code: 'NDP', nom: 'Saskatchewan New Democratic Party' },
  'Independent': { code: 'IND', nom: 'Independent' },
};
