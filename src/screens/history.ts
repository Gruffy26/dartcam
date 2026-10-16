import { h } from '../dom';
import { clearHistory, history, totals, trainingProgress, type GameRecord } from '../game/history';
import { icon } from '../icons';
import type { Nav } from '../main';
import { appBar, group, row } from '../ui';

const fmt1 = (v: number) => v.toFixed(1).replace('.', ',');

/** « hier », « mardi 14 », « 3 oct. » selon l'ancienneté. */
function whenText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (days <= 0) return `aujourd’hui ${hm}`;
  if (days === 1) return `hier ${hm}`;
  if (days < 7) return `${d.toLocaleDateString('fr-FR', { weekday: 'long' })} ${hm}`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function gameCard(g: GameRecord): HTMLElement {
  return h(
    'article',
    { class: 'hist-card' },
    h('div', { class: 'hist-head' }, h('b', {}, g.label), h('span', {}, whenText(g.at))),
    h(
      'div',
      { class: 'hist-players' },
      ...g.players.map((p) =>
        h(
          'div',
          { class: 'hist-player' + (p.won ? ' won' : '') },
          // Seul contre soi-même, la coupe n'apprend rien : c'est le score qui compte.
          h('span', { class: 'hist-name' }, p.won && g.players.length > 1 ? '🏆 ' + p.name : p.name),
          h('span', { class: 'hist-res' }, p.result),
          h('span', { class: 'hist-darts' }, `${p.darts} fl.`),
        ),
      ),
    ),
  );
}

export function historyScreen(nav: Nav): HTMLElement {
  const games = history();
  const list = h('div', { class: 'hist-list' }, ...games.map(gameCard));

  const drills = trainingProgress(games);
  const body = games.length
    ? [
        ...(drills.length
          ? [
              group(
                'Progression à l’entraînement',
                ...drills.map((d) =>
                  row(
                    d.label.replace('Entraînement · ', ''),
                    `${d.count} séance${d.count > 1 ? 's' : ''} · dernière ${d.last}`,
                    h('span', { class: 'tot-right' }, h('b', {}, String(d.best)), h('small', {}, 'record')),
                  ),
                ),
              ),
            ]
          : []),
        group(
          'Depuis le début',
          ...totals(games).map((t) =>
            row(
              t.name,
              `${t.games} partie${t.games > 1 ? 's' : ''} · ${t.wins} gagnée${t.wins > 1 ? 's' : ''} · ${t.darts} fléchettes`,
              h(
                'span',
                { class: 'tot-right' },
                h('b', {}, t.average ? fmt1(t.average) : '—'),
                h('small', {}, t.best ? `record ${t.best}` : 'moyenne X01'),
              ),
            ),
          ),
        ),
        h('h2', { class: 'group-title' }, `${games.length} partie${games.length > 1 ? 's' : ''}`),
        list,
        h(
          'button',
          {
            class: 'btn danger block',
            onclick: () => {
              if (!confirm('Effacer tout l’historique des parties ?')) return;
              clearHistory();
              nav('history');
            },
          },
          icon('trash', 20),
          'Effacer l’historique',
        ),
      ]
    : [
        h(
          'div',
          { class: 'empty-state' },
          h('div', { class: 'empty-ic' }, icon('flag', 28)),
          h('b', {}, 'Aucune partie terminée'),
          h('p', {}, 'Joue une partie jusqu’au bout : elle s’ajoutera ici avec tes moyennes.'),
        ),
      ];

  return h('main', { class: 'page history' }, appBar({ title: 'Historique', onBack: () => nav('home') }), ...body);
}
