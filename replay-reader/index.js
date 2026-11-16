// Fortnite replay reader (local .replay files only). Based on fortnite-replay-parser by xNocken
// (MIT, see LICENSE and NOTICE.md); the streaming/download mode of the original was removed.
const Replay = require('./src/Classes/Replay');
const { replayInfo, replayChunks } = require('./src/parse');
const GlobalData = require('./src/utils/globalData');
const parseChunks = require('./src/parseChunks');

let isParsing = false;

const parse = async (data, options) => {
  if (isParsing) {
    throw Error('Cannot parse multiple replays at once');
  }

  if (!(data instanceof Buffer)) {
    throw Error('Expected the content of a .replay file');
  }

  isParsing = true;

  const globalData = new GlobalData({ ...(options || {}), debug: false });
  let info;
  let chunks;
  let events = [];

  globalData.additionalStates.forEach((stateName) => {
    globalData.states[stateName] = {};
  });

  globalData.handleEventEmitter({
    propertyExportEmitter: globalData.exportEmitter,
    actorDespawnEmitter: globalData.actorDespawnEmitter,
    netDeltaReadEmitter: globalData.netDeltaEmitter,
    parsingEmitter: globalData.parsingEmitter,
  });

  try {
    const replay = new Replay(data);

    info = replayInfo(replay, globalData);
    chunks = replayChunks(replay, globalData);
    events = await parseChunks(replay, chunks, globalData);
  } finally {
    isParsing = false;
  }

  return {
    header: globalData.header,
    info,
    chunks,
    events,
    ...globalData.result,
  };
};

module.exports = parse;
