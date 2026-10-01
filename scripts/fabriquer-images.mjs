// Fabrique l'icône et l'image de partage du design « long lots », avec Chromium (Playwright).
//
//   commun/sk.svg                       l'icône vectorielle (onglet du navigateur)
//   commun/sk-48.png, sk-180.png, sk-512.png
//   favicon.ico                         un .ico qui contient le PNG de 48 px
//   dossier-saskatchewan-cover.png      l'image de partage, 1702 × 630 (Facebook, X, iMessage…)
//
// Les lanières de l'image de partage sont tirées de la même graine que celles de l'accueil
// (commun/dq.js, renderLots) : le même champ, partout.
//
// Usage : node scripts/fabriquer-images.mjs

import { writeFileSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const COULEURS = ['#6B8C4A', '#4E6B3D', '#8BA35E', '#A9B573', '#D4AE62', '#E3CC92', '#B87440', '#C98F57'];

// L'icône : quatre lanières et le trait bleu de la rivière, sur un carré crème aux coins doux.
const ICONE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#F4EFE3"/>
  <rect x="9" y="10" width="8" height="36" fill="#6B8C4A"/>
  <rect x="20" y="10" width="8" height="36" fill="#D4AE62"/>
  <rect x="31" y="10" width="8" height="36" fill="#B87440"/>
  <rect x="42" y="10" width="8" height="36" fill="#8BA35E"/>
  <rect x="9" y="50" width="46" height="6" fill="#3E6F9A"/>
</svg>
`;

function lanieres(nombre) {
  let graine = 1885;
  const hasard = () => { graine = (graine * 16807) % 2147483647; return (graine - 1) / 2147483646; };
  let html = '';
  for (let i = 0; i < nombre; i++) {
    const largeur = 1 + Math.floor(hasard() * 3);
    const morceaux = 1 + Math.floor(hasard() * 3);
    let reste = 100, lots = '';
    for (let k = 0; k < morceaux; k++) {
      const h = k === morceaux - 1 ? reste : Math.round(reste * (0.3 + hasard() * 0.4));
      reste -= h;
      lots += `<span style="flex:${h} 1 0;background:${COULEURS[Math.floor(hasard() * COULEURS.length)]}"></span>`;
    }
    html += `<div class="l" style="flex:${largeur} 1 0">${lots}</div>`;
  }
  return html;
}

const COUVERTURE = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500..800&family=Karla:wght@400..700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0}
  body{width:1702px;height:630px;background:#E9DFC6;font-family:Karla,sans-serif;position:relative;overflow:hidden}
  .champ{position:absolute;inset:0 0 120px 0;display:flex;gap:4px}
  .l{display:flex;flex-direction:column;gap:4px}
  .l span{display:block}
  .rive{position:absolute;left:0;right:0;bottom:110px;height:10px;background:#E9DFC6}
  .riviere{position:absolute;left:0;right:0;bottom:0;height:110px;background:#3E6F9A;display:flex;align-items:center;justify-content:flex-end;padding:0 64px}
  .riviere span{font-family:Fraunces,serif;font-style:italic;font-weight:600;font-size:34px;color:#F4EFE3}
  .carte{position:absolute;left:72px;top:64px;width:880px;background:#fff;border-radius:8px;padding:46px 54px 50px;box-shadow:0 14px 40px rgba(30,42,36,.18)}
  .marque{display:flex;align-items:center;gap:14px;font-family:Fraunces,serif;font-weight:700;font-size:34px;color:#1E2A24}
  .marque svg{width:46px;height:34px}
  h1{font-family:Fraunces,serif;font-weight:800;font-size:76px;line-height:1.02;letter-spacing:-0.025em;color:#1E2A24;margin:26px 0 20px}
  p{font-size:25px;line-height:1.5;color:#5E665F;max-width:36ch}
</style></head><body>
  <div class="champ">${lanieres(61)}</div>
  <div class="rive"></div>
  <div class="riviere"><span>South Saskatchewan River</span></div>
  <div class="carte">
    <div class="marque"><svg viewBox="0 0 40 28"><rect x="0" y="0" width="5" height="26" fill="#6B8C4A"/><rect x="8" y="0" width="5" height="26" fill="#D4AE62"/><rect x="16" y="0" width="5" height="26" fill="#B87440"/><rect x="24" y="0" width="5" height="26" fill="#8BA35E"/><rect x="32" y="20" width="8" height="6" fill="#3E6F9A"/></svg>Dossier Saskatchewan</div>
    <h1>The Legislative Assembly, lot by lot.</h1>
    <p>Bills, recorded votes and ministers, in plain language. Independent citizen site.</p>
  </div>
</body></html>`;

// Un .ico n'est qu'un petit en-tête devant une image PNG (format accepté par tous les
// navigateurs depuis Windows Vista).
function ico(png, taille) {
  const tete = Buffer.alloc(22);
  tete.writeUInt16LE(0, 0); tete.writeUInt16LE(1, 2); tete.writeUInt16LE(1, 4);
  tete.writeUInt8(taille, 6); tete.writeUInt8(taille, 7); tete.writeUInt8(0, 8); tete.writeUInt8(0, 9);
  tete.writeUInt16LE(1, 10); tete.writeUInt16LE(32, 12);
  tete.writeUInt32LE(png.length, 14); tete.writeUInt32LE(22, 18);
  return Buffer.concat([tete, png]);
}

const navigateur = await chromium.launch();
try {
  writeFileSync('commun/sk.svg', ICONE);
  const page = await navigateur.newPage();
  for (const taille of [48, 180, 512]) {
    await page.setViewportSize({ width: taille, height: taille });
    await page.setContent(`<html><body style="margin:0;background:transparent">${ICONE.replace('<svg ', `<svg width="${taille}" height="${taille}" `)}</body></html>`);
    await page.screenshot({ path: `commun/sk-${taille}.png`, omitBackground: true });
  }
  writeFileSync('favicon.ico', ico(readFileSync('commun/sk-48.png'), 48));

  await page.setViewportSize({ width: 1702, height: 630 });
  await page.setContent(COUVERTURE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'dossier-saskatchewan-cover.png' });
  console.log('images faites : commun/sk.svg, sk-48/180/512.png, favicon.ico, dossier-saskatchewan-cover.png');
} finally {
  await navigateur.close();
}
