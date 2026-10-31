// Injecte data/bills.json directement dans index.html, entre les marqueurs
// BILLS_DATA_START / BILLS_DATA_END.
//
// Ce fichier disait « le prototype reste un fichier HTML unique et autonome, ouvrable en
// double-cliquant, sans serveur ni fetch() ». Ce n'est plus vrai depuis le 21 septembre 2026 :
// la feuille de style et la logique vivent dans commun/, et les gros textes se chargent à la
// demande. Le site est servi par un serveur, et c'est ce qui lui permet de peser trois fois
// moins. Ouvrir index.html en double-cliquant ne donne plus rien.
//
// Adapte aussi le format des données au gabarit attendu par billCard() :
//   - `id` devient la clé unique utilisée pour les DOM ids (b.num n'est PAS unique,
//     le Québec réutilise les numéros de projet de loi d'une session à l'autre —
//     voir bills.js).
//   - `sponsor` est raccourci à "Prénom Nom" (la donnée brute inclut aussi le rôle,
//     déjà affiché ailleurs sur la page).
//   - `summary` (liste à puces "- ...") est converti en <ul><li>...</li></ul>.
//     Les projets sans résumé utilisable affichent un message honnête plutôt que
//     du contenu vide ou inventé.
//
// Les projets "laisse_de_cote" sont inclus (affichés comme "Sur la glace" côté
// front-end) — on ne les cache plus, voir la conversation sur la distinction
// sanctionné / à l'étude / sur la glace.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const IN_PATH = 'data/bills.json';
const HTML_PATH = 'gabarit.html';   // le MODÈLE, jamais servi : les pages en sont tirées
const START_MARKER = '/* BILLS_DATA_START';
const END_MARKER = '/* BILLS_DATA_END */';

function shortSponsorName(raw) {
  if (!raw) return null;
  const [namePart] = raw.split('—');
  const trimmed = namePart.trim();
  const match = trimmed.match(/^([^,]+),\s*(.+)$/); // "Nom, Prénom" -> "Prénom Nom"
  return match ? `${match[2]} ${match[1]}` : trimmed;
}

// Convertit un texte à puces « - … » (une idée par ligne) en <ul>. Utilisé pour
// le résumé FR et sa traduction EN. `emptyValue` = ce qu'on retourne si le texte
// est vide (message pour le FR, null pour l'EN qui retombe alors sur le FR).
function bulletsToHtml(text, emptyValue) {
  if (!text) return emptyValue;
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim());
  if (lines.length === 0) return `<p>${text}</p>`;
  return `<ul class="bill-summary-list">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`;
}

// Un omnibus se lit comme en Ontario (Martin, 25 sept. 2026) : l'aperçu, puis une tête par loi
// touchée (« Volet 1 · Loi sur le bâtiment ») et ses puces dessous. Le résumé d'un omnibus
// (bill-summaries.js, SYSTEM_OMNIBUS) est déjà fait ainsi : l'aperçu, une ligne vide, puis une puce
// « Nom de la loi : ce qui change » par loi. Une puce sans « : » reste une puce ordinaire.
function omnibusToHtml(text, en) {
  if (!text) return null;
  const [apercu, ...reste] = text.split(/\n\s*\n/);
  const puces = (bloc) => bloc.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
  const lois = puces(reste.join('\n'));
  if (!lois.length) return bulletsToHtml(text, null);
  const groupes = [];
  for (const l of lois) {
    const m = l.match(en ? /^([^:]{3,160}):\s+(.+)$/ : /^([^:]{3,160}?)\s*:\s+(.+)$/);
    const nom = m ? m[1].trim() : null;
    // Une loi qui revient plus loin (le résumé suit l'ordre des notes, pas des lois) rejoint sa tête.
    const meme = nom && groupes.find((g) => g.nom === nom);
    if (meme) meme.puces.push(m[2]);
    else groupes.push({ nom, puces: [m ? m[2] : l] });
  }
  let n = 0;
  const html = groupes.map((g) => (g.nom
    ? `<h5 class="volet-titre"><span>${en ? 'Part' : 'Volet'} ${++n}</span> ${g.nom}</h5><ul class="bill-summary-list">${g.puces.map((p) => `<li>${p.charAt(0).toUpperCase() + p.slice(1)}</li>`).join('')}</ul>`
    : `<ul class="bill-summary-list">${g.puces.map((p) => `<li>${p}</li>`).join('')}</ul>`)).join('');
  const tete = puces(apercu);
  return (tete.length ? `<ul class="bill-summary-list">${tete.map((l) => `<li>${l}</li>`).join('')}</ul>` : '') + html;
}

const echapperHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Saskatchewan : les résumés viennent de data/resumes.json (scrapers/resumes.js), un par langue,
// avec en tête le RÉSUMÉ EXÉCUTIF — une phrase qui dit ce que fait le projet — puis les puces.
// Sous les puces, une ligne dit d'où vient le résumé : c'est une IA, sur le texte tel que déposé,
// parfois sur le texte anglais faute de version française, parfois sur les notes explicatives,
// parfois sur une partie seulement d'un texte trop long. Jamais présenté comme officiel.
function resumeSkHtml(r, langue) {
  if (!r) return null;
  const fr = langue === 'fr';
  if (r.sansContenu || !r.puces?.length) {
    return fr ? '<p><em>Texte trop court ou trop technique pour un résumé honnête : voir le texte officiel.</em></p>'
      : '<p><em>Too short or too technical for an honest summary: see the official text.</em></p>';
  }
  const origine = [];
  if (r.source === 'notes') origine.push(fr ? 'à partir des notes explicatives officielles (le texte du projet est trop long)' : 'from the official explanatory notes (the bill itself is too long)');
  else if (r.source === 'texte-anglais') origine.push('à partir du texte anglais, seule version officielle');
  if (r.tronque) origine.push(fr ? 'sur la première partie seulement d\'un texte très long' : 'from the first part only of a very long text');
  // La carte dit déjà « résumé généré par IA à partir du texte tel que présenté » : ici, seulement
  // ce qui est propre à ce résumé-là (langue lue, notes explicatives, troncature).
  const note = origine.length
    ? (fr ? `Rédigé ${origine.join(', ')}.` : `Written ${origine.join(', ')}.`)
    : null;
  return `<p class="resume-executif">${echapperHtml(r.resumeExecutif)}</p>`
    + `<ul class="bill-summary-list">${r.puces.map((p) => `<li>${echapperHtml(p)}</li>`).join('')}</ul>`
    + (note ? `<p class="resume-origine">${echapperHtml(note)}</p>` : '');
}

function summaryToHtml(bill) {
  if (bill.omnibus && bill.summary) return omnibusToHtml(bill.summary, false);
  return bulletsToHtml(bill.summary, '<p><em>Résumé non disponible pour ce projet de loi.</em></p>');
}

function main() {
  const data = JSON.parse(readFileSync(IN_PATH, 'utf-8'));
  const resumesIA = existsSync('data/resumes.json') ? JSON.parse(readFileSync('data/resumes.json', 'utf-8')).resumes ?? {} : {};

  const bills = data.bills.map((b) => {
    const r = resumesIA[b.id] ?? {};
    return ({
    id: b.id,
    num: b.num,
    // En français, le titre français OFFICIEL quand le projet est bilingue ; sinon le titre
    // anglais, le seul qui existe (on ne traduit pas un titre de loi).
    title: b.titleFrOfficiel || b.title,
    status: b.status,
    step: b.step,
    note: b.note,
    sponsor: shortSponsorName(b.sponsor) || (b.type === 'Government Bill' ? 'Government' : null),
    summary: resumeSkHtml(r.fr, 'fr') ?? summaryToHtml(b),
    summaryAiGenerated: Boolean(r.fr || r.en),
    // La phrase qui s'affiche sur la carte, sous le titre, sans rien déplier.
    resumeExecutif: r.fr && !r.fr.sansContenu ? r.fr.resumeExecutif : null,
    resumeExecutifEn: r.en && !r.en.sansContenu ? r.en.resumeExecutif : null,
    url: b.url,
    urlEn: b.urlEn || null,
    titleEn: b.titleEn || b.title || null,
    titreFrOfficiel: Boolean(b.titleFrOfficiel),
    // Amendé en comité : la page prévient que le résumé porte sur le texte d'avant.
    amende: Boolean(b.amende),
    noteEn: b.noteEn || null,
    summaryEn: resumeSkHtml(r.en, 'en') ?? (b.summaryEn ? (b.omnibus ? omnibusToHtml(b.summaryEn, true) : bulletsToHtml(b.summaryEn, null)) : '<p><em>No summary available for this bill yet.</em></p>'),
    lastActivity: b.lastActivity,
    presentedOn: b.presentedOn || null,
    // Omnibus (25 sept. 2026, scrapers/bill-summaries.js) : combien de lois et règlements le
    // projet touche, d'après sa liste officielle, et s'il est un omnibus. La liste elle-même
    // suit le résumé (chargé à l'ouverture de la carte).
    nbLois: Array.isArray(b.loisTouchees) ? b.loisTouchees.length : null,
    omnibus: Boolean(b.omnibus),
    _lois: Array.isArray(b.loisTouchees) ? b.loisTouchees : [],
    // Pour rattacher les votes nominaux (caseVotes) : législature et session de dépôt.
    _leg: b.legislature,
    _session: b.introSession,
  });
  });

  bills.sort((a, b) => {
    if (!a.lastActivity && !b.lastActivity) return 0;
    if (!a.lastActivity) return 1;
    if (!b.lastActivity) return -1;
    return b.lastActivity.localeCompare(a.lastActivity);
  });

  // Les résumés sortent de la page. Mesuré : 177 ko bruts, 55 ko compressés — plus du tiers du
  // poids compressé de la page, pour un texte qui ne s'affiche que dans la carte qu'on déplie.
  // Un fichier par langue, parce qu'on n'a jamais besoin des deux en même temps.
  const resumes = { fr: {}, en: {} };
  const echapper = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // La liste officielle des textes touchés, repliée sous le résumé. Les titres restent en
  // français en anglais : ce sont les titres officiels, il n'en existe pas d'autre ici.
  const listeLois = (b, en) => b._lois.length < 2 ? '' :
    `<details class="bill-lois"><summary>${en ? `Laws and regulations affected (${b._lois.length}) — official French titles` : `Lois et règlements touchés (${b._lois.length})`}</summary><ul>${b._lois.map((l) => `<li>${echapper(l)}</li>`).join('')}</ul></details>`;
  // LES VOTES NOMINAUX D'UN PROJET (d'après DossierQuébec, 30 oct. 2026) : une case « Qui a voté… »
  // sous le résumé, une carte par vote du plus ancien au plus récent, dessinée comme sur /votes.
  // Rapprochement : numéro, législature et session (data/votes.json, lu dans les procès-verbaux).
  // Seules la tête et la barre sont ici ; commun/dq.js (remplirVotesProjet) tire les noms de
  // data/archives/<législature>/votes/<id>.json à l'ouverture. Pas de vote, pas de case : la
  // Saskatchewan n'a pas de fiche qui dirait comment une loi a passé de vive voix.
  const votesNominaux = existsSync('data/votes.json') ? JSON.parse(readFileSync('data/votes.json', 'utf-8')).votes ?? [] : [];
  const votesDuProjet = (b) => votesNominaux.filter((x) => x.billNum && String(x.billNum) === String(b.num)
    && Number(x.legislature) === Number(b._leg) && Number(x.session) === Number(b._session))
    .sort((x, y) => (x.date || '').localeCompare(y.date || '') || (Number(x.num) || 0) - (Number(y.num) || 0));
  let avecCase = 0;
  const caseVotes = (b, en) => {
    const liste = votesDuProjet(b);
    if (!liste.length) return '';
    if (!en) avecCase++;
    const titre = en ? 'Who voted for or against' : 'Qui a voté pour ou contre';
    const objet = encodeURIComponent((en ? 'Bill ' : 'Projet de loi n° ') + b.num + ' — ' + (en ? (b.titleEn || b.title) : b.title));
    const etapeDe = (v) => (en ? v.stage : (v.stageFr || v.stage)) || '';
    const carte = (v) => {
      const t = { pour: (v.pour || []).length, contre: (v.contre || []).length };
      const total = t.pour + t.contre;
      const seg = (g) => (total ? (t[g] / total * 100).toFixed(1) : 0);
      const adopte = v.result ? v.result === 'adopte' : t.pour > t.contre;
      const etape = etapeDe(v) || (en ? 'Recorded division' : 'Vote nominal');
      return `<div class="vote-card bill-vote-card"><div class="vc-head"><span class="result-badge ${adopte ? 'adopte' : 'rejete'}">${adopte ? (en ? 'Passed' : 'Adopté') : (en ? 'Rejected' : 'Rejeté')}</span><div class="vc-head-main"><h3>${echapper(etape)}</h3><div class="vc-meta">${echapper(v.date)} · ${en ? 'Recorded division' : 'Vote nominal'}</div></div><div class="vc-counts"><span class="vcc pour"><b>${t.pour}</b> ${en ? 'yea' : 'pour'}</span><span class="vcc contre"><b>${t.contre}</b> ${en ? 'nay' : 'contre'}</span></div></div><div class="bar"><div class="seg pour" style="width:${seg('pour')}%"></div><div class="seg contre" style="width:${seg('contre')}%"></div></div><div class="vc-detail open" data-vote="${v.session}-${v.num}" data-leg="${v.legislature}"><div class="vc-pgrid"></div><div class="vc-ncols"></div><div class="vc-foot"><span class="vc-foot-note">${en ? 'The Assembly does not record abstentions: an MLA who does not vote is simply not listed — which can mean a mission, an illness, a scheduling conflict.' : 'L’Assemblée ne consigne pas d’abstention : qui ne vote pas n’est simplement pas nommé — mission, maladie, horaire.'}</span><a class="bill-more" href="${echapper(v.url)}" target="_blank" rel="noopener">${en ? 'Official minutes → legassembly.sk.ca' : 'Procès-verbal officiel → legassembly.sk.ca'}</a></div></div></div>`;
    };
    const n = liste.length;
    // Le décompte du dernier vote dans le titre ; avec plusieurs votes, son étape le précède.
    const dernier = liste[n - 1];
    // Format de Martin (DQ, 30 oct. 2026) : « titre : pour / contre », puis, avec plusieurs votes,
    // « (étape du dernier · N votes nominaux) ». Pas d'abstention consignée ici : deux nombres.
    const chiffres = `${(dernier.pour || []).length} / ${(dernier.contre || []).length}`;
    const suite = n > 1 ? ` (${etapeDe(dernier) ? etapeDe(dernier) + ' · ' : ''}${n} ${en ? 'recorded votes' : 'votes nominaux'})` : '';
    return `<details class="bill-votes" data-objet="${objet}"><summary>${titre}${en ? ':' : ' :'} ${echapper(chiffres + suite)}</summary><p class="bill-votes-note">${en
      ? 'Every recorded division on this bill, oldest first. ✉ opens your email app, with the bill’s name as subject; ⧉ copies the address, to paste in Gmail or elsewhere. A name in grey, without ✉: this person no longer sits in the Assembly.'
      : 'Chaque vote nom par nom sur ce projet, du plus ancien au plus récent. ✉ ouvre votre logiciel de courriel, avec le nom du projet en objet ; ⧉ copie l’adresse, à coller dans Gmail ou ailleurs. Un nom en gris, sans ✉ : cette personne ne siège plus à l’Assemblée.'}</p>${liste.map(carte).join('')}</details>`;
  };
  for (const b of bills) {
    if (b.summary) resumes.fr[b.id] = b.summary + listeLois(b, false) + caseVotes(b, false);
    if (b.summaryEn) resumes.en[b.id] = b.summaryEn + listeLois(b, true) + caseVotes(b, true);
  }
  console.log(`  case des votes : ${avecCase} projet(s)`);
  for (const [langue, map] of Object.entries(resumes)) {
    const chemin = `data/bills-resumes-${langue}.json`;
    const contenu = JSON.stringify(map);
    // Ne réécrire que si ça change : garde le diff quotidien à ce qui a vraiment bougé.
    if (existsSync(chemin) && readFileSync(chemin, 'utf-8') === contenu) continue;
    writeFileSync(chemin, contenu);
  }

  // Ce qui part dans la page : tout sauf les résumés.
  const allege = bills.map(({ summary, summaryEn, _lois, _leg, _session, ...reste }) => reste);

  const html = readFileSync(HTML_PATH, 'utf-8');
  const startIdx = html.indexOf(START_MARKER);
  const endIdx = html.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Marqueurs BILLS_DATA_START/END introuvables dans ${HTML_PATH}`);
  }

  const block = `${START_MARKER} — généré automatiquement par scrapers/build-frontend-data.js à partir de\n   data/bills.json (voir scrapers/bills.js, bill-details.js, bill-summaries.js). Ne pas éditer\n   ce bloc à la main : relancer \`node scrapers/build-frontend-data.js\` à la place.\n   Les résumés ne sont PAS ici : ils vivent dans data/bills-resumes-{fr,en}.json et se chargent\n   au premier dépliement de carte ou à la première recherche.\n   Généré le ${new Date().toISOString()} */\nconst bills = ${JSON.stringify(allege, null, 2)};\n`;

  const updated = html.slice(0, startIdx) + block + html.slice(endIdx);
  writeFileSync(HTML_PATH, updated);
  const ko = (x) => (Buffer.byteLength(JSON.stringify(x)) / 1024).toFixed(0);
  console.log(`${bills.length} projets de loi injectés directement dans ${HTML_PATH} — ${ko(allege)} ko dans la page`);
  console.log(`  résumés sortis : ${ko(resumes.fr)} ko en français, ${ko(resumes.en)} ko en anglais`);
}

main();
