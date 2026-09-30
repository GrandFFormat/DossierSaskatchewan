// Scraper — les votes par appel nominal (« recorded divisions »), député·e par député·e.
//
// Source : les procès-verbaux déjà lus par proces-verbaux.js. Chaque vote nominal y est écrit en
// entier : la motion mise aux voix, « YEAS — 33 » et les noms, « NAYS — 21 » et les noms.
//
// Ce qu'on ne publie PAS : un vote dont les noms ne se rapprochent pas tous de la liste des
// député·e·s, ou dont le nombre de noms ne tombe pas sur le total annoncé (sk-proces-verbal.js le
// marque `valide: false`). Il est compté et signalé, jamais affiché à moitié.
//
// Le parti de chaque votant est celui du JOUR du vote (voir sk-changements-caucus.js).
//
// La plupart des projets de loi sont adoptés sans vote nominal (de vive voix) : l'absence d'un
// vote ici n'est pas un trou dans les données. La page doit le dire.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LEGISLATURE } from './sk-commun.js';
import { partiLe } from './sk-changements-caucus.js';

const DOSSIER_PV = 'data/proces-verbaux';
const OUT_PATH = 'data/votes.json';

const ETAPES = {
  deuxieme: ['Second reading', 'Deuxième lecture'],
  troisieme: ['Third reading', 'Troisième lecture'],
  amendement: ['Amendment', 'Amendement'],
  trone: ['Speech from the Throne', 'Discours du Trône'],
  budget: ['Budget', 'Budget'],
  motion: ['Motion', 'Motion'],
};

const numeroSession = (code) => Number(code.match(/L(\d+)S$/)[1]);

function main() {
  const { deputes } = JSON.parse(readFileSync('data/deputes.json', 'utf-8'));
  const parId = new Map(deputes.map((d) => [d.id, d]));
  const { bills } = JSON.parse(readFileSync('data/bills.json', 'utf-8'));
  const billParNum = new Map(bills.map((b) => [b.num, b]));

  const sessions = readdirSync(DOSSIER_PV).filter((s) => s.startsWith(`${LEGISLATURE}L`)).sort((a, b) => numeroSession(a) - numeroSession(b));
  const votes = [];
  const rejetes = [];

  for (const session of sessions) {
    let num = 0;
    const jours = readdirSync(join(DOSSIER_PV, session)).filter((f) => f.endsWith('.json')).sort();
    for (const f of jours) {
      const jour = JSON.parse(readFileSync(join(DOSSIER_PV, session, f), 'utf-8'));
      for (const d of jour.divisions) {
        if (!d.valide) { rejetes.push(`${jour.date} : ${d.raisons.join(' ; ')}`); continue; }
        num++;
        const bill = d.bill ? billParNum.get(d.bill) : null;
        const [stage, stageFr] = ETAPES[d.etape] ?? ETAPES.motion;
        // Le sujet : le projet de loi s'il y en a un (« Bill No. 606 — The … Act »), sinon la
        // motion telle qu'écrite au procès-verbal.
        const subject = bill ? `Bill No. ${bill.num} — ${bill.title}` : d.motion;
        const votant = (p) => {
          const depute = parId.get(p.id);
          return { assnatId: p.id, name: p.name, lastName: p.name.split(' ').slice(-1)[0], riding: depute?.riding ?? null, party: partiLe(p.id, depute?.party ?? null, jour.date) };
        };
        votes.push({
          legislature: LEGISLATURE,
          session: numeroSession(session),
          num,
          url: jour.url,
          date: jour.date,
          title: `${stage} – ${subject}`,
          stage,
          stageFr,
          subject,
          motion: d.motion,
          result: d.resultat,
          billNum: bill ? bill.num : (d.bill ?? null),
          totals: { pour: d.totaux.pour, contre: d.totaux.contre, abstentions: null },
          pour: d.pour.map(votant),
          contre: d.contre.map(votant),
          // La Saskatchewan ne consigne pas d'abstention dans un vote nominal : qui ne vote pas
          // n'apparaît simplement pas.
          abstentions: [],
        });
      }
    }
  }

  writeFileSync(OUT_PATH, JSON.stringify({
    legislature: LEGISLATURE,
    source: 'Procès-verbaux (Votes and Proceedings) de l\'Assemblée législative de la Saskatchewan',
    scrapedAt: new Date().toISOString(),
    count: votes.length,
    votes,
  }, null, 1) + '\n');

  const surProjets = votes.filter((v) => v.billNum).length;
  const sansParti = votes.flatMap((v) => [...v.pour, ...v.contre]).filter((p) => !p.party).length;
  console.log(`${votes.length} votes nominatifs écrits dans ${OUT_PATH} — ${surProjets} sur des projets de loi`);
  if (sansParti) console.log(`  ${sansParti} voix sans parti attribué (changement de caucus le jour même du vote)`);
  if (rejetes.length) {
    console.log(`  ⚠ ${rejetes.length} vote(s) NON publié(s) :`);
    for (const r of rejetes) console.log(`    ${r}`);
  }
}

main();
