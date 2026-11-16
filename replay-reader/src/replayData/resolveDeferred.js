const Replay = require('../Classes/Replay');

/**
 * New field names were declared for `group`: decode again the stored updates of that group that
 * contain one of them, and emit them with their original time (late, but complete).
 * Fortnite replays can declare a field (e.g. a chest's bAlreadySearched) only after its first use.
 * Called once per declaration block, so fields declared together (bAlreadySearched and
 * SearchingPawn) are decoded together.
 */
const resolveDeferred = (group, globalData, header) => {
  const list = globalData.deferredUpdates && globalData.deferredUpdates[group.pathName];

  if (!list || !list.length) {
    return;
  }

  const { netFieldParser } = globalData;

  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    const fresh = rec.raw.some((f) => {
      const ex = group.netFieldExports[f.handle];

      return ex && !ex.incompatible && !rec.decoded.has(ex.name);
    });

    if (!fresh) {
      continue;
    }

    const data = netFieldParser.createType(group);
    const changedProperties = [];

    for (const f of rec.raw) {
      const ex = group.netFieldExports[f.handle];

      if (!ex || ex.incompatible) {
        continue;
      }

      const archive = new Replay(f.bits, f.numbits);
      archive.header = header;

      try {
        if (netFieldParser.setType(data, ex, group, archive, globalData)) {
          changedProperties.push(ex.name);
        }
      } catch (err) {
        // keep going: one bad field must not hide the others
      }

      rec.decoded.add(ex.name);
    }

    if (!changedProperties.length) {
      continue;
    }

    try {
      globalData.exportEmitter.emit(data.type, {
        chIndex: rec.chIndex,
        data,
        timeSeconds: rec.timeSeconds,
        staticActorId: rec.staticActorId,
        globalData,
        result: globalData.result,
        states: globalData.states,
        setFastForward: globalData.setFastForward,
        stopParsing: globalData.stopParsingFunc,
        changedProperties,
        late: true,
      });
    } catch (err) {
      console.error(`Error while exporting deferred "${data.type}": ${err.stack}`);
    }
  }
};

module.exports = resolveDeferred;
