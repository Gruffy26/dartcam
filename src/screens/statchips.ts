// Petites pastilles de statistiques, les mêmes en fin de partie et dans l'historique.

import { h } from '../dom';
import type { X01Analysis } from '../game/analysis';

const fmt1 = (v: number) => v.toFixed(1).replace('.', ',');

function chip(label: string, value: string, strong = false): HTMLElement {
  return h('span', { class: 'chip' + (strong ? ' strong' : '') }, h('b', {}, value), h('small', {}, label));
}

/** Ce qu'un joueur de X01 regarde : moyenne, départ de manche, finishes, grosses volées. */
export function statChips(a: X01Analysis): HTMLElement {
  const items = [
    chip('moyenne', fmt1(a.average), true),
    chip('9 premières', fmt1(a.first9)),
    chip('finish', a.attempts ? `${Math.round(a.checkout)} %` : '—'),
    a.bestCheckout ? chip('meilleur finish', String(a.bestCheckout)) : null,
    a.s180 ? chip('180', `×${a.s180}`, true) : null,
    a.s140 ? chip('140+', `×${a.s140}`) : null,
    a.s100 ? chip('100+', `×${a.s100}`) : null,
    a.s60 ? chip('60+', `×${a.s60}`) : null,
  ].filter(Boolean) as HTMLElement[];
  return h('div', { class: 'chips' }, ...items);
}
