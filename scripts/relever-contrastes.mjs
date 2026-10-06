// Relevé des contrastes, page par page, dans un thème : node scripts/relever-contrastes.mjs [dark|light]
// (le serveur local doit tourner sur le port 8131). Liste les textes sous un ratio de 3:1.
import { chromium } from 'playwright';
const THEME = process.argv[2] === 'light' ? 'light' : 'dark';
const PAGES = ['/', '/ministres', '/projets-de-loi', '/votes', '/promesses', '/lobbyisme', '/lexique', '/regles', '/sources', '/mon-dossier'];
const nav = await chromium.launch();
const page = await nav.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript((t) => { try { localStorage.setItem('theme', JSON.stringify(t)); } catch (e) {} }, THEME);
for (const chemin of PAGES) {
  await page.goto('http://localhost:8131' + chemin, { waitUntil: 'networkidle' });
  await page.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, THEME);
  await page.waitForTimeout(400);
  const res = await page.evaluate(() => {
    const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const fond = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length === 3 || (c[3] ?? 1) > 0.5) return c.slice(0, 3); } return [14, 26, 19]; };
    const vus = new Map();
    for (const el of document.querySelectorAll('body *')) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity < 0.3) continue;
      const a = lum(rgb(st.color)), b = lum(fond(el));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 3) {
        const cle = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + (el.id ? '#' + el.id : '');
        if (!vus.has(cle)) vus.set(cle, `${ratio.toFixed(1)} « ${el.textContent.trim().slice(0, 40)} » couleur ${st.color} fond ${fond(el)}`);
      }
    }
    return [...vus].map(([k, v]) => `  ${k} : ${v}`);
  });
  console.log(`\n${chemin} — ${res.length} problème(s)`);
  console.log(res.slice(0, 40).join('\n'));
}
await nav.close();
