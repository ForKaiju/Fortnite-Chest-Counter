const NetFieldExportGroup = require('../Classes/NetFieldExports/NetFieldExportGroup');
const Replay = require('../Classes/Replay');
const resolveDeferred = require('./resolveDeferred');

/**
 * Field-name declarations sent inside a packet (UPackageMapClient::ReceiveNetFieldExportsCompat).
 * Fixed: misspelled group lookup, wrong arguments, bit-level FName, and the property
 * definitions (parse functions) were not attached, so these fields could never be decoded.
 * @param {Replay} packet
 */
const receiveNetFieldExportsCompat = (packet, globalData) => {
  const { netFieldParser, netGuidCache } = globalData;
  const numLayoutCmdLayout = packet.readUInt32();
  const declared = new Set();

  for (let i = 0; i < numLayoutCmdLayout; i++) {
    const pathNameIndex = packet.readIntPacked();
    let group;

    if (packet.readBit()) {
      const pathName = packet.readString();
      const numExports = packet.readUInt32();

      group = netGuidCache.NetFieldExportGroupMap[pathName];

      if (!group) {
        group = new NetFieldExportGroup();
        group.pathName = pathName;
        group.pathNameIndex = pathNameIndex;
        group.netFieldExportsLength = numExports;
        group.netFieldExports = [];
        netGuidCache.addToExportGroupMap(pathName, group, globalData);
      }
    } else {
      group = netGuidCache.GetNetFieldExportGroupFromIndex(pathNameIndex);
    }

    // FNetFieldExport: uint8 bExported, packed handle, uint32 checksum, FName (bit-level here).
    const isExported = packet.readByte();

    if (!isExported) {
      continue;
    }

    const netField = { handle: packet.readIntPacked(), compatibleChecksum: packet.readUInt32() };
    netField.name = packet.header.EngineNetworkVersion < 10 ? packet.readString() : packet.readFName();

    if (!group || !group.isValidIndex(netField.handle)) {
      continue;
    }

    if (group.parseUnknownHandles || group.pathName === 'NetworkGameplayTagNodeIndex') {
      group.netFieldExports[netField.handle] = netField;
      continue;
    }

    const definition = netFieldParser.getNetFieldExport(group.pathName);
    const property = definition && definition.properties[netField.name];

    if (property) {
      group.netFieldExports[netField.handle] = { ...property, ...netField };

      if (group.deferUnknownHandles) {
        declared.add(group);
      }
    }
  }

  for (const group of declared) {
    resolveDeferred(group, globalData, packet.header);
  }
};

module.exports = receiveNetFieldExportsCompat;
