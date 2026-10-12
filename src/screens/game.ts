import { calibrationStillValid, detectBoard } from '../auto-run';
import { MISS, scoreFromBoardCoords, type Score } from '../board';
import {
  boardOverlay,
  calibrationMismatch,
  frameToBoard,
  loadCalibration,
  saveCalibration,
  tryBoardToFrame,
  type Calibration,
} from '../calibration';
import { createCameraStage, type FrameInfo } from '../camera-stage';
import { DartDetector, type DartEvent } from '../detector/detector';
import { h } from '../dom';
import { frameToScreen, screenToFrame } from '../frameview';
import { applyH, type Mat3, type Pt } from '../homography';
import { showLoupe } from '../loupe';
import type { Nav, Screen } from '../main';
import { loadOpenCV, type CV } from '../opencv';
import { drawBoardOverlay, fitCanvas } from '../overlay-draw';
import { suggestCheckout } from '../game/checkout';
import { clearGame, loadGame, saveGame } from '../game/store';
import { commitTurn, evaluateTurn, newGame, playerStats, remainingScores, undoTurn, type GameState, type TurnEval } from '../game/x01';
import { getSettings } from '../settings';
import { speak } from '../speech';
import { Volley } from '../volley';

/** Largeur des images analysées : assez pour viser, assez léger pour l'iPhone. */
export const ANALYSIS_WIDTH = 640;
const ANALYSIS_INTERVAL_MS = 100; // ≈10 analyses par seconde
const RECT_SIZE = 240; // vue de face (debug)

// Écran de partie : trouve la cible automatiquement, détecte chaque fléchette,
// applique les règles X01 (bust, double out, victoire), gère le retrait des
// fléchettes, les corrections au doigt, l'annonce vocale et la sauvegarde.
export function gameScreen(nav: Nav): Screen {
  const saved = loadGame();
  if (!saved) {
    // Pas de partie : on la prépare d'abord.
    queueMicrotask(() => nav('setup'));
    return document.createElement('main');
  }
  let game: GameState = saved.state;
  const cam = createCameraStage(nav);
  const debugMode = getSettings().debug;
  let disposed = false;
  let timer = 0;
  let raf = 0;
  let cv: CV | null = null;
  /** Calibration utilisée pour cette session, ou null tant que la cible n'est pas trouvée. */
  let cal: Calibration | null = null;
  let detector: DartDetector | null = null;
  let detSize = { w: 0, h: 0 };
  let run = 0; // identifiant de la recherche de cible en cours
  let volley = new Volley();
  volley.darts = saved.pending ?? [];
  /** Dernière annonce faite pour la volée en cours (évite de répéter). */
  let announced = '';
  /** Fléchette sélectionnée pour une correction (par défaut la dernière). */
  let selected = -1;
  /** Visée au doigt en cours (coordonnées écran). */
  let aim: Pt | null = null;
  let lockInfo = '';
  let fps = 0;
  let frames = 0;
  let lastFpsT = performance.now();

  // --- Éléments ---------------------------------------------------------
  const overlay = h('canvas', { class: 'overlay interactive' });
  const loupe = h('canvas', { class: 'loupe hidden' });
  const note = h('div', { class: 'note' });
  const lastScore = h('div', { class: 'last-score' }, '–');
  const chips = h('div', { class: 'volley' });
  const scorePanel = h('div', { class: 'score-panel' }, lastScore, h('div', { class: 'volley-col' }, chips));
  const board = h('div', { class: 'scoreboard' });
  const checkout = h('div', { class: 'checkout hidden' });
  const endPanel = h('div', { class: 'end hidden' });
  const stats = h('div', { class: 'stats' });
  const maskCanvas = h('canvas', { class: 'inset' });
  const rectCanvas = h('canvas', { class: 'inset' });
  const insets = h(
    'div',
    { class: 'insets hidden' },
    h('figure', {}, maskCanvas, h('figcaption', {}, 'Masque')),
    h('figure', {}, rectCanvas, h('figcaption', {}, 'Vue de face')),
  );
  const sheet = h('div', { class: 'sheet hidden' });
  const missBtn = h('button', { class: 'big', onclick: () => miss() }, 'Raté / 0');
  const undoBtn = h('button', { class: 'big', onclick: () => undo() }, 'Annuler');
  const clearBtn = h('button', { class: 'big primary', onclick: () => cleared(true) }, 'Fléchettes retirées');
  const boardBtn = h('button', { class: 'pill', onclick: () => gameMenu() }, '☰ Menu');

  cam.el.insertBefore(overlay, cam.el.children[1]);
  // Haut de l'écran : scores, finish proposé et message, empilés.
  cam.el.append(h('div', { class: 'hud' }, board, checkout, note), loupe, sheet, endPanel);
  if (debugMode) cam.el.append(insets);
  cam.el.querySelector('.topbar')!.insertBefore(boardBtn, cam.el.querySelector('.topbar')!.lastChild);
  // Zoom en pinçant à deux doigts : la cible est ensuite redétectée automatiquement.
  cam.enablePinch(overlay);
  cam.dock.append(scorePanel, h('div', { class: 'calib-actions small' }, missBtn, undoBtn, clearBtn));
  if (debugMode) cam.dock.append(stats);

  function setNote(text: string, warn = false) {
    note.textContent = text;
    note.classList.toggle('warn', warn);
  }

  // --- Cible : détection automatique à l'ouverture de la caméra ------------
  async function findBoard() {
    const id = ++run;
    const kind = cam.source?.kind;
    if (!kind) return;
    cal = null;
    dropDetector();
    setNote('🔎 Recherche de la cible…');
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
      setNote(`✅ Cible détectée (≈ ${res.errorMm.toFixed(1).replace('.', ',')} mm). Ne touche plus le téléphone et attends « Prêt »…`);
      return;
    }
    // Échec : la calibration précédente est-elle toujours bonne (trépied pas bougé) ?
    const saved = loadCalibration(kind);
    if (saved && f && !calibrationMismatch(saved, { zoom: cam.zoomValue(), aspect: f.crop.w / f.crop.h })) {
      if (await calibrationStillValid(cam, saved)) {
        if (disposed || id !== run) return;
        useCalibration(saved);
        setNote('✅ Calibration précédente toujours alignée. Attends « Prêt »…');
        return;
      }
    }
    setNote(
      `⚠️ Cible non trouvée automatiquement : ${res.ok ? '' : res.reason} Vérifie qu’elle est entière et bien éclairée, puis 🎯 › « Redétecter », ou « Ajuster à la main ».`,
      true,
    );
  }

  function useCalibration(c: Calibration) {
    cal = c;
    dropDetector();
    // Exposition / balance des blancs bloquées si possible (luminosité stable).
    void cam.source?.lock().then((info) => (lockInfo = info));
  }

  function dropDetector() {
    detector?.dispose();
    detector = null;
  }

  let zoomTimer = 0;
  cam.onChange((reason) => {
    if (reason === 'pinch') {
      aim = null;
      loupe.classList.add('hidden');
      return;
    }
    if (reason === 'zoom') {
      // L'image a changé : ancienne calibration inutilisable, nouvelle détection après le geste.
      cal = null;
      dropDetector();
      run++;
      setNote('🔍 Zoom… la cible sera redétectée.');
      clearTimeout(zoomTimer);
      zoomTimer = window.setTimeout(() => void findBoard(), 800);
      return;
    }
    if (reason === 'source') {
      cal = null;
      dropDetector();
      run++;
      render();
      const start = () => (cam.frame() ? void findBoard() : cam.source && setTimeout(start, 100));
      start();
    }
  });

  // --- Volée et règles du jeu ---------------------------------------------
  const persist = () => saveGame({ state: game, pending: volley.darts });
  const remaining = () => remainingScores(game);
  const playerName = (i: number) => game.config.players[i];

  /** Évaluation de la volée en cours selon les règles (bust, victoire…). */
  function turnEval(): TurnEval {
    return evaluateTurn(remaining()[game.current], volley.darts.map((d) => d.score), game.config.doubleOut);
  }
  /** La volée est terminée : 3 fléchettes, bust ou victoire. */
  const turnOver = () => volley.full || turnEval().over;

  function afterChange(announce?: Score) {
    selected = volley.darts.length - 1;
    if (announce) {
      lastScore.textContent = announce.libelle;
      lastScore.classList.remove('pop');
      void lastScore.offsetWidth; // relance l'animation
      lastScore.classList.add('pop');
    }
    const ev = turnEval();
    if (turnOver()) {
      detector?.setMode('removal');
      const name = playerName(game.current);
      const msg = ev.finished
        ? `🏆 ${name} finit ! Retire tes fléchettes pour valider la victoire.`
        : ev.bust
          ? `💥 Bust ! ${name} reste à ${ev.remaining}. Va retirer tes fléchettes.`
          : `Volée : ${ev.scored} points. Va retirer tes fléchettes.`;
      setNote(msg);
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
  }

  function onDart(ev: DartEvent, img: ImageData) {
    if (turnOver() || !volley.addDetected(ev.score, ev.tip, ev.board)) return;
    if (!turnOver()) setNote(`🎯 ${ev.score.libelle} (${ev.score.points} pts) — touche l’image pour corriger.`);
    afterChange(ev.score);
    if (debugMode) drawRectified(img);
  }

  function miss() {
    if (turnOver()) {
      // Volée terminée : « Raté » remplace la fléchette sélectionnée.
      volley.correct(selected, MISS, null, null);
      setNote('Fléchette corrigée : 0.');
      afterChange(MISS);
      return;
    }
    volley.addMiss();
    detector?.noteManualDart();
    setNote('Fléchette ratée ajoutée : 0.');
    afterChange(MISS);
  }

  function undo() {
    const d = volley.undo();
    if (!d) return;
    setNote(`Fléchette « ${d.score.libelle} » annulée.`);
    afterChange();
    lastScore.textContent = volley.last?.score.libelle ?? '–';
  }

  /** Fléchettes retirées (automatiquement ou au bouton) : la volée est enregistrée. */
  function cleared(manual: boolean) {
    if (volley.darts.length && game.winner == null) {
      const before = game;
      game = commitTurn(game, volley.darts.map((d) => d.score));
      const last = game.turns[game.turns.length - 1];
      if (game.winner != null) {
        volley = new Volley();
        persist();
        showEnd();
        return;
      }
      const next = game.current;
      const rem = remaining()[next];
      setNote(
        `${last.bust ? '💥 Bust enregistré.' : `✅ ${playerName(before.current)} : ${last.before - last.after} points.`} ` +
          `À ${playerName(next)} (${rem})${manual ? ', attends « Prêt »…' : ' !'}`,
      );
      speak(game.config.players.length > 1 ? `À ${playerName(next)}, il reste ${rem}.` : `Il reste ${rem}.`);
    } else if (manual) setNote('Nouvelle image de référence… attends « Prêt ».');
    volley = new Volley();
    announced = '';
    if (manual) detector?.resetReference();
    else detector?.setMode('throwing');
    lastScore.textContent = '–';
    afterChange();
  }

  function render() {
    const ev = turnEval();
    // Tableau des scores : restant de chaque joueur, joueur actif en évidence.
    const rem = remaining();
    const stats = playerStats(game);
    board.className = `scoreboard n${game.config.players.length}`;
    board.replaceChildren(
      ...game.config.players.map((name, i) => {
        const active = i === game.current && game.winner == null;
        const shown = active && !ev.bust ? ev.remaining : rem[i];
        return h(
          'div',
          { class: 'player' + (active ? ' active' : '') },
          h('div', { class: 'pname' }, name),
          h('div', { class: 'premain' }, String(shown)),
          h('div', { class: 'pavg' }, stats[i].darts ? `moy. ${stats[i].average.toFixed(1).replace('.', ',')}` : ''),
        );
      }),
    );
    // Finish proposé (score restant ≤ 170, fléchettes restantes de la volée).
    const left = 3 - volley.darts.length;
    const r = ev.remaining;
    if (game.winner == null && !ev.over && r <= 170) {
      const route = suggestCheckout(r, left, game.config.doubleOut);
      checkout.textContent = route ? `Finish : ${route.map((d) => d.libelle).join('  ')}` : `Pas de finish en ${left} fléchette${left > 1 ? 's' : ''}`;
      checkout.classList.remove('hidden');
    } else checkout.classList.add('hidden');

    chips.replaceChildren(
      ...[0, 1, 2].map((i) => {
        const d = volley.darts[i];
        const counted = i < ev.used || !ev.over;
        const cls =
          'chip' +
          (d ? '' : ' empty') +
          (d && i === selected ? ' selected' : '') +
          (d?.corrected || d?.origin === 'manual' ? ' fixed' : '') +
          (d && !counted ? ' void' : '');
        return h('button', { class: cls, onclick: () => select(i) }, d?.score.libelle ?? '·');
      }),
      h('span', { class: 'total' + (ev.bust ? ' bust' : '') }, ev.bust ? 'BUST' : `= ${ev.scored}`),
    );
    undoBtn.disabled = volley.darts.length === 0;
  }

  function select(i: number) {
    if (!volley.darts[i]) return;
    selected = i;
    render();
    setNote(`Fléchette ${i + 1} sélectionnée (${volley.darts[i].score.libelle}) : touche l’image à l’endroit de sa pointe.`);
  }

  // --- Fin de partie --------------------------------------------------------
  function showEnd() {
    const w = game.winner!;
    const stats = playerStats(game);
    speak(`Victoire de ${playerName(w)} ! Moyenne ${stats[w].average.toFixed(0)}.`);
    detector?.setMode('removal');
    endPanel.replaceChildren(
      h('h2', {}, `🏆 ${playerName(w)} gagne !`),
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Joueur'), h('th', {}, 'Moy. / volée'), h('th', {}, 'Fléchettes'), h('th', {}, 'Meilleure'))),
        h(
          'tbody',
          {},
          ...stats.map((p, i) =>
            h(
              'tr',
              { class: i === w ? 'winner' : '' },
              h('td', {}, p.name),
              h('td', {}, p.average.toFixed(1).replace('.', ',')),
              h('td', {}, String(p.darts)),
              h('td', {}, String(p.best)),
            ),
          ),
        ),
      ),
      h('button', { class: 'big primary', onclick: () => rematch() }, 'Revanche'),
      h('button', { class: 'big', onclick: () => (clearGame(), nav('setup')) }, 'Nouvelle partie'),
      h('button', { class: 'big', onclick: () => (clearGame(), nav('home')) }, 'Accueil'),
    );
    endPanel.classList.remove('hidden');
    render();
  }

  function rematch() {
    game = newGame(game.config);
    volley = new Volley();
    announced = '';
    lastScore.textContent = '–';
    persist();
    endPanel.classList.add('hidden');
    speak(`Revanche ! À ${playerName(0)}.`);
    setNote(`Revanche ! À ${playerName(0)}.`);
    detector?.resetReference();
    afterChange();
  }

  // --- Corrections au doigt : viser avec la loupe, puis choisir --------------
  const local = (e: PointerEvent): Pt => {
    const r = cam.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  overlay.addEventListener('pointerdown', (e) => {
    if (!detector || !cam.frame() || cam.pinching) return;
    hideSheet();
    aim = local(e);
    try {
      overlay.setPointerCapture(e.pointerId);
    } catch {
      /* pas grave */
    }
    e.preventDefault();
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!aim || cam.pinching) return;
    aim = local(e);
    e.preventDefault();
  });
  const endAim = () => {
    if (!aim) return;
    const p = aim;
    aim = null;
    loupe.classList.add('hidden');
    pickAt(p);
  };
  overlay.addEventListener('pointerup', endAim);
  overlay.addEventListener('pointercancel', () => {
    aim = null;
    loupe.classList.add('hidden');
  });

  /** Score à un point de l'écran : écran → cadre → image analysée → cible. */
  function scoreAt(screen: Pt): { score: Score; tip: Pt; board: Pt } | null {
    const f = cam.frame();
    if (!f || !detector) return null;
    const n = screenToFrame(f.screen, screen);
    const tip = { x: n.x * detSize.w, y: n.y * detSize.h };
    const board = applyH(detector.frameToBoard, tip);
    return { score: scoreFromBoardCoords(board.x, board.y), tip, board };
  }

  function pickAt(screen: Pt) {
    const r = scoreAt(screen);
    if (!r) return;
    const sel = volley.darts[selected];
    const buttons: HTMLElement[] = [];
    if (sel) {
      buttons.push(
        h('button', {
          class: 'big primary',
          onclick: () => {
            volley.correct(selected, r.score, r.tip, r.board);
            hideSheet();
            setNote(`Fléchette ${selected + 1} corrigée : ${r.score.libelle}.`);
            afterChange(r.score);
          },
        }, `Corriger « ${sel.score.libelle} » → ${r.score.libelle}`),
      );
    }
    if (!turnOver()) {
      buttons.push(
        h('button', {
          class: sel ? 'big' : 'big primary',
          onclick: () => {
            volley.addManual(r.score, r.tip, r.board);
            detector?.noteManualDart();
            hideSheet();
            setNote(`Fléchette oubliée ajoutée : ${r.score.libelle}.`);
            afterChange(r.score);
          },
        }, `Ajouter une fléchette : ${r.score.libelle}`),
      );
    }
    buttons.push(h('button', { class: 'big', onclick: () => hideSheet() }, 'Fermer'));
    showSheet(`Pointe touchée : ${r.score.libelle} (${r.score.points} pts)`, buttons);
  }

  function showSheet(title: string, buttons: HTMLElement[]) {
    sheet.replaceChildren(h('p', {}, title), ...buttons);
    sheet.classList.remove('hidden');
  }
  function hideSheet() {
    sheet.classList.add('hidden');
  }

  function gameMenu() {
    showSheet('Menu', [
      h('button', { class: 'big', onclick: () => (hideSheet(), void findBoard()) }, 'Redétecter la cible'),
      h('button', { class: 'big', onclick: () => nav('calibrate') }, 'Ajuster la cible à la main'),
      h(
        'button',
        {
          class: 'big',
          onclick: () => {
            hideSheet();
            if (!game.turns.length) return;
            game = undoTurn(game);
            volley = new Volley();
            setNote(`Volée précédente annulée. À ${playerName(game.current)} de rejouer sa volée.`);
            afterChange();
          },
        },
        'Annuler la volée précédente',
      ),
      h('button', { class: 'big', onclick: () => (clearGame(), nav('home')) }, 'Abandonner la partie'),
      h('button', { class: 'big', onclick: () => hideSheet() }, 'Fermer'),
    ]);
  }

  // --- Analyse des images -------------------------------------------------
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  function grab(f: FrameInfo): ImageData | null {
    const v = cam.source?.video;
    if (!v) return null;
    const w = ANALYSIS_WIDTH;
    const hh = Math.round((f.crop.h * w) / f.crop.w);
    if (canvas.width !== w || canvas.height !== hh) {
      canvas.width = w;
      canvas.height = hh;
    }
    ctx.drawImage(v, f.crop.x, f.crop.y, f.crop.w, f.crop.h, 0, 0, w, hh);
    return ctx.getImageData(0, 0, w, hh);
  }

  function analyse() {
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
    for (const ev of events) {
      if (ev.kind === 'dart') onDart(ev, img);
      else if (ev.kind === 'cleared' && game.winner == null) cleared(false);
      else if (ev.kind === 'moved') {
        setNote('Le trépied a bougé : nouvelle détection de la cible…', true);
        void findBoard();
        return;
      } else if (ev.kind === 'ignored' && ev.reason === 'big' && !turnOver()) {
        setNote('Quelque chose est devant la cible… J’attends que la vue se libère.');
      } else if (ev.kind === 'reference' && game.winner == null) {
        setNote(`🟢 Prêt ! À ${playerName(game.current)} de lancer.`);
      }
    }
    if (debugMode) updateDebug();

    frames++;
    const now = performance.now();
    if (now - lastFpsT >= 1000) {
      fps = (frames * 1000) / (now - lastFpsT);
      frames = 0;
      lastFpsT = now;
    }
  }

  // --- Dessin -------------------------------------------------------------
  function toScreen(f: FrameInfo, p: Pt): Pt {
    return frameToScreen(f.screen, { x: p.x / detSize.w, y: p.y / detSize.h });
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    const c = fitCanvas(overlay, cam.el.clientWidth, cam.el.clientHeight);
    const f = cam.frame();
    if (!f || !cal) return;
    const refW = 1000;
    const refH = refW / (f.crop.w / f.crop.h);
    const B2F = tryBoardToFrame(cal.points, refW, refH);
    const ov = B2F ? boardOverlay(B2F, refW, refH) : null;
    if (ov) drawBoardOverlay(c, ov, (p) => frameToScreen(f.screen, p), { alpha: debugMode ? 0.6 : 0.35, numbers: false });
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
        dot(c, b, '#3b82f6', 6);
        dot(c, a, '#ff2020', 6);
      }
    }
    // Impacts de la volée en cours.
    volley.darts.forEach((d, i) => {
      if (!d.tip) return;
      const s = toScreen(f, d.tip);
      dot(c, s, i === selected ? '#ff2020' : '#ffae00', i === selected ? 8 : 6);
      c.font = 'bold 16px -apple-system, sans-serif';
      c.fillStyle = '#fff';
      c.strokeStyle = 'rgba(0,0,0,0.8)';
      c.lineWidth = 3;
      c.strokeText(d.score.libelle, s.x + 10, s.y - 10);
      c.fillText(d.score.libelle, s.x + 10, s.y - 10);
    });

    // Visée au doigt : loupe + score sous le viseur.
    const v = cam.source?.video;
    if (aim && v) {
      const n = screenToFrame(f.screen, aim);
      showLoupe(loupe, v, f, n, aim, cam.el.clientWidth, (lc, toLoupe) => {
        if (ov) drawBoardOverlay(lc, ov, (q) => toLoupe(frameToScreen(f.screen, q)), { alpha: 0.7, lineWidth: 1, numbers: false });
        const r = scoreAt(aim!);
        if (r) {
          lc.font = 'bold 22px -apple-system, sans-serif';
          lc.textAlign = 'center';
          lc.lineWidth = 4;
          lc.strokeStyle = 'rgba(0,0,0,0.85)';
          lc.fillStyle = '#ffe14d';
          lc.strokeText(r.score.libelle, 75, 140);
          lc.fillText(r.score.libelle, 75, 140);
        }
      });
    }
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
        id.data[4 * i] = val;
        id.data[4 * i + 1] = val;
        id.data[4 * i + 2] = val;
        id.data[4 * i + 3] = 255;
      }
      maskTmp.getContext('2d')!.putImageData(id, 0, 0);
      const w = 120;
      const hh = Math.round((d.mask.height * w) / d.mask.width);
      const c = fitCanvas(maskCanvas, w, hh);
      maskCanvas.style.width = `${w}px`;
      maskCanvas.style.height = `${hh}px`;
      c.drawImage(maskTmp, 0, 0, w, hh);
    }
    const stateFr = { warmup: 'référence…', watching: 'à l’affût', moving: 'mouvement', removal: 'attente du retrait' }[d.state];
    stats.textContent =
      `${stateFr} · ${fps.toFixed(1)} img/s · ${d.processMs.toFixed(0)} ms` +
      (d.analyseMs != null ? ` (analyse ${d.analyseMs.toFixed(0)} ms)` : '') +
      ` · mvt ${d.motion}/${d.motionLimit.toFixed(0)} · décalage ${d.shift.x.toFixed(1)},${d.shift.y.toFixed(1)} px` +
      (d.area != null ? ` · aire ${d.area.toFixed(0)} (min ${d.minArea.toFixed(0)}, max ${d.maxArea.toFixed(0)})` : '') +
      (d.cleanDiff != null ? ` · retrait ${d.cleanDiff}/${d.minArea.toFixed(0)}` : '') +
      (d.tip ? ` · confiance ${(d.tip.confidence * 100).toFixed(0)} %` : '') +
      ` · focale ${detector?.cam ? `${detector.cam.focal.toFixed(0)}${detector.cam.focalEstimated ? '' : ' (défaut)'}` : '?'}` +
      ` · ${lockInfo || 'exposition auto'}`;
  }

  /** Vue « de face » : l'image redressée par l'homographie, avec les impacts. */
  function drawRectified(img: ImageData) {
    if (!cv || !cal) return;
    const F2B: Mat3 = detector?.frameToBoard ?? frameToBoard(cal.points, img.width, img.height);
    const k = RECT_SIZE / 2 / 225;
    const c = RECT_SIZE / 2;
    // cadre (px) → cible (mm) → vue de face (px), y vers le bas.
    const S = [k, 0, c, 0, -k, c, 0, 0, 1];
    const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let l = 0; l < 3; l++) M[i * 3 + j] += S[i * 3 + l] * F2B[l * 3 + j];
    const src = cv.matFromImageData(img);
    const dst = new cv.Mat();
    const Mm = cv.matFromArray(3, 3, cv.CV_64F, M);
    try {
      cv.warpPerspective(src, dst, Mm, new cv.Size(RECT_SIZE, RECT_SIZE));
      rectCanvas.width = RECT_SIZE;
      rectCanvas.height = RECT_SIZE;
      cv.imshow(rectCanvas, dst);
    } finally {
      src.delete();
      dst.delete();
      Mm.delete();
    }
    const g = rectCanvas.getContext('2d')!;
    volley.darts.forEach((d) => {
      if (!d.board) return;
      g.beginPath();
      g.arc(c + k * d.board.x, c - k * d.board.y, 4, 0, Math.PI * 2);
      g.fillStyle = '#ff2020';
      g.fill();
      g.strokeStyle = '#fff';
      g.stroke();
    });
    rectCanvas.style.width = '120px';
    rectCanvas.style.height = '120px';
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
        setNote(`Erreur d’analyse : ${String(e)}`, true);
      }
      // Cadence visée : une analyse toutes les 100 ms, temps de calcul compris.
      const spent = performance.now() - start;
      timer = window.setTimeout(loop, Math.max(10, ANALYSIS_INTERVAL_MS - spent));
    };
    loop();
  });

  render();
  if (game.winner != null) showEnd();
  else if (volley.darts.length) {
    // Reprise avec une volée en cours : message et mode de détection à jour, sans
    // répéter l'annonce vocale déjà faite.
    const ev = turnEval();
    announced = `${ev.bust}:${ev.finished}:${ev.scored}`;
    afterChange();
  }
  draw();

  return {
    el: cam.el,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(zoomTimer);
      cancelAnimationFrame(raf);
      dropDetector();
      cam.dispose();
    },
  };
}
