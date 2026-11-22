// SyossetStalk — tuning constants + pure helpers. Shared by sim and client.

export const TILE = 32;

// --- movement ---------------------------------------------------------------
export const PLAYER_R = 11;
export const WALK = 138;            // world units / second
export const SNEAK_MULT = 0.52;
export const SPRINT_MULT = 1.62;
export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 26;
export const STAMINA_REGEN = 17;
export const BOOST_MULT = 1.3;
export const INPUT_TTL = 1400;      // a held direction goes stale (sleeping tab) after this
export const STAIR_CD = 1400;

export const MAX_HP = 100;

// --- match ------------------------------------------------------------------
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const COUNTDOWN_MS = 4500;
export const MATCH_MS = 5 * 60 * 1000;
export const LOBBY_SWEEP_MS = 26 * 1000;

// --- pings ------------------------------------------------------------------
export const PING_START_MS = 12000;
export const PING_END_MS = 6300;
export const PING_RADIUS = { still: 46, sneak: 58, walk: 92, sprint: 158 };
export const PING_LIFE_MS = 6000;   // how long a blip stays on the radar
export const DORMANT_MS = 20000;    // no heartbeat => your signal is exact (no hiding by idling)

// --- catch / interrogation --------------------------------------------------
export const CATCH_RANGE = 46;
export const INTERROG_STEP_MS = 1050;   // ms of contact per revealed digit
export const CODE_LEN = 4;
export const DIGIT_SHOW_MS = 1500;      // how long each digit stays visible on the catcher's HUD
export const ARM_WINDOW_MS = 9000;      // time to punch in the code once all digits leaked
export const WRONG_CODE_LOCK_MS = 4000;
export const GRAB_COOLDOWN_MS = 700;

// --- zone -------------------------------------------------------------------
export const ZONE_R0 = 2300;
export const ZONE_R1 = 250;
export const ZONE_DPS = 8;
export const ZONE_COIN_DRAIN = 0.35;    // coins per second outside
export const HP_REGEN = 3.5;

// --- loot -------------------------------------------------------------------
export const DROP_RESPAWN_MS = 24000;
export const DROP_PICK_R = 30;
export const INV_SLOTS = 2;
export const DROP_COIN_VALUE = 22;
export const BASE_BOUNTY = 120;
export const GHOST_MS = 9000;
export const RESPAWN_INVULN_MS = 2200;

// --- visibility -------------------------------------------------------------
export const SEE_RANGE = 340;   // players this close are physically visible

export const COLORS = [
  '#ff4d6d', '#4dd8ff', '#ffd166', '#8affc1',
  '#c98bff', '#ff9f45', '#5c9dff', '#f2f2ff',
];

export const POWERUPS = {
  sonar: { key: 'sonar', name: 'SONAR', hue: '#4dd8ff', blurb: 'Exact fix on your target for 6s' },
  ghost: { key: 'ghost', name: 'GHOST', hue: '#c98bff', blurb: 'Skip your next 2 pings' },
  decoy: { key: 'decoy', name: 'DECOY', hue: '#ffd166', blurb: 'Send your hunter a fake blip' },
  stim:  { key: 'stim',  name: 'STIM',  hue: '#8affc1', blurb: 'Full stamina + speed burst' },
  jam:   { key: 'jam',   name: 'JAM',   hue: '#ff9f45', blurb: 'Your next ping shows a stale position' },
};
export const POWERUP_KEYS = Object.keys(POWERUPS);

export const BOT_NAMES = ['MARLOWE', 'VOSS', 'RIVERA', 'KAPLAN', 'SHORE', 'OKONKWO', 'DEAN', 'NYX'];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export function randomCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += Math.floor(rand() * 10);
  return s;
}

export function pingInterval(progress) {
  return lerp(PING_START_MS, PING_END_MS, clamp(progress, 0, 1));
}

// How big the uncertainty circle around a pinged player is.
export function pingRadius(p, now, progress) {
  let r;
  if (p.noise >= 1.2) r = PING_RADIUS.sprint;
  else if (p.noise <= 0.6) r = PING_RADIUS.sneak;
  else if (p.noise <= 0) r = PING_RADIUS.still;
  else r = PING_RADIUS.walk;
  if (p.dormant) r = 0;
  if (p.outside) r *= 1.7;
  r *= lerp(1.25, 0.85, clamp(progress, 0, 1)); // late game is more precise
  return r;
}

export function zoneAt(progress) {
  const t = easeInOut(clamp(progress, 0, 1));
  return { r: lerp(ZONE_R0, ZONE_R1, t) };
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function score(p) {
  return Math.round(p.coins);
}
