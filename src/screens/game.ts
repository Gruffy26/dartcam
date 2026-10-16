import { calibrationStillValid, detectBoard } from '../auto-run';
import {
  boardOverlay,
  calibrationMismatch,
  cameraPlacement,
  frameToBoard,
  loadCalibration,
  placementAdvice,
  reprojectionError,
  saveCalibration,
  tryBoardToFrame,
  type Calibration,
} from '../calibration';
import { createCameraStage, type FrameInfo } from '../camera-stage';
import { DartDetector, type DartEvent } from '../detector/detector';
import { h } from '../dom';
import { frameToScreen } from '../frameview';
import { suggestCheckout } from '../game/checkout';
import { clearGame, loadGame, saveGame } from '../game/store';
import { commitTurn, evaluateTurn, newGame, playerStats, remainingScores, undoTurn, type GameState, type TurnEval } from '../game/x01';
import { type Mat3, type Pt } from '../homography';
import { icon } from '../icons';
import type { Nav, Screen } from '../main';
import { loadOpenCV, type CV } from '../opencv';
import { drawBoardOverlay, fitCanvas } from '../overlay-draw';
import { getSettings } from '../settings';
import { speak } from '../speech';
import { appBar, iconButton, openSheet, type SheetHandle } from '../ui';
import { Volley, type DartRecord } from '../volley';
import { addVolley } from '../dataset';
import { openCorrection } from './correct';

/** Largeur de repli si le téléphone n'arrive pas à suivre la largeur demandée. */
export const FALLBACK_WIDTH = 640;
/** Au-delà de ce temps d'analyse moyen, on redescend d'un cran. */
const SLOW_MS = 85;
/** Cadence d'analyse quand quelque chose se passe (≈10 images par seconde). */
const ACTIVE_INTERVAL_MS = 100;
/**
 * Cadence au repos. Entre deux lancers il ne se passe rien : analyser dix fois par
 * seconde ne sert qu'à chauffer le téléphone. Dès qu'une image bouge, on repasse à la
 * cadence pleine, et la fléchette n'est de toute façon mesurée qu'une fois immobile.
 */
const IDLE_INTERVAL_MS = 320;

type StatusKind = 'info' | 'ready' | 'wait' | 'alert';

// Écran de partie : les scores d'abord, la caméra en aperçu (agrandissable).
// Détection automatique des fléchettes, règles X01, retrait des fléchettes,
// corrections en touchant une fléchette, annonce vocale, sauvegarde continue.
export function gameScreen(nav: Nav): Screen {
  const saved = loadGame();
  if (!saved) {
    queueMicrotask(() => nav('setup'));
    return document.createElement('main');
  }
  let game: GameState = saved.state;
  let volley = new Volley();
  volley.darts = saved.pending ?? [];
  /** Image analysée et calibration au moment de chaque fléchette (pour la corriger de face). */
  const shots = new Map<number, { img: ImageData; f2b: Mat3 }>();
  /** Cible avant la première fléchette de la volée (enregistrement seulement). */
  let startShot: { img: ImageData; f2b: Mat3 } | null = null;
  /** Il faut (re)prendre cette image de référence : début de partie ou fléchettes retirées. */
  let wantStart = true;
  let announced = '';

  const cam = createCameraStage(nav, { chrome: false });
  const debugMode = getSettings().debug;
  let disposed = false;
  let timer = 0;
  let raf = 0;
  let cv: CV | null = null;
  let cal: Calibration | null = null;
  let detector: DartDetector | null = null;
  let detSize = { w: 0, h: 0 };
  let run = 0;
  let lockInfo = '';
  let fps = 0;
  let frames = 0;
  let lastFpsT = performance.now();
  let lastPopped = -1;
  let sheet: SheetHandle | null = null;
  /** Une fléchette est en cours de correction : le retrait automatique attend. */
  let editing = false;
  let clearPending = false;
  const endEditing = () => {
    editing = false;
    if (clearPending) {
      clearPending = false;
      cleared(false);
    }
  };

  // --- Éléments ---------------------------------------------------------
  const title = `${game.config.start} · ${game.config.doubleOut ? 'double out' : 'sortie libre'}`;
  const scores = h('section', { class: 'scores' });
  const dartsRow = h('div', { class: 'darts' });
  const status = h('div', { class: 'status' }, h('span'));
  const volleySec = h('section', { class: 'volley-sec' }, dartsRow, status);

  const overlay = h('canvas', { class: 'overlay interactive' });
  const expandBtn = h('button', { class: 'cam-expand', 'aria-label': 'Agrandir la caméra', onclick: () => toggleExpand() }, icon('expand'));
  const strip = h('div', { class: 'cam-strip' });
  const stats = h('div', { class: 'stats debug-stats' });
  const maskCanvas = h('canvas');
  const insets = h('div', { class: 'insets hidden' }, h('figure', {}, maskCanvas, h('figcaption', {}, 'Masque')));
  cam.el.insertBefore(overlay, cam.el.children[1]);
  const camWrap = h('section', { class: 'cam-wrap' }, cam.el, expandBtn, strip);
  if (debugMode) camWrap.append(insets, stats);

  const missBtn = h('button', { class: 'btn', onclick: () => miss() }, icon('miss', 20), 'Raté');
  const undoBtn = h('button', { class: 'btn', onclick: () => undo() }, icon('undo', 20), 'Annuler');
  const clearBtn = h('button', { class: 'btn primary', onclick: () => cleared(true) }, icon('hand', 20), 'Retirées');
  const endLayer = h('div', { class: 'end hidden' });

  const el = h(
    'main',
    { class: 'game' },
    appBar({ title, onBack: () => nav('home'), right: iconButton('menu', 'Menu', () => gameMenu()) }),
    scores,
    volleySec,
    camWrap,
    h('footer', { class: 'actions' }, missBtn, undoBtn, clearBtn),
    endLayer,
  );

  function setStatus(text: string, kind: StatusKind = 'info') {
    status.className = `status ${kind}`;
    status.firstElementChild!.textContent = text;
  }

  // --- Cible : détection automatique à l'ouverture de la caméra ------------
  async function findBoard() {
    const id = ++run;
    const kind = cam.source?.kind;
    if (!kind) return;
    cal = null;
    dropDetector();
    setStatus('Recherche de la cible…', 'wait');
    const res = await detectBoard(cam, () => disposed || id !== run);
    if (disposed || id !== run) return;
    const f = cam.frame();
    if (res.ok && f) {
      useCalibration({
        version: 1,
        kind,
        points: res.points,
        zoom: cam.zoomValue(),
        aspect: f.crop.w / f.crop.h,
        createdAt: new Date().toISOString(),
        method: 'auto',
      });
      saveCalibration(cal!);
      warnPlacement(res.points, f);
      return;
    }
    // Échec : la calibration précédente est-elle toujours bonne (trépied pas bougé) ?
    const saved = loadCalibration(kind);
    if (saved && f && !calibrationMismatch(saved, { zoom: cam.zoomValue(), aspect: f.crop.w / f.crop.h })) {
      if (await calibrationStillValid(cam, saved)) {
        if (disposed || id !== run) return;
        useCalibration(saved);
        warnPlacement(saved.points, f);
        return;
      }
    }
    setStatus('Cible non trouvée : vérifie le cadrage et la lumière (menu › Redétecter)', 'alert');
  }

  /**
   * La détection n'est bonne que si la caméra est nettement sur le côté : dans l'axe de
   * la cible, la fléchette pointe vers l'objectif et sa longueur à l'image s'écrase.
   */
  function warnPlacement(points: Pt[], f: FrameInfo | null) {
    const a = f ? f.crop.w / f.crop.h : null;
    const place = a ? placementAdvice(cameraPlacement(points, 1000, 1000 / a)) : null;
    if (place?.warn) setStatus(place.text, 'alert');
    else setStatus('Cible trouvée. Ne touche plus le téléphone…', 'wait');
  }

  function useCalibration(c: Calibration) {
    cal = c;
    scheduleDraw();
    dropDetector();
    // Exposition / balance des blancs bloquées si possible (luminosité stable).
    void cam.source?.lock().then((info) => (lockInfo = info));
  }

  function dropDetector() {
    detector?.dispose();
    detector = null;
  }

  let zoomTimer = 0;
  cam.enablePinch(overlay);
  cam.onChange((reason) => {
    scheduleDraw();
    if (reason === 'pinch') return;
    if (reason === 'zoom') {
      cal = null;
      dropDetector();
      run++;
      setStatus('Zoom… la cible sera redétectée', 'wait');
      clearTimeout(zoomTimer);
      zoomTimer = window.setTimeout(() => void findBoard(), 800);
      return;
    }
    cal = null;
    dropDetector();
    run++;
    const start = () => (cam.frame() ? void findBoard() : cam.source && setTimeout(start, 100));
    start();
  });

  function toggleExpand(force?: boolean) {
    const on = force ?? !camWrap.classList.contains('expanded');
    camWrap.classList.toggle('expanded', on);
    expandBtn.replaceChildren(icon(on ? 'collapse' : 'expand'));
    expandBtn.setAttribute('aria-label', on ? 'Réduire la caméra' : 'Agrandir la caméra');
  }

  // --- Volée et règles du jeu ---------------------------------------------
  const persist = () => saveGame({ state: game, pending: volley.darts });
  const remaining = () => remainingScores(game);
  const playerName = (i: number) => game.config.players[i];

  function turnEval(): TurnEval {
    return evaluateTurn(remaining()[game.current], volley.darts.map((d) => d.score), game.config.doubleOut);
  }
  /** La volée est terminée : 3 fléchettes, bust ou victoire. */
  const turnOver = () => volley.full || turnEval().over;

  function afterChange() {
    const ev = turnEval();
    if (turnOver()) {
      detector?.setMode('removal');
      const name = playerName(game.current);
      if (ev.finished) setStatus(`${name} finit ! Retire tes fléchettes pour valider`, 'ready');
      else if (ev.bust) setStatus(`Bust : ${name} reste à ${ev.remaining}. Va retirer tes fléchettes`, 'alert');
      else setStatus(`Volée de ${ev.scored}. Va retirer tes fléchettes`, 'wait');
      // Annonce vocale (une seule fois, sauf si une correction change le résultat).
      const key = `${ev.bust}:${ev.finished}:${ev.scored}`;
      if (key !== announced) {
        announced = key;
        speak(ev.finished ? `Partie gagnée par ${name} !` : ev.bust ? 'Bust !' : String(ev.scored));
      }
    } else {
      detector?.setMode('throwing');
      announced = '';
    }
    persist();
    render();
    scheduleDraw();
  }

  function onDart(ev: DartEvent, img: ImageData) {
    if (turnOver()) return;
    const rec = volley.addDetected(ev.score, ev.tip, ev.board);
    if (!rec) return;
    rec.uncertain = ev.uncertain;
    if (detector) shots.set(rec.id, { img, f2b: detector.frameToBoard });
    lastPopped = rec.id;
    if (!turnOver()) setStatus(ev.uncertain ? `${ev.score.libelle} — score limite, vérifie` : `${ev.score.libelle} (${ev.score.points})`, ev.uncertain ? 'alert' : 'ready');
    afterChange();
  }

  function miss() {
    if (turnOver()) {
      setStatus('Volée terminée : touche une fléchette pour la corriger', 'info');
      return;
    }
    const rec = volley.addMiss();
    detector?.noteManualDart();
    if (rec) lastPopped = rec.id;
    setStatus('Fléchette ratée ajoutée', 'info');
    afterChange();
  }

  function undo() {
    const d = volley.undo();
    if (!d) return;
    shots.delete(d.id);
    setStatus(`Fléchette ${d.score.libelle} annulée`, 'info');
    afterChange();
  }

  /** Fléchettes retirées (automatiquement ou au bouton) : la volée est enregistrée. */
  /** Garde les fléchettes de la volée pour améliorer la détection (si l'option est active). */
  function capture(darts: DartRecord[], note = '') {
    if (!getSettings().collect || !darts.length) return;
    const err = cal && detSize.w ? reprojectionError(cal.points, detSize.w, detSize.h) : 0;
    void addVolley(darts, new Map(shots), cal, err, getSettings().detector, __BUILD_ID__, note, note ? null : startShot);
  }

  function cleared(manual: boolean) {
    if (volley.darts.length && game.winner == null) {
      capture(volley.darts);
      const before = game.current;
      game = commitTurn(game, volley.darts.map((d) => d.score));
      const last = game.turns[game.turns.length - 1];
      volley = new Volley();
      shots.clear();
      announced = '';
      if (game.winner != null) {
        persist();
        showEnd();
        return;
      }
      const next = game.current;
      const rem = remaining()[next];
      setStatus(`${last.bust ? 'Bust' : `${playerName(before)} : ${last.before - last.after}`} — à ${playerName(next)}${manual ? ', attends « Prêt »' : ''}`, 'wait');
      speak(game.config.players.length > 1 ? `À ${playerName(next)}, il reste ${rem}.` : `Il reste ${rem}.`);
    } else if (manual) setStatus('Nouvelle image de référence… attends « Prêt »', 'wait');
    volley = new Volley();
    shots.clear();
    announced = '';
    wantStart = true;
    if (manual) detector?.resetReference();
    else detector?.setMode('throwing');
    afterChange();
  }

  // --- Affichage ------------------------------------------------------------
  function render() {
    const ev = turnEval();
    const rem = remaining();
    const st = playerStats(game);
    const cur = game.current;
    const shown = ev.bust ? rem[cur] : ev.remaining;

    // Joueur actif en très gros, finish proposé, autres joueurs en dessous.
    const left = 3 - volley.darts.length;
    let co: HTMLElement | null = null;
    if (game.winner == null && !ev.over && shown <= 170) {
      const route = suggestCheckout(shown, left, game.config.doubleOut);
      co = route
        ? h('div', { class: 'checkout' }, route.map((d) => d.libelle).join('  ·  '))
        : h('div', { class: 'checkout none' }, `Pas de finish en ${left} fléchette${left > 1 ? 's' : ''}`);
    }
    const active = h(
      'div',
      { class: 'active-card' },
      h(
        'div',
        { class: 'active-head' },
        h('span', { class: 'active-name' }, playerName(cur)),
        h('span', { class: 'active-avg' }, st[cur].darts ? `moy. ${fmt1(st[cur].average)}` : `${game.config.start}`),
      ),
      h('div', { class: 'active-remaining' + (ev.bust ? ' bust' : '') }, String(shown)),
      co,
    );
    const others =
      game.config.players.length > 1
        ? h(
            'div',
            { class: 'others' },
            ...game.config.players
              .map((name, i) => ({ name, i }))
              .filter(({ i }) => i !== cur)
              .map(({ name, i }) => h('div', { class: 'other' }, h('span', { class: 'other-name' }, name), h('span', { class: 'other-rem' }, String(rem[i])))),
          )
        : null;
    scores.replaceChildren(...(others ? [active, others] : [active]));

    // Les 3 fléchettes : touchables pour corriger (ou ajouter une fléchette oubliée).
    const cards = [0, 1, 2].map((i) => {
      const d = volley.darts[i];
      if (!d) {
        const canAdd = i === volley.darts.length && !turnOver();
        return h(
          'button',
          { class: 'dart empty', 'aria-label': 'Ajouter une fléchette', onclick: () => canAdd && addDart() },
          canAdd ? icon('plus', 26) : '',
        );
      }
      const counted = i < ev.used || !ev.over;
      const cls =
        'dart' +
        (d.uncertain && !d.corrected ? ' uncertain' : '') +
        (d.corrected || d.origin === 'manual' ? ' fixed' : '') +
        (!counted ? ' void' : '') +
        (d.id === lastPopped ? ' pop' : '');
      return h('button', { class: cls, 'aria-label': `Corriger la fléchette ${i + 1}`, onclick: () => editDart(i) }, d.score.libelle);
    });
    lastPopped = -1;
    dartsRow.replaceChildren(
      ...cards,
      h('div', { class: 'volley-total' + (ev.bust ? ' bust' : '') }, ev.bust ? 'BUST' : String(ev.scored)),
    );

    strip.replaceChildren(
      h('span', {}, playerName(cur)),
      h('span', {}, volley.darts.map((d) => d.score.libelle).join('  ') || '—'),
      h('span', { class: 'rem' }, String(shown)),
    );
    undoBtn.disabled = volley.darts.length === 0;
    missBtn.disabled = turnOver();
  }

  // --- Corrections -------------------------------------------------------------
  function currentShot(): { img: ImageData; f2b: Mat3 } | null {
    const f = cam.frame();
    if (!f || !detector) return null;
    const img = grab(f);
    return img ? { img, f2b: detector.frameToBoard } : null;
  }

  function editDart(i: number) {
    const d = volley.darts[i];
    if (!d) return;
    const shot = shots.get(d.id) ?? currentShot();
    editing = true;
    openCorrection({
      onClose: endEditing,
      title: `Fléchette ${i + 1}`,
      image: shot?.img ?? null,
      frameToBoard: shot?.f2b ?? null,
      current: { score: d.score, board: d.board },
      others: volley.darts.filter((x, k) => k !== i && x.board).map((x) => x.board!),
      onConfirm: (score, board) => {
        // Position corrigée sur la vue de face (ou score choisi au pavé) ; la pointe à
        // l'image n'est plus exacte mais sert seulement au repère sur l'aperçu.
        volley.correct(i, score, d.tip, board ?? (score.points === 0 ? null : d.board));
        d.uncertain = false;
        lastPopped = d.id;
        setStatus(`Fléchette ${i + 1} corrigée : ${score.libelle}`, 'info');
        afterChange();
      },
      onDelete: () => {
        // Fléchette détectée à tort : l'exemple est précieux, on le garde avant d'effacer.
        if (d.origin === 'auto') capture([d], 'supprimee');
        volley.darts.splice(i, 1);
        shots.delete(d.id);
        setStatus(`Fléchette ${d.score.libelle} supprimée`, 'info');
        afterChange();
      },
    });
  }

  function addDart() {
    const shot = currentShot();
    editing = true;
    openCorrection({
      onClose: endEditing,
      title: 'Ajouter une fléchette',
      image: shot?.img ?? null,
      frameToBoard: shot?.f2b ?? null,
      current: null,
      others: volley.darts.filter((x) => x.board).map((x) => x.board!),
      onConfirm: (score, board) => {
        const rec = score.points === 0 && !board ? volley.addMiss() : volley.addManual(score, null, board);
        if (!rec) return;
        if (shot) shots.set(rec.id, shot);
        detector?.noteManualDart();
        lastPopped = rec.id;
        setStatus(`Fléchette ajoutée : ${score.libelle}`, 'info');
        afterChange();
      },
    });
  }

  // --- Menu -------------------------------------------------------------------
  function gameMenu() {
    sheet?.close();
    const item = (label: string, iconName: string, fn: () => void, variant = '') =>
      h('button', { class: `btn block ${variant}`, onclick: () => (sheet?.close(), fn()) }, icon(iconName, 20), label);
    sheet = openSheet(
      [
        h(
          'div',
          { class: 'menu-list' },
          item('Agrandir la caméra', 'expand', () => toggleExpand(true)),
          item('Redétecter la cible', 'refresh', () => void findBoard()),
          item('Ajuster la cible à la main', 'target', () => nav('calibrate')),
          item('Annuler la volée précédente', 'undo', () => {
            if (!game.turns.length) return;
            game = undoTurn(game);
            volley = new Volley();
            shots.clear();
            setStatus(`Volée précédente annulée : ${playerName(game.current)} rejoue`, 'info');
            afterChange();
          }),
          item('Abandonner la partie', 'flag', () => (clearGame(), nav('home')), 'danger'),
        ),
      ],
      { title: 'Partie' },
    );
  }

  // --- Fin de partie --------------------------------------------------------
  function showEnd() {
    const w = game.winner!;
    const st = playerStats(game);
    speak(`Victoire de ${playerName(w)} ! Moyenne ${Math.round(st[w].average)}.`);
    detector?.setMode('removal');
    toggleExpand(false);
    endLayer.replaceChildren(
      h('div', { class: 'trophy' }, '🏆'),
      h('h2', {}, `${playerName(w)} gagne`),
      h(
        'div',
        { class: 'stats-table' },
        h('div', { class: 'stat-row head' }, h('span', { class: 'n' }, 'Joueur'), h('span', {}, 'Moy. / volée'), h('span', {}, 'Fléchettes'), h('span', {}, 'Meilleure')),
        ...st.map((p, i) =>
          h(
            'div',
            { class: 'stat-row' + (i === w ? ' winner' : '') },
            h('span', { class: 'n' }, p.name),
            h('span', {}, fmt1(p.average)),
            h('span', {}, String(p.darts)),
            h('span', {}, String(p.best)),
          ),
        ),
      ),
      h(
        'div',
        { class: 'end-actions' },
        h('button', { class: 'btn primary lg block', onclick: () => rematch() }, icon('refresh', 20), 'Revanche'),
        h('button', { class: 'btn lg block', onclick: () => (clearGame(), nav('setup')) }, 'Nouvelle partie'),
        h('button', { class: 'btn ghost block', onclick: () => (clearGame(), nav('home')) }, 'Accueil'),
      ),
    );
    endLayer.classList.remove('hidden');
    render();
  }

  function rematch() {
    game = newGame(game.config);
    volley = new Volley();
    shots.clear();
    announced = '';
    persist();
    endLayer.classList.add('hidden');
    speak(`Revanche ! À ${playerName(0)}.`);
    setStatus(`Revanche — à ${playerName(0)}, attends « Prêt »`, 'wait');
    detector?.resetReference();
    afterChange();
  }

  // --- Analyse des images -------------------------------------------------
  /** Largeur d'analyse en cours (réglable, avec repli automatique). */
  let analysisWidth = Math.max(320, Math.round(getSettings().analysisWidth));
  /** Temps d'analyse des dernières images, pour décider du repli. */
  const times: number[] = [];
  /** Dernier événement du détecteur : on reste réactif juste après. */
  let lastEventAt = 0;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  function grab(f: FrameInfo): ImageData | null {
    const v = cam.source?.video;
    if (!v) return null;
    // Inutile d'agrandir au-delà de ce que la caméra fournit réellement.
    const w = Math.min(analysisWidth, Math.round(f.crop.w));
    const hh = Math.round((f.crop.h * w) / f.crop.w);
    if (canvas.width !== w || canvas.height !== hh) {
      canvas.width = w;
      canvas.height = hh;
    }
    ctx.drawImage(v, f.crop.x, f.crop.y, f.crop.w, f.crop.h, 0, 0, w, hh);
    return ctx.getImageData(0, 0, w, hh);
  }

  function analyse() {
    // Partie gagnée : plus rien à détecter tant qu'on n'a pas relancé une partie.
    if (game.winner != null) return;
    const f = cam.frame();
    if (!f || !cal || !cv) return;
    const img = grab(f);
    if (!img) return;
    if (!detector || detSize.w !== img.width || detSize.h !== img.height) {
      dropDetector();
      detector = new DartDetector(
        cv,
        { frameToBoard: frameToBoard(cal.points, img.width, img.height), width: img.width, height: img.height, zoom: cal.zoom },
        getSettings().detector,
      );
      detSize = { w: img.width, h: img.height };
      if (turnOver() || game.winner != null) detector.setMode('removal');
    }
    const events = detector.process(img, performance.now());
    if (events.length) lastEventAt = performance.now();
    for (const ev of events) {
      if (ev.kind === 'dart') onDart(ev, img);
      else if (ev.kind === 'cleared' && game.winner == null) {
        wantStart = true;
        if (editing) clearPending = true;
        else cleared(false);
      }
      else if (ev.kind === 'moved') {
        setStatus('Le téléphone a bougé : nouvelle détection de la cible…', 'alert');
        void findBoard();
        return;
      } else if (ev.kind === 'ignored' && ev.reason === 'big' && !turnOver()) {
        setStatus('Quelque chose est devant la cible…', 'wait');
      } else if (ev.kind === 'reference' && game.winner == null) {
        setStatus(`Prêt — à ${playerName(game.current)} de lancer`, 'ready');
      }
    }
    // Image de la cible vide au début de la volée : référence pour rejouer la première
    // fléchette dans les enregistrements. Prise une seule fois, sur une image stable,
    // sinon une fléchette déjà plantée mais pas encore confirmée s'y glisserait.
    if (wantStart && !volley.darts.length && detector?.settled) {
      startShot = { img, f2b: detector.frameToBoard };
      wantStart = false;
    }
    // Trop lent pour ce téléphone : on redescend une fois, sans rien demander.
    if (analysisWidth > FALLBACK_WIDTH) {
      times.push(detector.debug.processMs);
      if (times.length >= 20) {
        const median = [...times].sort((a, b) => a - b)[times.length >> 1];
        times.length = 0;
        if (median > SLOW_MS) {
          analysisWidth = FALLBACK_WIDTH;
          dropDetector();
          setStatus('Analyse allégée : ce téléphone ne suivait pas en haute précision', 'info');
        }
      }
    }
    if (debugMode) updateDebug();
    scheduleDraw();

    frames++;
    const now = performance.now();
    if (now - lastFpsT >= 1000) {
      fps = (frames * 1000) / (now - lastFpsT);
      frames = 0;
      lastFpsT = now;
    }
  }

  /** Cadence de la prochaine analyse : pleine s'il se passe quelque chose, sinon lente. */
  function nextInterval(): number {
    if (!detector || !cal) return ACTIVE_INTERVAL_MS;
    // Mouvement en cours, ou mouvement vu mais pas encore analysé : on reste réactif.
    if (detector.debug.state === 'moving' || !detector.settled) return ACTIVE_INTERVAL_MS;
    if (performance.now() - lastEventAt < 1500) return ACTIVE_INTERVAL_MS;
    return IDLE_INTERVAL_MS;
  }

  // --- Dessin sur l'aperçu caméra -----------------------------------------
  function toScreen(f: FrameInfo, p: Pt): Pt {
    return frameToScreen(f.screen, { x: p.x / detSize.w, y: p.y / detSize.h });
  }

  /** Redessine une fois, à la prochaine image de l'écran (sans boucle permanente). */
  function scheduleDraw() {
    if (raf || disposed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }

  function draw() {
    const c = fitCanvas(overlay, cam.el.clientWidth, cam.el.clientHeight);
    const f = cam.frame();
    if (!f || !cal) return;
    const refW = 1000;
    const refH = refW / (f.crop.w / f.crop.h);
    const B2F = tryBoardToFrame(cal.points, refW, refH);
    if (B2F) drawBoardOverlay(c, boardOverlay(B2F, refW, refH), (p) => frameToScreen(f.screen, p), { alpha: debugMode ? 0.55 : 0.3, numbers: false, lineWidth: 1 });
    if (!detSize.w) return;

    if (debugMode && detector?.debug.contour) {
      const xy = detector.debug.contour;
      c.fillStyle = 'rgba(255, 0, 255, 0.6)';
      const step = Math.max(2, Math.floor(xy.length / 3000) * 2);
      for (let i = 0; i < xy.length; i += step) {
        const s = toScreen(f, { x: xy[i], y: xy[i + 1] });
        c.fillRect(s.x - 1, s.y - 1, 2, 2);
      }
      const t = detector.debug.tip;
      if (t) {
        const a = toScreen(f, t.tip);
        const b = toScreen(f, t.tail);
        c.strokeStyle = '#2af5ff';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
        dot(c, b, '#3b82f6', 5);
        dot(c, a, '#ff2020', 5);
      }
    }
    volley.darts.forEach((d) => {
      if (!d.tip) return;
      const s = toScreen(f, d.tip);
      dot(c, s, d.uncertain && !d.corrected ? '#ffb547' : '#ff2020', 5);
    });
  }

  function dot(c: CanvasRenderingContext2D, p: Pt, color: string, r: number) {
    c.beginPath();
    c.arc(p.x, p.y, r, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = '#fff';
    c.stroke();
  }

  // --- Debug ----------------------------------------------------------------
  let lastMask: unknown = null;
  const maskTmp = document.createElement('canvas');
  function updateDebug() {
    const d = detector?.debug;
    if (!d) return;
    if (d.mask && d.mask !== lastMask) {
      lastMask = d.mask;
      insets.classList.remove('hidden');
      maskTmp.width = d.mask.width;
      maskTmp.height = d.mask.height;
      const id = new ImageData(d.mask.width, d.mask.height);
      for (let i = 0; i < d.mask.data.length; i++) {
        const val = d.mask.data[i];
        id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = val;
        id.data[4 * i + 3] = 255;
      }
      maskTmp.getContext('2d')!.putImageData(id, 0, 0);
      const w = 90;
      const hh = Math.round((d.mask.height * w) / d.mask.width);
      const c = fitCanvas(maskCanvas, w, hh);
      maskCanvas.style.width = `${w}px`;
      maskCanvas.style.height = `${hh}px`;
      c.drawImage(maskTmp, 0, 0, w, hh);
    }
    const stateFr = { warmup: 'référence…', watching: 'à l’affût', moving: 'mouvement', removal: 'attente du retrait' }[d.state];
    stats.textContent =
      `${stateFr} · ${fps.toFixed(1)} img/s · ${d.processMs.toFixed(0)} ms` +
      (d.analyseMs != null ? ` (analyse ${d.analyseMs.toFixed(0)})` : '') +
      ` · mvt ${d.motion}/${d.motionLimit.toFixed(0)} · décalage ${d.shift.x.toFixed(1)},${d.shift.y.toFixed(1)}` +
      (d.area != null ? ` · aire ${d.area.toFixed(0)}` : '') +
      (d.shape ? ` · droit ${(d.shape.straight * 100).toFixed(0)} % larg ${d.shape.width.toFixed(0)} long ${d.shape.lengthRatio.toFixed(2)}` : '') +
      (d.cleanDiff != null ? ` · retrait ${d.cleanDiff}/${d.minArea.toFixed(0)}` : '') +
      ` · ${lockInfo || 'exposition auto'}`;
  }

  // --- Démarrage ------------------------------------------------------------
  void loadOpenCV().then((m) => {
    cv = m;
    const loop = () => {
      if (disposed) return;
      const start = performance.now();
      try {
        analyse();
      } catch (e) {
        setStatus(`Erreur d’analyse : ${String(e)}`, 'alert');
      }
      const spent = performance.now() - start;
      timer = window.setTimeout(loop, Math.max(10, nextInterval() - spent));
    };
    loop();
  });

  setStatus('Ouverture de la caméra…', 'wait');
  render();
  if (game.winner != null) showEnd();
  else if (volley.darts.length) {
    // Reprise avec une volée en cours : état à jour, sans répéter l'annonce vocale.
    const ev = turnEval();
    announced = `${ev.bust}:${ev.finished}:${ev.scored}`;
    afterChange();
  }
  scheduleDraw();
  // L'aperçu change aussi quand la mise en page bouge (caméra agrandie, rotation).
  const ro = new ResizeObserver(() => scheduleDraw());
  ro.observe(cam.el);

  return {
    el,
    dispose() {
      disposed = true;
      ro.disconnect();
      clearTimeout(timer);
      clearTimeout(zoomTimer);
      cancelAnimationFrame(raf);
      sheet?.close();
      dropDetector();
      cam.dispose();
    },
  };
}

function fmt1(v: number): string {
  return v.toFixed(1).replace('.', ',');
}
