// Suggestion de finish (« checkout ») : la meilleure façon de finir un score en au plus
// N fléchettes, en terminant sur un double (ou le bull) si « double out ».

import { makeScore, type Score } from '../board';

const ALL: Score[] = [];
for (let n = 1; n <= 20; n++) for (const m of [1, 2, 3] as const) ALL.push(makeScore(n, m));
ALL.push(makeScore(25, 1), makeScore(25, 2));

/** Doubles de fin préférés des joueurs (faciles à enchaîner en cas de simple). */
const FINISH_PREF = ['D20', 'D16', 'D8', 'D18', 'D12', 'D10', 'D4', 'D2', 'D6', 'D14', 'BULL', 'D1'];
/** Fléchettes de préparation préférées. */
const SETUP_PREF = ['T20', 'T19', 'T18', 'T17', 'T16', 'T15', '20', '19', '18', '17', '16', '15'];

function finishCost(s: Score): number {
  const i = FINISH_PREF.indexOf(s.libelle);
  return i >= 0 ? i : 20 + (20 - s.secteur);
}

function setupCost(s: Score): number {
  const i = SETUP_PREF.indexOf(s.libelle);
  if (i >= 0) return i;
  if (s.secteur === 25) return 40; // le bull en préparation : seulement si nécessaire
  return 15 + (s.multiplicateur === 3 ? 0 : 5) + (20 - s.secteur) * 0.5;
}

/** Meilleur finish, ou null s'il n'y en a pas en `maxDarts` fléchettes. */
export function suggestCheckout(remaining: number, maxDarts = 3, doubleOut = true): Score[] | null {
  if (remaining <= 0 || remaining > 180) return null;
  const finishers = ALL.filter((s) => !doubleOut || s.multiplicateur === 2);
  let best: { darts: Score[]; cost: number } | null = null;
  const consider = (darts: Score[]) => {
    const last = darts[darts.length - 1];
    const cost = darts.length * 1000 + finishCost(last) * 10 + darts.slice(0, -1).reduce((c, d) => c + setupCost(d), 0);
    if (!best || cost < best.cost) best = { darts, cost };
  };
  for (const f of finishers) if (f.points === remaining) consider([f]);
  if (maxDarts >= 2 && !best)
    for (const a of ALL) for (const f of finishers) if (a.points + f.points === remaining) consider([a, f]);
  if (maxDarts >= 3 && !best)
    for (const a of ALL) for (const b of ALL) for (const f of finishers) if (a.points + b.points + f.points === remaining) consider([a, b, f]);
  return best ? (best as { darts: Score[] }).darts : null;
}
