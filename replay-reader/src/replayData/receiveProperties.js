const DataBunch = require('../Classes/DataBunch');
const Replay = require('../Classes/Replay');
const NetFieldExportGroup = require('../Classes/NetFieldExports/NetFieldExportGroup');
const GlobalData = require('../utils/globalData');

/**
 * @param {Replay} archive
 * @param {NetFieldExportGroup} group
 * @param {DataBunch} bunch
 * @param {boolean} enableProperyChecksum
 * @param {boolean} netDeltaUpdate
 * @param {GlobalData} globalData
 */
const receiveProperties = (archive, group, bunch, enableProperyChecksum = true, netDeltaUpdate = false, globalData, staticActorId) => {
  const { netFieldParser } = globalData;
  const channelIndex = bunch.chIndex;

  if (globalData.debug && !netFieldParser.willReadType(group.pathName)) {
    return false;
  }

  if (enableProperyChecksum) {
    archive.skipBits(1);
  }

  const exportGroup = netFieldParser.createType(group);

  let hasData = false;
  let changedProperties = [];
  // Groups marked "deferUnknownHandles": keep the raw bits of every field of an update that
  // contains a not-yet-declared field, and decode it once the name arrives (see resolveDeferred).
  const defer = group.deferUnknownHandles && !netDeltaUpdate;
  const raw = defer ? [] : null;
  let unknownHandles = 0;

  while (true) {
    let handle = archive.readIntPacked();

    if (handle === 0) {
      break;
    }

    handle--;

    if (!group.isValidIndex(handle)) {
      return false;
    }

    const exportt = group?.netFieldExports[handle];
    const numbits = archive.readIntPacked();

    if (numbits == 0) {
      continue;
    }

    if (raw && numbits <= 4096 && archive.canRead(numbits)) {
      const save = archive.offset;
      raw.push({ handle, numbits, bits: archive.readBits(numbits) });
      archive.offset = save;
      archive.isError = false;
    }

    if (!exportt) {
      unknownHandles += 1;
      archive.skipBits(numbits);

      continue;
    }

    if (exportt.incompatible) {
      archive.skipBits(numbits);

      continue;
    }

    hasData = true;

    try {
      archive.addOffset(6, numbits);
      changedProperties.push(exportt.name);
      if (!netFieldParser.setType(exportGroup, exportt, group, archive, globalData)) {
        exportt.incompatible = true;
      }
    } catch (ex) {
      console.log(ex.stack);
    } finally {
      archive.popOffset(6, numbits, true);
    }
  }

  if (raw && unknownHandles > 0) {
    const pending = (globalData.deferredUpdates = globalData.deferredUpdates || {});
    const list = (pending[group.pathName] = pending[group.pathName] || []);

    if (list.length < 50000) {
      list.push({ chIndex: channelIndex, timeSeconds: bunch.timeSeconds, staticActorId, raw, decoded: new Set(changedProperties) });
    }
  }

  if (!netDeltaUpdate && hasData) {
    const actor = globalData.channels[bunch.chIndex].actor;
    const externalData = globalData.externalData[actor.actorNetGUID.value];

    if (externalData) {
      delete globalData.externalData[actor.actorNetGUID.value];
      const exportt = group?.netFieldExports[externalData.handle];

      if (exportt) {
        globalData.netFieldParser.setType(exportGroup, exportt, group, new Replay(externalData.payload), globalData);
      }
    }

    if (globalData.debug && !globalData.exportEmitter.eventNames().includes(exportGroup.type)) {
      console.log('Unhandled export', exportGroup.type)
    }

    try {
      globalData.exportEmitter.emit(
        exportGroup.type,
        {
          chIndex: channelIndex,
          data: exportGroup,
          timeSeconds: bunch.timeSeconds,
          staticActorId,
          globalData,
          result: globalData.result,
          states: globalData.states,
          setFastForward: globalData.setFastForward,
          stopParsing: globalData.stopParsingFunc,
          changedProperties,
        },
      );
    } catch (err) {
      console.error(`Error while exporting propertyExport "${exportGroup.type}": ${err.stack}`);
    }
  }

  return { exportGroup, changedProperties };
};

module.exports = receiveProperties;
