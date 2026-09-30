// Lecture d'un procès-verbal de la Chambre (« Votes and Proceedings ») de l'Assemblée
// législative de la Saskatchewan, publié en HTML exporté de Word.
//
// Pièges connus (relevés sur les 106 procès-verbaux de la 30e législature) :
//   - l'encodage est windows-1252, et le serveur ne le déclare pas ;
//   - Word coupe les lignes n'importe où : « Bill No. 34 — » et son titre sont souvent deux
//     paragraphes, et un nom peut se couper en deux (« James » / « Thorsteinson ») ;
//   - le document s'ouvre sur une table des matières (en capitales) et se termine par une
//     ANNEXE d'avis (« Hon. X to move first reading of Bill No. 44 ») : ce ne sont pas des
//     événements, on ne lit que le corps, entre « VOTES AND PROCEEDINGS » et « APPENDIX » ;
//   - l'en-tête des votes varie : « NAYS — 31 », « Nays — 33 », « Nays » puis « — 22 » à la
//     ligne suivante, ou « NAYS — Nil ».
//
// Règle n° 1 : un vote dont les noms ne se rapprochent pas TOUS de la liste des député·e·s,
// ou dont le compte ne tombe pas juste, est rendu avec `valide: false` et la raison ; il ne doit
// pas être publié.

import * as cheerio from 'cheerio';

const DECODEUR = new TextDecoder('windows-1252');

export function decoder(tampon) {
  return DECODEUR.decode(tampon);
}

// Un paragraphe = un <p> (ou un titre) de Word, espaces et coupures normalisés.
export function paragraphes(html) {
  const $ = cheerio.load(html);
  $('script, style').remove();
  const sortie = [];
  $('body').find('p, h1, h2, h3, h4, h5, h6, li, td').each((_, el) => {
    // Un <td> qui contient des <p> est lu par ses <p> : on ne le compte pas deux fois.
    if (el.tagName === 'td' && $(el).find('p').length) return;
    const texte = $(el).text()
      .replace(/ /g, ' ')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (texte) sortie.push(texte);
  });
  return sortie;
}

const MOIS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

// Tout ce qui n'est pas une lettre ou un chiffre devient une espace : le procès-verbal contient
// parfois des caractères parasites (« Doug Steele< », le 2 avril 2026).
function plier(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Fautes de frappe relevées DANS le procès-verbal officiel, et le nom exact qu'elles désignent.
// Chaque ligne est une erreur constatée à une date précise, pas une supposition : on ne
// rapproche jamais un nom « à peu près ».
const VARIANTES = {
  'barrett kropf': 'Barret Kropf',   // procès-verbal du 5 mai 2025 (30L1S)
};

// Un paragraphe en français (les procès-verbaux alternent anglais et français) : il ne doit
// ni ouvrir ni fermer une liste lue en anglais.
function estFrancais(x) {
  if (/^Bill No\./.test(x)) return false;
  const fr = (x.match(/\b(le|la|les|du|des|est|sont|une|au|aux|l'Assemblée|projet de loi|Honneur|conformément|ledit|lus?|adoptés?)\b/gi) || []).length;
  const en = (x.match(/\b(the|of|and|was|were|is|bill|Assembly|read|passed|to)\b/gi) || []).length;
  return fr > en;
}

// « Bill No. 27 — The Statute Law Amendment Act, 2025 / Projet de loi no 27 — Loi de 2025
// modifiant le droit législatif » → { num: 27, titre: '…', titreFr: '…' }.
function lireProjet(texte) {
  const m = texte.match(/^Bill No\. (\d+)\s*[—–-]\s*(.+)$/);
  if (!m) return null;
  let [titre, titreFr] = m[2].split(/\s+\/\s+Projet de loi n\s*[o°º]\s*\d+\s*[—–-]\s*/);
  return { num: Number(m[1]), titre: titre.trim(), titreFr: titreFr ? titreFr.trim() : null };
}

// Les comités, sous leur nom exact (le procès-verbal écrit parfois « and justice »).
const COMITES = [
  'Committee of the Whole on Bills',
  'Standing Committee on Crown and Central Agencies',
  'Standing Committee on the Economy',
  'Standing Committee on Human Services',
  'Standing Committee on Intergovernmental Affairs and Justice',
  'Standing Committee on House Services',
  'Standing Committee on Private Bills',
  'Standing Committee on Public Accounts',
];

// Le comité nommé dans une phrase (« committed to the Standing Committee on Human Services »),
// ou le Comité plénier. Inconnu : on le rend tel quel plutôt que de le deviner.
function lireComite(texte) {
  if (/Committee of the Whole/i.test(texte)) return 'Committee of the Whole on Bills';
  const m = texte.match(/Standing Committee on ((?:the )?[A-Z][A-Za-z ,]+?)(?:\.|$| \/)/i);
  if (!m) return null;
  const brut = `Standing Committee on ${m[1].trim()}`;
  return COMITES.find((c) => c.toLowerCase() === brut.toLowerCase()) || brut;
}

// Lit tout un procès-verbal. `deputes` : [{ id, name }] — la liste de la législature, pour
// rapprocher les noms des votes.
export function lireProcesVerbal(html, deputes = []) {
  const brut = paragraphes(html);

  // En-tête : « No. 57 » et « Thursday, April 30, 2026 ».
  const iEntete = brut.findIndex((x) => /^VOTES AND PROCEEDINGS$/i.test(x));
  if (iEntete < 0) throw new Error('en-tête « VOTES AND PROCEEDINGS » introuvable');
  const numero = Number((brut.slice(iEntete, iEntete + 4).find((x) => /^No\. \d+$/.test(x)) || '').replace(/\D/g, '')) || null;
  const ligneDate = brut.slice(iEntete, iEntete + 6).find((x) => /^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{4}$/.test(x));
  let date = null;
  if (ligneDate) {
    const [, mois, jour, an] = ligneDate.match(/, ([A-Z][a-z]+) (\d{1,2}), (\d{4})$/);
    date = `${an}-${String(MOIS[mois.toLowerCase()]).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
  }

  // Le corps seulement, et « Bill No. 34 — » recollé à son titre.
  let fin = brut.findIndex((x, i) => i > iEntete && /^APPENDIX$/i.test(x));
  if (fin < 0) fin = brut.length;
  const p = [];
  for (let i = iEntete; i < fin; i++) {
    const x = brut[i];
    if (/^Bill No\. \d+\s*[—–-]$/.test(x) && i + 1 < fin) { p.push(`${x} ${brut[i + 1]}`); i++; continue; }
    p.push(x);
  }

  const evenements = [];
  // Un même événement peut être écrit deux fois dans la journée (motion, puis constat) : on ne
  // le garde qu'une fois.
  const ajouter = (type, num, extra = {}) => {
    const cle = `${type}|${num}|${extra.comite ?? ''}`;
    if (evenements.some((e) => `${e.type}|${e.bill}|${e.comite ?? ''}` === cle)) return;
    evenements.push({ type, bill: num, ...extra });
  };
  let derniereDecision = -10;    // indice du dernier retrait ordonné par le président

  let section = '';
  let projetCourant = null;      // le dernier projet nommé : c'est de lui que parle « the said bill »
  let liste = null;              // { type, … } : les « Bill No. » qui suivent appartiennent à cette liste
  const TITRES_SECTION = /^(Introduction of Bills|Second Readings?|Adjourned Debates|Committee of the Whole on Bills|Report of the Standing Committee on .+|Royal Assent|Third Readings?|Government Orders|Private Members'? Public Bills.*|Presenting Reports by Standing and Special Committees|Committee of Finance)(?:\s*\/.*)?$/i;

  for (let i = 0; i < p.length; i++) {
    const x = p[i];

    if (TITRES_SECTION.test(x)) { section = x.replace(/\s*\/.*$/, ''); liste = null; }

    // Un projet cité seul sur sa ligne : entrée d'une liste, ou sous-titre du débat qui suit.
    const projet = lireProjet(x);
    if (projet) {
      projetCourant = projet.num;
      if (liste) {
        if (liste.type === 'premiere') {
          const parrain = (p[i + 1] || '').match(/^\((?:Hon\.\s*\/\s*L'hon\s*\.\s*|Hon\.\s*|L'hon\.\s*)?(.+?)\)$/);
          ajouter('premiere', projet.num, { titre: projet.titre, titreFr: projet.titreFr, parrain: parrain ? parrain[1].replace(/\s+/g, ' ').trim() : null });
          if (parrain) i++;
        } else if (liste.type === 'rapport') {
          ajouter('rapport', projet.num, { comite: liste.comite, amende: liste.amende });
          if (liste.troisieme) ajouter('troisieme', projet.num);
        } else if (liste.type === 'sanction') {
          ajouter('sanction', projet.num, { titre: projet.titre });
        }
      }
      continue;
    }
    // Ce qui n'interrompt pas une liste : séparateurs, et tout le bloc en français.
    // (Le séparateur est une ligne de tirets en 2025-2026, de soulignés en 2024-2025.)
    if (liste && (/^[—–_-]{3,}$/.test(x) || /^\[Le français suit\.\]$/.test(x) || estFrancais(x))) continue;
    // La sanction royale : tout ce qui se dit entre l'ouverture et « I assent… » fait partie
    // de la cérémonie ; la liste reste ouverte.
    if (liste && liste.type === 'sanction' && !/assent to (?:these bills|this bill)/i.test(x) && !TITRES_SECTION.test(x)) continue;
    // Un rapport dont la troisième lecture passe par une motion (et souvent par un vote) : le
    // projet n'est nommé que dans la motion (« That Bill No. 38 — … be now read the third
    // time »). C'est lui, l'élément de la liste.
    if (liste && liste.type === 'rapport') {
      const motion = x.match(/^That Bill No\. (\d+)\b/);
      if (motion) {
        ajouter('rapport', Number(motion[1]), { comite: liste.comite, amende: liste.amende });
        projetCourant = Number(motion[1]);
        liste = null;
        continue;
      }
    }

    // Ouvertures de listes.
    // « introduced, read the first time, and ordered… » ou « introduced and read the first time. »
    if (/The following bills? (?:was|were) introduced(?:,| and) read the first time/i.test(x)) { liste = { type: 'premiere' }; continue; }
    const rapport = x.match(/^The following bills? (?:was|were) reported (without|with) amendment/i);
    if (rapport) {
      const comite = /^Report of the Standing Committee on/i.test(section) ? section.replace(/^Report of the /i, '') : lireComite(section) || section || null;
      liste = { type: 'rapport', comite, amende: rapport[1].toLowerCase() === 'with', troisieme: /read the third time and passed/i.test(x) };
      continue;
    }
    if (/^The Clerk of the Assembly then read the titles of the bills|I present to Your Honour the following bill/i.test(x) && /^Royal Assent/i.test(section)) { liste = { type: 'sanction' }; continue; }
    if (/assent to (?:these bills|this bill)/i.test(x)) { liste = null; continue; }

    // Toute autre phrase ferme une liste en cours.
    liste = null;

    // Un projet nommé dans une phrase (« That Bill No. 606 — … be now read the third time »).
    const cites = [...x.matchAll(/Bill No\. (\d+)/g)].map((m) => Number(m[1]));
    if (cites.length === 1) projetCourant = cites[0];

    // Première lecture par motion, un seul projet (« the said bill was accordingly read the first time »).
    if (/accordingly read the first time/i.test(x) && projetCourant) {
      const avant = p.slice(Math.max(0, i - 3), i);
      const titre = [...avant].reverse().map(lireProjet).find(Boolean);
      // « Moved by the Hon. Jim Reiter: That Bill No. 46 — … be introduced and read the first time. »
      const motion = [...avant].reverse().find((y) => /^Moved by /i.test(y));
      const parrain = motion ? (motion.match(/^Moved by (?:the Hon\. )?([^:,]+?)[:,]/i)?.[1] ?? null) : null;
      // Titre : celui d'un sous-titre « Bill No. … », sinon celui écrit dans la motion.
      const dansMotion = motion ? motion.match(/Bill No\. \d+\s*[—–-]\s*(.+?) be (?:now )?introduced/i)?.[1] ?? null : null;
      ajouter('premiere', projetCourant, { titre: titre?.titre ?? dansMotion, titreFr: titre?.titreFr ?? null, parrain });
    }
    // Deuxième lecture (et parfois renvoi dans la même phrase). « ordered to be read a second
    // and third time at the next sitting » annonce une lecture À VENIR : ce n'en est pas une.
    const deuxEtTrois = /\bwas (?:then |accordingly )?read a second and third time/i.test(x) && !/ordered to be read/i.test(x);
    if ((/accordingly read a second time/i.test(x) || deuxEtTrois) && projetCourant) {
      ajouter('deuxieme', projetCourant);
      if (/committed to/i.test(x)) ajouter('renvoi', projetCourant, { comite: lireComite(x) });
    }
    // Renvoi désigné : « By designation of …, Bill No. 33 — … was committed to the Standing Committee on … ».
    const renvoi = x.match(/Bill No\. (\d+)[^]*?was committed to (?:the )?(.+?)\.$/);
    if (renvoi && /^By designation/i.test(x)) ajouter('renvoi', Number(renvoi[1]), { comite: lireComite(x) });
    // Troisième lecture.
    if ((/accordingly read the third time and passed/i.test(x) || (deuxEtTrois && /and passed/i.test(x))) && projetCourant) ajouter('troisieme', projetCourant);
    // Retrait ordonné par le président (« I order that Bill No. 605 be removed from the order
    // paper »). Une DEMANDE de retrait (« requesting that Bill No. 604 be removed ») n'en est pas un.
    const decision = x.match(/\b(?:I order that|Ordered, That) Bill No\. (\d+) be (?:removed from the order paper|dropped|withdrawn)/i);
    if (decision) { ajouter('retire', Number(decision[1]), { motif: 'decision' }); derniereDecision = i; }
    else if (/^Accordingly, the bill was removed from the order paper/i.test(x) && projetCourant && i - derniereDecision > 2) {
      // Après une décision, cette phrase la confirme ; sinon, elle suit le rejet d'un projet.
      ajouter('retire', projetCourant, { motif: 'rejete' });
    }
  }

  return { numero, date, evenements, divisions: lireDivisions(p, deputes) };
}

// ---------------------------------------------------------------- votes par appel nominal

function lireDivisions(p, deputes) {
  // Les noms de la liste, pliés et découpés en mots, du plus long au plus court : on
  // rapproche d'abord « Blaine McLeod » avant d'essayer un nom d'un seul mot.
  const noms = deputes.map((d) => ({ id: d.id, name: d.name, mots: plier(d.name).split(' ') }));
  for (const [faute, juste] of Object.entries(VARIANTES)) {
    const d = deputes.find((x) => x.name === juste);
    if (d) noms.push({ id: d.id, name: d.name, mots: faute.split(' ') });
  }
  noms.sort((a, b) => b.mots.length - a.mots.length);
  // Les mots qui peuvent apparaître dans une liste de noms : un paragraphe fait d'autre chose
  // (« Tabling of Supplementary Estimates ») termine la liste.
  const vocabulaire = new Set(noms.flatMap((n) => n.mots));
  const estNom = (x) => { const m = plier(x).split(' ').filter(Boolean); return m.length > 0 && m.every((w) => vocabulaire.has(w)); };
  const divisions = [];

  const enTete = (x, qui) => new RegExp(`^${qui}(?:\\s*[—–-]\\s*(\\d+|Nil))?$`, 'i').exec(x);
  let dernierVote = 0;   // fin du vote précédent : la recherche du sujet ne remonte pas plus haut
  for (let i = 0; i < p.length; i++) {
    const oui = enTete(p[i], 'YEAS');
    if (!oui) continue;

    const contexte = p.slice(Math.max(0, i - 4), i);
    const phrase = contexte[contexte.length - 1] || '';
    // « it was negatived », « it was agreed to », « it was agreed » (sans « to », 2 avril 2026),
    // ou « the said bill was then read … and passed … on the following recorded division ».
    const resultat = /negatived/i.test(phrase) ? 'rejete' : /\bagreed\b|\bpassed\b|\bcarried\b/i.test(phrase) ? 'adopte' : null;

    // Les deux blocs : YEAS jusqu'à NAYS, puis NAYS jusqu'à la première phrase.
    const lireBloc = (debut) => {
      const annonce = enTete(p[debut], '(?:YEAS|NAYS)');
      let total = annonce && annonce[1] ? annonce[1] : null;
      let j = debut + 1;
      // « Nays » seul, puis « — 22 » à la ligne.
      if (!total && /^[—–-]\s*(\d+|Nil)$/i.test(p[j] || '')) { total = p[j].replace(/^[—–-]\s*/, ''); j++; }
      const morceaux = [];
      while (j < p.length && !enTete(p[j], 'NAYS') && !/^[—–-]\s*\d+$/.test(p[j]) && estNom(p[j])) {
        morceaux.push(p[j]); j++;
      }
      return { total: total === null ? null : /nil/i.test(total) ? 0 : Number(total), morceaux, suite: j };
    };
    const blocOui = lireBloc(i);
    const iNon = blocOui.suite;
    const blocNon = enTete(p[iNon] || '', 'NAYS') ? lireBloc(iNon) : { total: null, morceaux: [], suite: iNon };

    const rapprocher = (morceaux) => {
      const mots = plier(morceaux.join(' ')).split(' ').filter(Boolean);
      const trouves = [];
      const inconnus = [];
      let k = 0;
      while (k < mots.length) {
        const n = noms.find((c) => c.mots.every((m, d) => mots[k + d] === m));
        if (n) { trouves.push({ id: n.id, name: n.name }); k += n.mots.length; }
        else { inconnus.push(mots[k]); k++; }
      }
      return { trouves, inconnus };
    };
    const pour = rapprocher(blocOui.morceaux);
    const contre = rapprocher(blocNon.morceaux);

    const raisons = [];
    if (blocOui.total === null) raisons.push('total des YEAS illisible');
    if (blocNon.total === null) raisons.push('total des NAYS illisible');
    if (blocOui.total !== null && pour.trouves.length !== blocOui.total) raisons.push(`YEAS : ${pour.trouves.length} noms pour ${blocOui.total} annoncés`);
    if (blocNon.total !== null && contre.trouves.length !== blocNon.total) raisons.push(`NAYS : ${contre.trouves.length} noms pour ${blocNon.total} annoncés`);
    if (pour.inconnus.length) raisons.push(`noms non reconnus (YEAS) : ${pour.inconnus.join(' ')}`);
    if (contre.inconnus.length) raisons.push(`noms non reconnus (NAYS) : ${contre.inconnus.join(' ')}`);
    if (!resultat) raisons.push('résultat (adopté / rejeté) illisible');

    // Le sujet : ce qui est mis aux voix. On remonte jusqu'au début du débat (au plus 80
    // paragraphes, sans franchir le vote précédent) pour retrouver :
    //   - la motion principale : le « That … » qui suit « proposed motion of … : » ou
    //     « Moved by … : » (ou qui est écrit dans la même phrase) ;
    //   - l'amendement, s'il y en a un : le dernier « That all the words … », « That the motion
    //     be amended … », avec le paragraphe qui le complète.
    const borne = Math.max(0, i - 80, dernierVote);
    let motionPrincipale = null, amendement = null;
    for (let k = i - 1; k >= borne; k--) {
      const y = p[k];
      const estAmendement = (t) => /^That (?:all (?:the )?words|the motion be amended|the following words)/i.test(t || '');
      if (!amendement && estAmendement(y)) {
        // Le texte de l'amendement continue jusqu'à la reprise du débat (au plus 3 paragraphes).
        const morceaux = [y];
        for (let s = k + 1; s < i && morceaux.length < 4 && !/^(The debate|The question|A debate|YEAS)/i.test(p[s]); s++) morceaux.push(p[s]);
        amendement = morceaux.join(' ');
      }
      // « proposed motion of X: », « Moved by X: », « …, it was moved by X: » (motion présentée
      // avec permission, rule 61) — mais pas celui qui introduit l'amendement.
      if (!motionPrincipale && /(?:proposed motion(?: no\. \d+)?(?:,)? (?:of|moved by)|^Moved by|\bit was moved by)[^:]*:\s*$/i.test(y)
        && /^That /.test(p[k + 1] || '') && !estAmendement(p[k + 1])) {
        motionPrincipale = p[k + 1];
      }
      if (!motionPrincipale && /^(?:Moved by|The Assembly resumed the adjourned debate on the proposed motion of)[^:]*: That /i.test(y)) {
        motionPrincipale = y.replace(/^[^:]*: /, '');
      }
      if (motionPrincipale) break;
    }
    // Le vote sur la motion principale suit souvent celui sur l'amendement : le débat est le
    // même, écrit plus haut que le vote précédent. On le reprend de là.
    const precedent = divisions[divisions.length - 1];
    if (!motionPrincipale && /question being put on the motion/i.test(phrase) && precedent?.motionPrincipale) {
      motionPrincipale = precedent.motionPrincipale;
    }
    const surAmendement = /on the amendment|amendment, it was/i.test(phrase);
    const motion = (surAmendement && amendement) ? amendement
      : motionPrincipale || [...contexte].reverse().find((x) => /^(Moved by|That )|be now read/i.test(x)) || phrase;
    const court = (s) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > 500 ? `${t.slice(0, 497)}…` : t; };
    const bills = [...contexte.join(' ').matchAll(/Bill No\. (\d+)/g)].map((m) => Number(m[1]));
    // Le débat auquel se rattache le vote (discours du Trône, budget), d'après la motion principale.
    const debat = /Humble Address|Address in Reply/i.test(motionPrincipale || '') ? 'trone'
      : /budgetary policy/i.test(motionPrincipale || '') ? 'budget' : null;
    const etape = surAmendement ? 'amendement'
      : /third time/i.test(contexte.join(' ')) ? 'troisieme'
        : /second time|second reading/i.test(contexte.join(' ')) ? 'deuxieme'
          : /do now adjourn/i.test(motionPrincipale || contexte.join(' ')) ? 'ajournement'
            : debat || 'motion';

    divisions.push({
      etape,
      debat,
      bill: bills.length ? bills[bills.length - 1] : null,
      motion: court(motion),
      motionPrincipale: motionPrincipale ? court(motionPrincipale) : null,
      resultat,
      pour: pour.trouves,
      contre: contre.trouves,
      totaux: { pour: blocOui.total, contre: blocNon.total },
      valide: raisons.length === 0,
      raisons,
    });
    i = blocNon.suite - 1;
    dernierVote = blocNon.suite;
  }
  return divisions;
}
