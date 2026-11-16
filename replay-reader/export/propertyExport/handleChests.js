// Every change of a chest: who is searching it (SearchingPawn = the pawn's network id) and
// when it becomes searched, or broken.
const handleChests = ({ chIndex, data, staticActorId, timeSeconds, result, states, changedProperties, globalData }) => {
  const key = staticActorId || `ch${chIndex}`;
  let chest = states.chests[key];

  if (!chest) {
    chest = {
      chestId: key,
      kind: staticActorId ? staticActorId.split('_UAID_')[0] : 'dynamic',
      searched: false,
      searchers: [],
      searchedAt: null,
      firstSeenAt: timeSeconds,
    };
    states.chests[key] = chest;
    result.mapData.chests.push(chest);
  }

  if (data.SearchingPawn) {
    if (!chest.searchers.some((s) => s.pawn === data.SearchingPawn)) {
      chest.searchers.push({ pawn: data.SearchingPawn, pawnCh: globalData.actorToChannel[data.SearchingPawn], t: timeSeconds });
    }
  }

  // A late-decoded opening update can bring the opener after the chest was marked searched.
  if (chest.searched && !chest.openedBy && data.SearchingPawn && Math.abs(timeSeconds - chest.searchedAt) < 0.05) {
    chest.openedBy = data.SearchingPawn;
    chest.openedByInSameUpdate = true;
  }

  if (changedProperties.includes('bAlreadySearched') && data.bAlreadySearched && !chest.searched) {
    chest.searched = true;
    chest.searchedAt = timeSeconds;
    chest.searchedWhileSeen = timeSeconds > chest.firstSeenAt;
    // The opening update carries the opener (SearchingPawn) next to bAlreadySearched.
    chest.openedBy = data.SearchingPawn || chest.searchers.at(-1)?.pawn || null;
    chest.openedByInSameUpdate = !!data.SearchingPawn;
  }

  // A chest broken with the pickaxe is never "searched": it gets bDestroyed, and the update
  // names whoever broke it (SearchingPawn). It counts as opened by that player. No earlier
  // searcher is used as a fallback: a destroyed chest without a breaker (explosion) counts for nobody.
  if (changedProperties.includes('bDestroyed') && data.bDestroyed && !chest.searched) {
    chest.searched = true;
    chest.broken = true;
    chest.searchedAt = timeSeconds;
    chest.searchedWhileSeen = timeSeconds > chest.firstSeenAt;
    chest.openedBy = data.SearchingPawn || null;
    chest.openedByInSameUpdate = !!data.SearchingPawn;
  }
};

module.exports = handleChests;
