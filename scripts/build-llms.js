// /llms.txt — le site expliqué aux assistants (ChatGPT, Claude, Perplexity…), au format proposé par
// llmstxt.org : un titre, un résumé, puis des listes de liens. Martin, 6 oct. 2026 : « il nous
// faut des llms.txt sur tous les dossiers ».
//
// Ce n'est pas une norme et rien ne garantit qu'un assistant le lise. Son intérêt : quand il est
// lu, le site est décrit avec NOS mots (non officiel, sources primaires, rien d'inventé, le texte
// officiel fait foi) plutôt que deviné. Le contenu reprend la page /regles (anglais dans
// gabarit.html, français dans commun/dq.js) ; si une règle change là-bas, elle change ici.
//
// Fabriqué à chaque build (scripts/build-section-pages.js, à la fin), pour que les nombres suivent
// les données. Aucune date dedans : le fichier ne change que si le site change. En anglais, la
// langue par défaut du site, avec une courte section en français à la fin.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SITE = 'https://dossiersaskatchewan.ca';
const lire = (chemin, defaut) => (existsSync(chemin) ? JSON.parse(readFileSync(chemin, 'utf8')) : defaut);

export function construireLlms() {
  const bills = lire('data/bills.json', { bills: [] }).bills || [];
  const votes = lire('data/votes.json', { votes: [] }).votes || [];
  const ministres = lire('data/ministers.json', { ministers: [] }).ministers || [];
  const deputes = lire('data/deputes.json', { deputes: [] }).deputes || [];
  const promesses = lire('data/promises.json', { promises: [] }).promises || [];
  const inscriptions = lire('data/lobbyistes.json', { inscriptions: [] }).inscriptions || [];
  const legislature = Math.max(0, ...bills.map((b) => Number(b.legislature) || 0));

  // L'exemple : un projet de loi dont la page existe vraiment (le 24 s'il est là, comme dans les
  // commentaires du build ; sinon le premier qui a sa page).
  const aSaPage = (b) => b.num && b.legislature && existsSync(`projets-de-loi/${b.num}-${b.legislature}.html`);
  const exemple = bills.find((b) => b.num === 24 && aSaPage(b)) || bills.find(aSaPage);

  // Une page n'est listée que si son fichier existe.
  const page = (fichier, ligne) => (existsSync(fichier) ? [ligne] : []);

  const lignes = [
    '# DossierSaskatchewan',
    '',
    "> Independent, UNOFFICIAL citizen website that makes the work of the Legislative Assembly of Saskatchewan readable in plain language: bills, recorded votes, ministers and MLAs, the governing party's election promises, and the Saskatchewan Lobbyist Registry. Free, with no advertising and no subscription. The site is in English, with a French version (add ?lang=fr to any address).",
    '',
    'What to know before citing this site:',
    '',
    "- The site is not an official source. Every item links to its official source; if they differ, the original document prevails. Cite the official source together with DossierSaskatchewan, not DossierSaskatchewan alone.",
    "- Plain-language bill summaries are written by artificial intelligence from each bill's official text, and are presented as such. A summary describes the bill as introduced and is not an official document: the Assembly's text is the one that counts.",
    '- No data is invented: if a piece of information is missing, the field stays empty or the site says so.',
    "- Primary sources only: the Legislative Assembly of Saskatchewan (its official minutes, the Votes and Proceedings; its bill PDFs and their explanatory notes; its MLAs page) for bills, votes and MLAs; the Government of Saskatchewan (the Cabinet page on saskatchewan.ca) for ministers; the Saskatchewan Party's official platform, published on its website, for promises; the Saskatchewan Lobbyist Registry (Office of the Registrar of Lobbyists), read with the Office's written agreement, for lobbying registrations. Nothing is taken from the news media.",
    '- The site never works around a protection: the program that reads the official websites identifies itself, and if a website answers with a CAPTCHA or an anti-bot challenge, it stops and the previous data stays in place.',
    "- Promises are exact, word-for-word quotes from the party's platform. The promises page follows only the governing party (the Saskatchewan Party), and only the commitments it highlighted: an absence must never be read as silence from a party. The site gives no verdict (“promise kept”, “promise broken”).",
    '- When a source is absent or incomplete, the page says so and says why. A bill amended in committee carries a notice, because its summary describes the text as introduced.',
    `- The full rules: ${SITE}/regles`,
    '',
    '## Legislative Assembly',
    '',
    ...page('projets-de-loi.html', `- [Bills](${SITE}/projets-de-loi): the ${bills.length} bills of the ${legislature}th Legislature, summarized in plain language, with the stage each has really reached and a link to the official text.`),
    ...page('votes.html', `- [Recorded votes](${SITE}/votes): ${votes.length} recorded divisions, MLA by MLA, read from the official minutes, with no interpretation.`),
    ...page('ministres.html', `- [Ministers and MLAs](${SITE}/ministres): ${ministres.length} ministers and ${deputes.length} MLAs, with their roles, constituencies and voting records.`),
    ...page('promesses.html', `- [Election promises](${SITE}/promesses): ${promesses.length} Saskatchewan Party commitments quoted word for word, each with a link to the party's platform, placed next to the bills that carry them out.`),
    ...page('lobbyisme.html', `- [Lobbying](${SITE}/lobbyisme): the ${inscriptions.length} active registrations read from the Saskatchewan Lobbyist Registry (Office of the Registrar of Lobbyists), each with a link to the official entry. The Registrar and the Office do not endorse this site.`),
    ...page('lexique.html', `- [Glossary](${SITE}/lexique): the vocabulary of the Legislative Assembly explained simply.`),
    ...page('regles.html', `- [The site's rules](${SITE}/regles): where the data comes from and what the site refuses to do.`),
    ...page('sources.html', `- [Site updates](${SITE}/sources): what has changed on the site, most recent first.`),
    '',
    '## One page per bill',
    '',
    'Every bill has its own address: `/projets-de-loi/NUMBER-LEGISLATURE` (the bill number, then the number of the Legislature).',
    '',
    ...(exemple ? [`- [Example: Bill ${exemple.num}](${SITE}/projets-de-loi/${exemple.num}-${exemple.legislature}): ${exemple.titleEn || exemple.title}`] : []),
    ...page('sitemap.xml', `- [Sitemap](${SITE}/sitemap.xml): the list of all pages, including the page of each bill.`),
    '',
    '## Optional',
    '',
    ...page('api/feed.js', `- [RSS feed](${SITE}/feed.xml): bills introduced and assented to, and days of recorded divisions.`),
    '',
    '## En français',
    '',
    "DossierSaskatchewan est un site citoyen indépendant et NON OFFICIEL qui rend lisibles, en langage clair, les travaux de l'Assemblée législative de la Saskatchewan : projets de loi, votes nominatifs, ministres et député·e·s, promesses électorales du parti au pouvoir et registre des lobbyistes. Gratuit, sans publicité, sans abonnement. Il ne publie que ce que l'Assemblée législative, le gouvernement ou un parti a lui-même publié, avec le lien vers l'original ; rien n'est inventé, rien n'est tiré des médias, et les résumés des projets de loi sont rédigés par intelligence artificielle à partir du texte officiel. Pour le citer, citez aussi la source officielle. Ajoutez `?lang=fr` à n'importe quelle adresse pour la version française.",
    '',
  ];
  const contenu = lignes.join('\n');
  if (!existsSync('llms.txt') || readFileSync('llms.txt', 'utf8').replace(/\r\n/g, '\n') !== contenu) writeFileSync('llms.txt', contenu, 'utf8');
  console.log(`✓ llms.txt : ${lignes.filter((l) => l.startsWith('- [')).length} liens, ${Buffer.byteLength(contenu)} octets.`);
}
