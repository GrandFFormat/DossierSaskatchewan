// Fabrique l'icône et l'image de partage du design « tuiles », avec Chromium (Playwright).
//
//   commun/sk.svg                       l'icône vectorielle (onglet du navigateur)
//   commun/sk-48.png, sk-180.png, sk-512.png
//   favicon.ico                         un .ico qui contient le PNG de 48 px
//   dossier-saskatchewan-cover.png      l'image de partage, 1702 × 630 (Facebook, X, iMessage…)
//
// Les tuiles de l'image de partage sont tirées de la même graine et des mêmes couleurs que
// celles de l'accueil (commun/dq.js, renderTuiles) : le même champ, partout.
//
// Usage : node scripts/fabriquer-images.mjs

import { writeFileSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// L'icône : le carré vert du logo, l'œil lime au milieu (le même dessin que dans l'en-tête).
const ICONE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">
  <rect width="36" height="36" rx="9" fill="#16A34A"/>
  <path d="M7 18c3.2-5.3 7-8 11-8s7.8 2.7 11 8c-3.2 5.3-7 8-11 8s-7.8-2.7-11-8z" fill="#D9F99D"/>
  <circle cx="18" cy="18" r="3.6" fill="#16A34A"/>
</svg>
`;

function tuiles(nombre) {
  const COULEURS = ['#14532D', '#166534', '#16A34A', '#4D7C0F', '#65A30D', '#84CC16', '#BEF264', '#D9F99D', '#CA8A04'];
  const POIDS = [3, 2, 2, 2, 2, 2, 2, 1, 1];
  const sac = COULEURS.flatMap((c, i) => Array(POIDS[i]).fill(c));
  let graine = 1905;
  const hasard = () => { graine = (graine * 16807) % 2147483647; return (graine - 1) / 2147483646; };
  let html = '';
  for (let i = 0; i < nombre; i++) html += `<span style="background:${sac[Math.floor(hasard() * sac.length)]}"></span>`;
  return html;
}

const COUVERTURE = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400..700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0}
  body{width:1702px;height:630px;background:#fff;font-family:Onest,sans-serif;position:relative;overflow:hidden}
  .texte{position:absolute;left:80px;top:70px;width:860px}
  .marque{display:flex;align-items:center;gap:16px;font-weight:700;font-size:36px;color:#0F1F17;letter-spacing:-0.02em}
  .marque svg{width:48px;height:48px}
  h1{font-weight:600;font-size:92px;line-height:1.02;letter-spacing:-0.035em;color:#0F1F17;margin:56px 0 26px}
  h1 em{font-style:normal;color:#16A34A}
  p{font-size:27px;line-height:1.5;color:#56635B;max-width:34ch}
  .champ{position:absolute;right:60px;top:50px;width:640px;height:530px;border-radius:40px;overflow:hidden;background:#0F1F17}
  .tuiles{position:absolute;left:-20%;top:-30%;width:140%;display:grid;grid-template-columns:repeat(9,1fr);gap:11px;transform:rotate(-8deg)}
  .tuiles span{border-radius:9px;aspect-ratio:1/1}
</style></head><body>
  <div class="texte">
    <div class="marque"><span>Dossier<span style="color:#16A34A">Saskatchewan</span></span></div>
    <h1>Growing a democracy <em>you can read.</em></h1>
    <p>Bills, recorded votes and ministers, in plain language. Independent citizen site.</p>
  </div>
  <div class="champ"><div class="tuiles">${tuiles(81)}</div></div>
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
