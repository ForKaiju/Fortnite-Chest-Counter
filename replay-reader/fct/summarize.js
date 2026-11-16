// Fortnite Chest Tracker: turn a parsed replay into "chests opened by me / by my teammates".
//
// - Me: the pawn(s) named by FortInventory.ReplayPawn (only the recording player's inventory is
//   replicated to them), plus any pawn sharing their PlayerState (respawns, reboots).
//   Fallback when no inventory was recorded: the pawn with by far the most updates.
// - Teammates: pawns whose PlayerState has my TeamIndex.
// - A chest counts once, for the pawn named in its opening update (SearchingPawn, sent with
//   bAlreadySearched), or in the update where it is broken (bDestroyed). Ammo boxes are not chests.

const isAmmo = (kind) => /Ammo/i.test(kind || '');

const summarize = (r) => {
  const pawns = Object.values(r.fctPawns || {});
  const byGuid = new Map(pawns.map((p) => [p.guid, p]));
  const states = r.fctPlayerStates || {};

  // 1) My PlayerState: the only player (with a team) whose Owner (= its PlayerController) is
  //    replicated to me, since only my own controller exists on my machine.
  let ownerSource = 'playerstate';
  let ownerStates = new Set(
    Object.values(states)
      .filter((s) => s.Owner && s.TeamIndex !== undefined)
      .map((s) => s.guid),
  );

  if (ownerStates.size !== 1) {
    // 2) My inventory's pawn.  3) The pawn recorded far more often than any other.
    ownerStates = new Set();
    let guids = (r.fctReplayPawns || []).map((p) => p.pawn).filter((g) => byGuid.has(g));
    ownerSource = 'inventory';

    if (!guids.length) {
      ownerSource = 'activity';
      const sorted = [...pawns].sort((a, b) => b.updates - a.updates);
      if (sorted[0] && (!sorted[1] || sorted[0].updates > sorted[1].updates * 3)) guids = [sorted[0].guid];
    }

    for (const g of guids) if (byGuid.get(g).PlayerState) ownerStates.add(byGuid.get(g).PlayerState);
  }

  if (!ownerStates.size) {
    return { ok: false, reason: 'owner-not-found' };
  }

  const mine = new Set(pawns.filter((p) => p.PlayerState && ownerStates.has(p.PlayerState)).map((p) => p.guid));

  const teams = new Set([...ownerStates].map((s) => states[s] && states[s].TeamIndex).filter((t) => t !== undefined));
  const mateStates = new Set(Object.values(states).filter((s) => teams.has(s.TeamIndex) && !ownerStates.has(s.guid)).map((s) => s.guid));
  const isMate = (g) => {
    const p = byGuid.get(g);
    return !!(p && p.PlayerState && mateStates.has(p.PlayerState) && !mine.has(g));
  };

  const opened = (r.mapData && r.mapData.chests || []).filter((c) => c.searched && !isAmmo(c.kind) && c.openedBy);
  const own = opened.filter((c) => mine.has(c.openedBy));
  const mates = opened.filter((c) => isMate(c.openedBy));
  const kinds = (list) => list.reduce((o, c) => ((o[c.kind] = (o[c.kind] || 0) + 1), o), {});

  return {
    ok: true,
    ownerSource,
    ownChests: own.length,
    mateChests: mates.length,
    teammates: mateStates.size,
    // Chest Counter extension: pickaxe-broken chests travel the bDestroyed path
    // (never bAlreadySearched) — split them out of the "opened" totals.
    ownBroken: own.filter((c) => c.broken).length,
    mateBroken: mates.filter((c) => c.broken).length,
    myStateGuids: [...ownerStates],
    myPawnGuids: [...mine],
    // Chest Counter extension: hex UniqueIds of my PlayerState(s) — matches the
    // ids carried by playerElim events (eliminated / eliminator).
    myUniqueIds: [...ownerStates].map((g) => states[g] && states[g].UniqueId).filter((u) => u && u !== 'NULL' && u !== ''),
    ownTimes: own.map((c) => Math.round(c.searchedAt * 10) / 10).sort((a, b) => a - b),
    mateTimes: mates.map((c) => Math.round(c.searchedAt * 10) / 10).sort((a, b) => a - b),
    ownKinds: kinds(own),
    // Placed chests have a stable identifier on the map (the Map tab finds them by it).
    ownChestIds: own.map((c) => c.chestId).filter((id) => id && !/^ch\d+$/.test(id)),
    mateKinds: kinds(mates),
  };
};

module.exports = summarize;
