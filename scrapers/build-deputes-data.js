// Injecte data/deputes.json dans gabarit.html, entre les marqueurs
// DEPUTES_DATA_START / DEPUTES_DATA_END (le tableau `deputesRaw`).

import { readFileSync, writeFileSync } from 'node:fs';

const IN_PATH = 'data/deputes.json';
const HTML_PATH = 'gabarit.html';   // le MODÈLE, jamais servi : les pages en sont tirées
const START_MARKER = '/* DEPUTES_DATA_START';
const END_MARKER = '/* DEPUTES_DATA_END */';

function main() {
  const data = JSON.parse(readFileSync(IN_PATH, 'utf-8'));

  const rows = data.deputes
    .map((d) => JSON.stringify([d.name, d.riding, d.region ?? '', d.party ?? '', d.id ?? null, d.role ?? null]))
    .join(',');

  const html = readFileSync(HTML_PATH, 'utf-8');
  const startIdx = html.indexOf(START_MARKER);
  const endIdx = html.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Marqueurs DEPUTES_DATA_START/END introuvables dans ${HTML_PATH}`);
  }

  const block = `${START_MARKER} — généré automatiquement par scrapers/build-deputes-data.js à partir\n   de data/deputes.json (voir scrapers/deputes.js), lu chaque jour sur la page MLAs de\n   l'Assemblée législative de la Saskatchewan. Région vide : l'Assemblée n'en donne pas.\n   L'identifiant (5e valeur, « chris-beaudry ») vient de l'adresse de la fiche : il sert à\n   rapprocher la même personne d'une page à l'autre sans dépendre de la graphie du nom.\n   [Nom, Circonscription, Région, Parti, Identifiant, Rôle (« speaker » pour le président)]. Ne pas éditer ce bloc à la main.\n   Généré le ${new Date().toISOString()} */\nconst deputesRaw = [\n${rows}\n];\n`;

  const updated = html.slice(0, startIdx) + block + html.slice(endIdx);
  writeFileSync(HTML_PATH, updated);
  console.log(`${data.deputes.length} député·e·s injecté·e·s dans ${HTML_PATH}`);
}

main();
