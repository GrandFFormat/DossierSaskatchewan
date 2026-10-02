// UNE PAGE PAR PROJET DE LOI — /projets-de-loi/24-30 (numéro-législature). Martin, 1er oct. 2026,
// d'après DossierQuébec (scripts/build-bill-pages.js, /projets-de-loi/3-43-3) et le document
// « Bâtir un site Dossier », étape 6 : c'est là que se font les vraies recherches (« bill 24
// saskatchewan »), et c'est l'adresse qu'on partage. En Saskatchewan, la numérotation ne
// recommence pas à chaque session (1 à 60, puis 601 et plus pour les projets de député·e·s) :
// numéro + législature suffit, et ne se recoupe pas d'une législature à l'autre.
//
// Chaque page est la page « Projets de loi » à l'identique (commun/dq.js lit le chemin et ouvre
// ce projet), avec son propre <head> (titre, description tirée du résumé exécutif, canonical,
// Open Graph, fil d'Ariane) et, écrits dans la page, le titre et le résumé du projet, pour qu'un
// moteur les lise sans exécuter le code. Les pages entrent au sitemap.
//
// Lancé par scripts/build-section-pages.js, à la fin (il lit projets-de-loi.html qu'il vient
// d'écrire). Le dossier est refait à neuf à chaque fois : aucune page orpheline. Le
// rafraîchissement automatique committe tout (git add -A) : un projet déposé la veille a sa page
// le lendemain.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';

const SITE = 'https://dossiersaskatchewan.ca';
const DOSSIER = 'projets-de-loi';
const echapper = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const couper = (s, n) => (s.length > n ? `${s.slice(0, n - 3).replace(/\s+\S*$/, '')}…` : s);

export const slugProjet = (b) => (b.num != null && b.legislature ? `${b.num}-${b.legislature}` : null);

export function construirePagesProjets() {
  const modele = readFileSync(`${DOSSIER}.html`, 'utf8');
  const { bills } = JSON.parse(readFileSync('data/bills.json', 'utf8'));
  const R = existsSync('data/resumes.json') ? JSON.parse(readFileSync('data/resumes.json', 'utf8')) : {};
  const resumes = R.resumes || R;

  if (existsSync(DOSSIER)) for (const f of readdirSync(DOSSIER)) if (f.endsWith('.html')) rmSync(`${DOSSIER}/${f}`);
  mkdirSync(DOSSIER, { recursive: true });

  const vues = new Set();
  const adresses = [];
  for (const b of bills) {
    const slug = slugProjet(b);
    if (!slug || vues.has(slug)) continue;
    vues.add(slug);
    const url = `${SITE}/${DOSSIER}/${slug}`;
    const titre = b.titleEn || b.title;
    const r = resumes[b.id] || resumes[String(b.id)] || {};
    const en = r.en || {};
    const executif = en.resumeExecutif || '';
    const puces = Array.isArray(en.puces) ? en.puces : [];
    const titrePage = `Bill ${b.num} — ${couper(titre, 60)} — DossierSaskatchewan`;
    const base = executif || `${titre}. Its stage in the Legislative Assembly of Saskatchewan, explained in plain language.`;
    const desc = `Bill ${b.num}: ${couper(base, 150)}`;
    const ld = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Bills', item: `${SITE}/${DOSSIER}` },
        { '@type': 'ListItem', position: 3, name: `Bill ${b.num}`, item: url },
      ],
    }, null, 2).replace(/</g, '\\u003c');

    let h = modele;
    const remplacer = (motif, valeur) => {
      if (!motif.test(h)) throw new Error(`build-bill-pages : ${motif} introuvable dans ${DOSSIER}.html`);
      h = h.replace(motif, valeur);
    };
    remplacer(/<title>[^<]*<\/title>/, `<title>${echapper(titrePage)}</title>`);
    remplacer(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${echapper(desc)}">`);
    remplacer(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`);
    remplacer(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${echapper(titrePage)}">`);
    remplacer(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${echapper(desc)}">`);
    remplacer(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`);
    h = h.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${echapper(titrePage)}">`)
      .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${echapper(desc)}">`);
    remplacer(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">\n${ld}\n</script>`);
    // Le projet, écrit dans la page : commun/dq.js remplace le contenu de #billsList au
    // chargement, puis ouvre la carte de ce projet (openBillFromQuery lit le chemin).
    const fiche = `<article class="bill-prerendu">
<h2>Bill ${echapper(b.num)} — ${echapper(titre)}</h2>
<p>${echapper(b.noteEn || b.note || '')}${b.sponsor ? ` · Sponsor: ${echapper(b.sponsor)}` : ''}</p>
${executif ? `<p>${echapper(executif)}</p>` : ''}
${puces.length ? `<ul>${puces.map((p) => `<li>${echapper(p)}</li>`).join('')}</ul>` : ''}
<p><a href="${echapper(b.urlEn || b.url)}" rel="noopener">The bill on the Legislative Assembly of Saskatchewan website</a></p>
</article>`;
    remplacer(/<div id="billsList"><\/div>/, `<div id="billsList">${fiche}</div>`);
    // Pas la liste des dix premiers projets : la page d'un projet ne pré-rend QUE ce projet (sinon
    // 88 pages presque identiques, qui changeraient toutes chaque nuit).
    h = h.replace(/\s*<div class="prerendu" data-prerendu="bills">[\s\S]*?<\/div>/, '');
    writeFileSync(`${DOSSIER}/${slug}.html`, h, 'utf8');
    adresses.push({ url, lastmod: b.lastActivity ?? null });
  }

  // Au sitemap, à la suite des pages du site (build-section-pages.js vient de l'écrire).
  const plan = readFileSync('sitemap.xml', 'utf8').replace(/\r\n/g, '\n');
  const entrees = adresses.map((a) => `  <url>\n    <loc>${a.url}</loc>\n${a.lastmod ? `    <lastmod>${a.lastmod}</lastmod>\n` : ''}    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`).join('\n');
  const nouveau = plan.replace(/\n<\/urlset>/, `\n${entrees}\n</urlset>`);
  if (nouveau !== plan) writeFileSync('sitemap.xml', nouveau, 'utf8');
  console.log(`✓ ${adresses.length} pages de projets de loi (/${DOSSIER}/numéro-législature), au sitemap.`);
}
