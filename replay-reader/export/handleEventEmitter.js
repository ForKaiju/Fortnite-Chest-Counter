const handleChest = require('./actorDespawn/handleChest');
const handleActiveGameplayModifiers = require('./netDeltaExport/handleActiveGameplayModifiers');
const handleChests = require('./propertyExport/handleChests');
const handleBroadcastRemoteClientInfoMapMarker = require('./propertyExport/handleBroadCastRemoteClientInfoMapMarker');
const handlePickup = require('./propertyExport/handlePickup');
const handlePlayerState = require('./propertyExport/handlePlayerState');
const handleGameplayCues = require('./propertyExport/handleGameplayCues');
const handleGameState = require('./propertyExport/handleGameState');
const handleHealthSet = require('./propertyExport/handleHealthSet');
const handleLabradorLlama = require('./propertyExport/handleLabradorLlama');
const handleLootLlama = require('./propertyExport/handleLootLlama');
const handlePlayerBuilds = require('./propertyExport/handlePlayerBuilds');
const handlePlayerPawn = require('./propertyExport/handlePlayerPawn');
const handlePlaylistInfo = require('./propertyExport/handlePlaylistInfo');
const handleSafezone = require('./propertyExport/handleSafezoneIndicator');
const handleSoccerGame = require('./propertyExport/handleSoccerGame');
const handleSpeedSign = require('./propertyExport/handleSpeedSign');
const handleSupplyDrop = require('./propertyExport/handleSupplyDrop');
const handleValets = require('./propertyExport/handleValets');
const handleInventory = require('./netDeltaExport/handleInventory');
const handleInventoryProperty = require('./propertyExport/handleInventory');
const handleSafezoneFastForwarding = require('./propertyExport/handleSafezoneIndicatorFastForwarding');

const handleEventEmitter = ({ actorDespawnEmitter, propertyExportEmitter, netDeltaReadEmitter, parsingEmitter }) => {
  actorDespawnEmitter.on('Tiered_Chest_Athena.Tiered_Chest_Athena_C', handleChest);

  propertyExportEmitter.on('SafeZoneIndicator.SafeZoneIndicator_C', handleSafezone);
  // propertyExportEmitter.on('SafeZoneIndicator.SafeZoneIndicator_C', handleSafezoneFastForwarding);
  propertyExportEmitter.on('PlayerPawn_Athena.PlayerPawn_Athena_C', handlePlayerPawn);
  // Network role of every player pawn: the recording player's own pawn is the odd one out.
  propertyExportEmitter.on('PlayerPawn_Athena.PlayerPawn_Athena_C', ({ chIndex, data, result, timeSeconds, changedProperties, globalData }) => {
    result.fctPawns = result.fctPawns || {};
    // Keyed by actor NetGUID: channels are reused, and a player can get a new pawn.
    const guid = globalData.channels[chIndex]?.actor?.actorNetGUID?.value ?? `ch${chIndex}`;
    const p = (result.fctPawns[guid] = result.fctPawns[guid] || { chIndex, guid, firstSeen: timeSeconds, updates: 0, counts: {}, searchStarts: [] });
    p.updates += 1;
    for (const k of changedProperties) {
      if (['RemoteViewPitch', 'ReplicatedMovement', 'bStartedInteractSearch', 'PlayerState', 'Controller', 'Location', 'bIsSkydiving'].includes(k)) {
        p.counts[k] = (p.counts[k] || 0) + 1;
      }
    }
    if (changedProperties.includes('bStartedInteractSearch')) {
      p.searchStarts.push({ t: timeSeconds, v: !!data.bStartedInteractSearch });
    }
    // 0 = null reference (the pawn lost its PlayerState, e.g. when it died): keep the real one.
    if (data.PlayerState) p.PlayerState = data.PlayerState;
    p.lastSeen = timeSeconds;
  });
  propertyExportEmitter.on('FortniteGame.FortPlayerStateAthena', handlePlayerState);
  // Team of every player, keyed by the PlayerState's NetGUID (what a pawn's PlayerState points to).
  propertyExportEmitter.on('FortniteGame.FortPlayerStateAthena', ({ chIndex, data, result, globalData, changedProperties }) => {
    const guid = globalData.channels[chIndex]?.actor?.actorNetGUID?.value;
    if (guid === undefined) return;
    result.fctPlayerStates = result.fctPlayerStates || {};
    const s = (result.fctPlayerStates[guid] = result.fctPlayerStates[guid] || { guid });
    for (const k of ['TeamIndex', 'SquadId', 'bIsABot']) if (changedProperties.includes(k)) s[k] = data[k];
    // Chest Counter extension: UniqueId ties this PlayerState to the hex ids used
    // by playerElim events, so pickaxe eliminations can be attributed to a player.
    if (changedProperties.includes('UniqueId')) s.UniqueId = data.UniqueId;
    if (changedProperties.includes('Owner')) {
      s.ownerValues = s.ownerValues || [];
      if (!s.ownerValues.includes(data.Owner)) s.ownerValues.push(data.Owner);
      if (data.Owner) s.Owner = data.Owner;
    }
  });
  propertyExportEmitter.on('Athena_GameState.Athena_GameState_C', handleGameState);
  propertyExportEmitter.on('FortniteGame.FortPickupAthena', handlePickup);
  propertyExportEmitter.on('Athena_GameState_C_ClassNetCache', handlePlaylistInfo);
  propertyExportEmitter.on('PlayerBuilds', handlePlayerBuilds);
  propertyExportEmitter.on('Valet', handleValets);
  propertyExportEmitter.on('BP_Athena_SpeedSign.BP_Athena_SpeedSign_C', handleSpeedSign);
  propertyExportEmitter.on('Chests', handleChests);
  propertyExportEmitter.on('FortniteGame.FortBroadcastRemoteClientInfo:ClientRemotePlayerAddMapMarker', handleBroadcastRemoteClientInfoMapMarker);
  propertyExportEmitter.on('FortniteGame.FortBroadcastRemoteClientInfo:ClientRemotePlayerRemoveMapMarker', handleBroadcastRemoteClientInfoMapMarker);
  propertyExportEmitter.on('FortniteGame.FortRegenHealthSet', handleHealthSet);
  propertyExportEmitter.on('gameplayCue', handleGameplayCues);
  propertyExportEmitter.on('BP_AIPawn_Labrador.BP_AIPawn_Labrador_C', handleLabradorLlama);
  propertyExportEmitter.on('AthenaSupplyDrop_Llama.AthenaSupplyDrop_Llama_C', handleLootLlama);
  propertyExportEmitter.on('AthenaSupplyDrop.AthenaSupplyDrop_C', handleSupplyDrop);
  propertyExportEmitter.on('Athena_SoccerGame.Athena_SoccerGame_C', handleSoccerGame);
  propertyExportEmitter.on('FortniteGame.FortInventory', handleInventoryProperty)
  // Only the recording player's inventory is replicated to them: its ReplayPawn is their pawn.
  propertyExportEmitter.on('FortniteGame.FortInventory', ({ data, result, timeSeconds }) => {
    if (!data.ReplayPawn) return;
    result.fctReplayPawns = result.fctReplayPawns || [];
    if (!result.fctReplayPawns.some((p) => p.pawn === data.ReplayPawn)) result.fctReplayPawns.push({ pawn: data.ReplayPawn, t: timeSeconds });
  });

  netDeltaReadEmitter.on('FortniteGame.ActiveGameplayModifier', handleActiveGameplayModifiers)
  netDeltaReadEmitter.on('FortniteGame.FortInventory', handleInventory);

  // parsingEmitter.on('channelOpened', console.log);
  // parsingEmitter.on('channelClosed', console.log);
  // parsingEmitter.on('nextChunk', console.log);
  // parsingEmitter.on('nextFrame', console.log);
};

module.exports = handleEventEmitter;
