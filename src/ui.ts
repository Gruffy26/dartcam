// Composants d'interface réutilisables : barre de titre, fenêtre du bas (« sheet »),
// interrupteur, choix segmenté, ligne de liste.

import { h } from './dom';
import { icon } from './icons';

/** Barre de titre : bouton retour, titre, action à droite. */
export function appBar(opts: { title: string; onBack?: () => void; right?: HTMLElement | null }): HTMLElement {
  return h(
    'header',
    { class: 'appbar' },
    opts.onBack
      ? h('button', { class: 'iconbtn', 'aria-label': 'Retour', onclick: opts.onBack }, icon('back'))
      : h('span', { class: 'iconbtn-spacer' }),
    h('h1', {}, opts.title),
    opts.right ?? h('span', { class: 'iconbtn-spacer' }),
  );
}

export function iconButton(name: string, label: string, onclick: () => void): HTMLButtonElement {
  return h('button', { class: 'iconbtn', 'aria-label': label, onclick }, icon(name));
}

export function button(
  label: string | Node,
  onclick: () => void,
  variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary',
  iconName?: string,
): HTMLButtonElement {
  return h('button', { class: `btn ${variant}`, onclick }, iconName ? icon(iconName, 20) : null, label);
}

/** Interrupteur façon iOS. */
export function toggle(checked: boolean, onchange: (v: boolean) => void, label: string): HTMLLabelElement {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, 'aria-label': label });
  input.addEventListener('change', () => onchange(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'track' }, h('span', { class: 'thumb' })));
}

/** Choix segmenté (une seule valeur). */
export function segmented<T extends string | number | boolean>(
  options: { value: T; label: string }[],
  value: T,
  onchange: (v: T) => void,
): HTMLElement {
  const root = h('div', { class: 'segmented', role: 'radiogroup' });
  const render = (current: T) =>
    root.replaceChildren(
      ...options.map((o) =>
        h(
          'button',
          {
            class: 'seg' + (o.value === current ? ' on' : ''),
            role: 'radio',
            'aria-checked': String(o.value === current),
            onclick: () => {
              render(o.value);
              onchange(o.value);
            },
          },
          o.label,
        ),
      ),
    );
  render(value);
  return root;
}

/** Ligne d'une liste de réglages : titre, sous-titre, contrôle à droite. */
export function row(title: string, subtitle: string | null, control: Node | null, onclick?: () => void, lead?: string): HTMLElement {
  const content = [
    lead ? h('span', { class: 'row-lead' }, icon(lead, 20)) : null,
    h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, title), subtitle ? h('span', { class: 'row-sub' }, subtitle) : null),
    control,
  ];
  return onclick
    ? h('button', { class: 'row clickable', onclick }, ...content, icon('back', 18))
    : h('div', { class: 'row' }, ...content);
}

export function group(title: string | null, ...rows: Node[]): HTMLElement {
  return h('section', { class: 'group' }, title ? h('h2', { class: 'group-title' }, title) : null, h('div', { class: 'group-body' }, ...rows));
}

export interface SheetHandle {
  el: HTMLElement;
  close(): void;
}

/**
 * Fenêtre qui glisse du bas de l'écran, au-dessus d'un voile sombre.
 * Se ferme en touchant le voile ou en appelant `close()`.
 */
export function openSheet(content: Node[], opts: { title?: string; onClose?: () => void; tall?: boolean } = {}): SheetHandle {
  const backdrop = h('div', { class: 'backdrop' });
  const panel = h(
    'div',
    { class: 'sheet' + (opts.tall ? ' tall' : ''), role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'grabber' }),
    opts.title
      ? h('div', { class: 'sheet-head' }, h('h2', {}, opts.title), h('button', { class: 'iconbtn', 'aria-label': 'Fermer', onclick: () => close() }, icon('close')))
      : null,
    h('div', { class: 'sheet-body' }, ...content),
  );
  const layer = h('div', { class: 'sheet-layer' }, backdrop, panel);
  document.body.append(layer);
  requestAnimationFrame(() => layer.classList.add('open'));
  setTimeout(() => layer.classList.add('open'), 30); // au cas où l'animation est suspendue
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    layer.classList.remove('open');
    setTimeout(() => layer.remove(), 250);
    opts.onClose?.();
  }
  backdrop.addEventListener('click', close);
  return { el: panel, close };
}
