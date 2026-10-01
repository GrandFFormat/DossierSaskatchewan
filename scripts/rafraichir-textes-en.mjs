// Recopie, dans le HTML du gabarit, la version ANGLAISE de chaque texte traduit (data-i18n),
// telle qu'elle est écrite dans le dictionnaire de commun/dq.js.
//
// Pourquoi : le site est anglophone, son HTML est donc écrit en anglais (c'est ce que lisent les
// moteurs de recherche, et ce qui s'affiche avant que le JavaScript tourne). Le dictionnaire, lui,
// fait foi. Après avoir changé une clé anglaise du dictionnaire, on lance ce script pour que le
// HTML suive, puis scripts/build-section-pages.js.
//
// Usage : node scripts/rafraichir-textes-en.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const lignes = readFileSync('commun/dq.js', 'utf8').split('\n');
const debut = lignes.findIndex((l) => l.startsWith('const translations = {'));
const fin = lignes.findIndex((l, i) => i > debut && /^\};/.test(l));
const translations = new Function(lignes.slice(debut, fin + 1).join('\n') + '\nreturn translations;')();

let html = readFileSync('gabarit.html', 'utf8');
let changes = 0, sautes = [];
html = html.replace(/(<(\w+)(?:\s[^>]*?)?\sdata-i18n="([^"]+)"(?:\s[^>]*?)?>)([\s\S]*?)(<\/\2>)/g, (m, ouvre, balise, cle, dedans, ferme) => {
  const en = translations.en[cle];
  if (en === undefined) return m;
  // Une balise du même nom imbriquée : la découpe ne serait pas sûre, on n'y touche pas.
  if (new RegExp(`<${balise}[\\s>]`, 'i').test(dedans)) { sautes.push(cle); return m; }
  if (dedans === en) return m;
  changes++;
  return ouvre + en + ferme;
});
writeFileSync('gabarit.html', html);
console.log(`${changes} texte(s) anglais mis à jour dans gabarit.html${sautes.length ? ` ; laissés tels quels : ${sautes.join(', ')}` : ''}`);
