'use strict';

// Season 43 "Pirate Treasure" — Treasure Hunters weekly prize crews.
//
// Dates and prize names mirror Epic's published schedule (the same table
// fortnite.bot/treasure renders). Art is not redistributed with the app: the
// server proxies each webp out of fortnite.bot's CDN once, caches it in
// %APPDATA%\Chest Counter\images, and serves it from /img/treasure/<file>.
//
// Weeks 4 and 5 are still encrypted in the game data, so they carry no items
// until Epic ships them — the panel and overlay show the crew art with locked
// tiles instead of inventing names.

const WEEKS = [
  {
    n: 1,
    name: 'A$AP Arrives',
    from: '2026-11-01',
    to: '2026-11-08',
    crew: 'crew-1.webp',
    items: [
      { id: 'shopAccess',    type: 'Item Shop Token', name: 'Pirate Shop Access', img: 'token.webp' },
      { id: 'goldOutfit',    type: 'Outfit',          name: 'Solid Gold A$AP Rocky', img: 'w1-outfit.webp' },
      { id: 'pickBack',      type: 'Pickaxe',         name: "Solid Gold A$AP Rocky's Gauntlets", img: 'w1-pickaxe.webp' },
      { id: 'vehicleDecal',  type: 'Car Decal',       name: 'Gold Mercedes-AMG G 63 Decal', img: 'w1-car.webp' },
      { id: 'jamTrack',      type: 'Jam Track',       name: 'A$AP Rocky Jam Track', img: 'w1-jam.webp' },
      { id: 'loadingScreen', type: 'Loading Screen',  name: 'Plunder in Paradise', img: 'w1-loading.webp' },
    ],
  },
  {
    n: 2,
    name: 'Lil Uzi Arrives',
    from: '2026-11-08',
    to: '2026-11-15',
    crew: 'crew-2.webp',
    items: [
      { id: 'shopAccess',    type: 'Item Shop Token', name: 'Pirate Shop Access', img: 'token.webp' },
      { id: 'goldOutfit',    type: 'Outfit',          name: 'Solid Gold Lil Uzi Vert', img: 'w2-outfit.webp' },
      { id: 'pickBack',      type: 'Back Bling',      name: 'Diamond and Gold', img: 'w2-backbling.webp' },
      { id: 'vehicleDecal',  type: 'Car Decal',       name: 'Gold Cadillac CT5-V Decal', img: 'w2-car.webp' },
      { id: 'jamTrack',      type: 'Jam Track',       name: 'Lil Uzi Vert Jam Track', img: 'w2-jam.webp' },
      { id: 'loadingScreen', type: 'Loading Screen',  name: 'So Kawaii', img: 'w2-loading.webp' },
    ],
  },
  {
    n: 3,
    name: 'Miku & Teto Arrive',
    from: '2026-11-15',
    to: '2026-11-22',
    crew: 'crew-3.webp',
    items: [
      { id: 'shopAccess',    type: 'Item Shop Token', name: 'Pirate Shop Access', img: 'token.webp' },
      { id: 'goldOutfit',    type: 'Outfit',          name: 'Solid Gold Miku', img: 'w3-outfit.webp' },
      { id: 'pickBack',      type: 'Back Bling',      name: "Miku's Takarabako", img: 'w3-backbling.webp' },
      { id: 'vehicleDecal',  type: 'Car Decal',       name: 'Gold Chevrolet Corvette ZR1 Decal', img: 'w3-car.webp' },
      { id: 'jamTrack',      type: 'Jam Track',       name: 'PPPP', img: 'w3-jamtrack.webp' },
      { id: 'loadingScreen', type: 'Loading Screen',  name: 'May Fortune Find You', img: 'w3-loading.webp' },
    ],
  },
  {
    n: 4,
    name: 'Oscar Arrives',
    from: '2026-11-22',
    to: '2026-11-29',
    crew: 'crew-4.webp',
    items: [],
    locked: true,
  },
  {
    n: 5,
    name: 'The Final Hunt',
    from: '2026-11-29',
    to: '2026-12-05',
    crew: 'crew-5.webp',
    items: [],
    locked: true,
  },
];

const pad = (n) => String(n).padStart(2, '0');
// Epic flips the treasure week at the Sunday item-shop reset (07:00 UTC), not
// at local midnight — a week's `from` date is the Sunday it goes live on.
function weekStart(w) { return Date.parse(w.from + 'T07:00:00Z'); }
function weekEnd(w) { return Date.parse(w.to + 'T07:00:00Z'); }

function currentWeek(now = Date.now()) {
  return WEEKS.find((w) => now >= weekStart(w) && now < weekEnd(w)) || null;
}

module.exports = { WEEKS, currentWeek, weekStart, weekEnd };
