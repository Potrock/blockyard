import { defineClient, type Client, type ClientKit } from '@platform/client';
import { centre, period, type CityInfo, type DealCheck, type FightWire, type LobbyView, type MapWire, type OrderResult, type ReshapeWire, type PreviewReply, type ResearchAdvice, type StatsInfo, type View, type WorkAdvice, type FameEntry, type DealHelp } from './client/wire';
import { setAdvice } from './client/advice';
import { cam, frameCamera } from './client/camera';
import { drawFog, mountFog } from './client/fog';
import { frameHandover, handoverView, holdFights, mountHandover } from './client/handover';
import { bindInput, previewAsk } from './client/input';
import { drawOverlay, mountOverlay } from './client/overlay';
import { defineModelLooks, drawModels, forgetGround, resetModels } from './client/models3d';
import { drawResources } from './client/resources3d';
import { drawTraffic } from './client/traffic';
import { drawLife, resetLife } from './client/life';
import { drawNatureFx } from './client/naturefx';
import { me, reshapeMap, resetGame, setMap, setView, setYields, store } from './client/store';
import { bindPrefs, loadPrefs, prefs, type Prefs } from './client/prefs';
import { mountUI, renderUI, selectNextIdle } from './client/ui';
import { moments } from './client/moments';
import { marchTurn } from './client/march';
import { defineMusic, playMusic } from './client/music';
import { defineSounds, frameSounds, play } from './client/sound';
import { frameWorld, worldMoments } from './client/worldfx';
import { disasterMoments, drawWeather } from './client/weatherfx';
import { frameMoments } from './client/splash';
import { shared } from './shared';
import { askWorkAdvice, followWorkPlans, resetWorkPlans, setWorkAdvice } from './client/workadvice';
import { setFame } from './client/fame';
import { takeHelp } from './client/diplomacy';
import { turnAlerts } from './client/yourturn';

/**
 * Blockilization on each player's screen: no walking body and none of the shooter's kits; the camera
 * looks down on the voxel world (`client/camera.ts`), the units and towns are voxel models placed
 * from this player's view (`client/models3d.ts`), a thin cloud floats over what they haven't
 * explored and a veil darkens what's out of sight (`client/fog.ts`), the overlay draws the borders,
 * units and cities over it (`client/overlay.ts`), and the interface is this screen's own DOM
 * (`client/ui.ts`), worked by the mouse and keys (`client/input.ts`), with its sounds
 * (`client/sound.ts`), its music (`client/music.ts`), its big moments (`client/moments.ts`) and the
 * world's (`client/worldfx.ts`). The server says what's what (`protocol.ts`).
 */

/** Fights to show: each blow's damage over its tile and the attacker's lunge (its sound comes with the blow); where the attacker struck from (before it moves in on a kill). */
function showFights(fights: FightWire[], now: number) {
  const v = store.view;
  for (const c of fights) {
    const from = c.attacker >= 0 ? v?.units.find((u) => u.id === c.attacker)?.tile : v?.cities.find((x) => x.id === -c.attacker)?.tile;
    store.fights.push({ at: c.at, dealt: c.dealt, taken: c.taken, t: now, attacker: c.attacker, killed: c.killed, died: c.died, from });
  }
}

/** The platform's world drawn repeated across (`client.world.wrap`, newer platforms only). */
type WrapWorld = { wrap?(wrap: { x: number; period: number } | null): void };

function board(): ClientKit {
  let first = true;
  /** The period the world's drawn repeated with (0: not at all). */
  let wrapped = 0;
  /** Where the server was last told this screen looks (it loads the world round there), and when. */
  let told = { x: NaN, z: NaN, at: 0 };
  /** The interface's layer (put away with H). */
  let ui: HTMLElement | null = null;
  return {
    name: 'blockilization.board',
    setup(client: Client) {
      bindPrefs(client);
      defineModelLooks(client);
      defineSounds(client);
      defineMusic(client);
      // The map's layer: the veil (`client/fog.ts`) under the overlay.
      const map = client.hud.layer('civ-map', 'lens');
      mountFog(map);
      mountOverlay(map);
      ui = client.hud.layer('civ-ui', 'panels');
      mountUI(client, ui);
      mountHandover(client, ui);
      bindInput();
      client.on('lobby', (d) => {
        store.lobby = d as LobbyView;
        // Back to the lobby (a new game) or building one: the last game's drawing goes.
        if (store.lobby.phase === 'lobby' || store.lobby.phase === 'building') {
          if (store.view) {
            resetModels(client);
            resetLife(client);
          }
          store.view = null;
          resetGame();
          resetWorkPlans();
          // (The Civilopedia stays open: it can be read in the lobby.)
          if (store.panel !== 'pedia') store.panel = null;
        }
        store.changed++;
      });
      client.on('prefs', (d) => loadPrefs(d as Prefs));
      client.on('map', (d) => {
        setMap(d as MapWire);
        // (A new map: the last game's view is no guide to what's new in this one.)
        store.view = null;
        resetGame();
        resetWorkPlans();
        told = { x: NaN, z: NaN, at: 0 };
        resetModels(client);
        resetLife(client);
        first = true;
      });
      const onView = (d: unknown) => {
        const prev = store.view;
        setView(d as View, client.time);
        moments(prev, store.view!);
        handoverView(store.view!);
        // A new turn: groups on the march go on together.
        if (prev && prev.turn !== store.view!.turn) marchTurn();
        // Workers sent to recommended work start it once they're there.
        followWorkPlans();
        // The turn waiting on this player after a wait: a bell.
        turnAlerts(prev, store.view!, client.time);
        worldMoments(client, prev, store.view!);
        disasterMoments(client, prev, store.view!);
        // The city on screen changed (a new turn, it grew, its citizens moved, it finished something): its screen again.
        const open = store.selectedCity;
        if (open !== null) {
          const was = prev?.cities.find((c) => c.id === open);
          const now = store.view!.cities.find((c) => c.id === open);
          if (now && (prev?.turn !== store.view!.turn || JSON.stringify(was) !== JSON.stringify(now) || prev?.self.gold !== store.view!.self.gold)) client.send('city', { id: open });
        }
        // First look: at your own start.
        if (first && store.grid && store.view) {
          const mine = store.view.units.find((u) => u.owner === me()) ?? store.view.cities.find((c) => c.owner === me());
          if (mine) {
            const c = centre(store.grid, mine.tile);
            cam.x = c.x;
            cam.z = c.z;
            first = false;
          }
        }
      };
      // A big view comes in parts (`server.ts`, `sendLarge`): put back together, it's a view like any other.
      let parts: string[] = [];
      client.on('viewPart', (d) => {
        const { i, n, text } = d as { i: number; n: number; text: string };
        if (i === 0) parts = [];
        parts[i] = text;
        if (i === n - 1 && parts.length === n) onView(JSON.parse(parts.join('')));
      });
      client.on('view', (d) => onView(d));
      client.on('result', (d) => {
        const r = d as OrderResult;
        // (A deal's answer is news either way: accepted, offered, or why not.)
        if (r.error && (!r.ok || store.diplo.pending)) store.toast = { text: r.error, until: client.time + 3, good: r.ok };
        if (store.diplo.pending) {
          store.diplo.pending = false;
          if (r.ok && r.error === 'Accepted') play('deal');
          if (r.ok) (store.diplo.deal = null), (store.diplo.check = null);
        }
        // A move ordered by a click: taken (a footfall, its destination marked), or not.
        const ordered = store.ordered;
        if (ordered && !ordered.taken) {
          if (r.ok) {
            ordered.taken = true;
            ordered.at = client.time;
            play('march', 0.8);
          } else store.ordered = null;
        }
        showFights(r.combat ?? [], client.time);
        store.changed++;
      });
      // Fights others ordered, where this screen can see them (a unit of yours attacked, a battle in sight):
      // the bots' kept for their turn on the screen, once their moves are here (`client/handover.ts`).
      client.on('fights', (d) => {
        if (!holdFights(d as FightWire[])) showFights(d as FightWire[], client.time);
      });
      client.on('city', (d) => {
        store.cityInfo = d as CityInfo;
        store.changed++;
      });
      client.on('advice', (d) => setAdvice(d as ResearchAdvice));
      client.on('workAdvice', (d) => setWorkAdvice(d as WorkAdvice));
      client.on('fame', (d) => setFame(d as FameEntry[]));
      client.on('dealHelp', (d) => takeHelp(d as DealHelp & { key: string }));
      client.on('stats', (d) => {
        store.stats = d as StatsInfo;
        store.changed++;
      });
      client.on('yields', (d) => setYields(d as string));
      // The land the world has changed (the sea risen over it, rich soil): as it now is.
      client.on('reshape', (d) => {
        reshapeMap(d as ReshapeWire);
        forgetGround();
      });
      client.on('dealCheck', (d) => {
        store.diplo.check = d as DealCheck;
        store.changed++;
      });
      client.on('preview', (d) => {
        const r = d as PreviewReply;
        if (!store.preview || JSON.stringify(r.ask) !== JSON.stringify(store.preview.ask)) return;
        store.preview.data = r.preview;
        store.preview.answered = true;
        store.changed++;
      });
    },
    frame(client: Client, dt: number) {
      // The board frees the mouse; but if it came up while Play was still locking it, the lock wins.
      // With the board up, a locked mouse is let go (the game's played with it free).
      if (document.pointerLockElement && document.querySelector('.widget-screen')) document.exitPointerLock();
      // A world that wraps is drawn repeated east and west while it's on show (not while it's built,
      // the camera looking away); on an older platform its seam shows the empty sea.
      const phase = store.lobby?.phase;
      const repeat = store.grid?.wrap && (phase === 'playing' || phase === 'over') ? period(store.grid) : 0;
      if (repeat !== wrapped) {
        wrapped = repeat;
        (client.world as WrapWorld).wrap?.(repeat ? { x: 0, period: repeat } : null);
      }
      frameCamera(client, dt);
      nextAfterMove(client.time);
      drawModels(client, dt);
      drawTraffic(client);
      drawLife(client);
      drawResources(client, dt);
      drawNatureFx(client, dt);
      drawWeather(client, dt);
      drawFog(client.time);
      // Where we're looking, now and then: the world loads round there (a big map's far side too).
      if (store.grid && client.time - told.at > 0.5 && !(Math.hypot(cam.x - told.x, cam.z - told.z) < 8)) {
        told = { x: cam.x, z: cam.z, at: client.time };
        client.send('look', { x: Math.round(cam.x), z: Math.round(cam.z) });
      }
      // The attack under the mouse: its preview asked for (again when the view changes; the last answer shown meanwhile).
      const ask = previewAsk();
      const key = ask ? `${JSON.stringify(ask)}|${store.viewSeq}` : '';
      if (key !== (store.preview?.key ?? '')) {
        const same = !!ask && !!store.preview && JSON.stringify(ask) === JSON.stringify(store.preview.ask);
        store.preview = ask ? { ask, key, data: same ? store.preview!.data : null, answered: same && store.preview!.answered } : null;
        if (ask) client.send('preview', ask);
        store.changed++;
      }
      // The selected worker's recommended work: asked for again as the view changes.
      askWorkAdvice((unit) => client.send('workAdvice', { unit }));
      drawOverlay(client.time);
      playMusic(client);
      frameSounds(client.time);
      frameWorld(client);
      frameHandover(client.time, showFights);
      frameMoments(client);
      if (ui) ui.style.display = store.interfaceHidden ? 'none' : '';
      renderUI(client.time);
    },
  };
}

/**
 * A moment after a move is taken that leaves the unit with nothing more to do this turn (its moves
 * spent, or on its way for turns), the next unit waiting for orders is selected, Civ V's way (a
 * preference): unless the player has chosen something else meanwhile.
 */
function nextAfterMove(now: number) {
  const o = store.ordered;
  if (!o?.taken || now - o.at < 1 || o.advanced) {
    // (Its marker's pulse over, the order's forgotten.)
    if (o?.taken && now - o.at > 1.6) store.ordered = null;
    return;
  }
  o.advanced = true;
  const u = store.view?.units.find((x) => x.id === o.unit && x.owner === me());
  if (!prefs.autoNext || store.selectedUnit !== o.unit || store.panel || !u || ((u.moves ?? 0) > 0 && !u.path?.length)) return;
  selectNextIdle();
}

export default defineClient(shared, {
  kits: [board()],
});
