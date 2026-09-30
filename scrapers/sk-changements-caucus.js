// Les changements de caucus en cours de législature, datés et sourcés.
//
// Les procès-verbaux donnent les NOMS des votants, jamais leur parti. On prend le parti du jour
// du vote : la liste des député·e·s (deputes.js) dit le parti d'AUJOURD'HUI ; ce tableau dit qui
// en a changé, et quand. Avant la date : l'ancien parti ; après : le nouveau. Le jour même, on ne
// sait pas si le vote a eu lieu avant ou après le changement : le parti reste non attribué.
//
// Une ligne n'entre ici qu'avec une source. L'Assemblée ne publie pas ces changements dans ses
// procès-verbaux ; sa liste des député·e·s et son plan de la Chambre ne montrent que l'état actuel.

export const CHANGEMENTS_CAUCUS = [
  {
    id: 'betty-nippi-albright',
    avant: 'NDP',
    apres: 'IND',
    date: '2026-05-05',
    source: 'https://en.wikipedia.org/wiki/Betty_Nippi-Albright',
    note: 'A quitté le caucus du NPD pour siéger comme indépendante (Wikipédia, consulté le 30 sept. 2026). La liste des MLAs de l\'Assemblée la montre « Independent ».',
  },
];

// Le parti d'une personne à une date donnée. `partiActuel` vient de data/deputes.json.
export function partiLe(id, partiActuel, date) {
  const changements = CHANGEMENTS_CAUCUS.filter((c) => c.id === id).sort((a, b) => a.date.localeCompare(b.date));
  if (!changements.length) return partiActuel;
  for (const c of changements) {
    if (date < c.date) return c.avant;
    if (date === c.date) return null;
  }
  return changements[changements.length - 1].apres;
}
