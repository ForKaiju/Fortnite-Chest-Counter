# Replay reader — notice

Based on **fortnite-replay-parser 1.4.8** by xNocken (https://github.com/xNocken/replay-reader),
MIT License, copyright (c) 2021 xNocken — see `LICENSE`. Modified for Fortnite Chest Tracker:

- partial bunches: reads the `bPartialCustomExportsFinal` bit written by engine network version 45+;
- world-partition actor names (`<Class>_C_UAID_<hex>`) are matched to their class;
- each listed class keeps its own property layout (one definition can list several classes);
- updates that use a field before the replay declares its name are kept and decoded once the
  name arrives (Fortnite does this for a chest's `bAlreadySearched`);
- in-packet field declarations (`ReceiveNetFieldExportsCompat`) fixed;
- chest openings record the opener (`SearchingPawn`), pawns are tracked by network id with their
  PlayerState, and PlayerStates keep their team and owner;
- `fct/summarize.js` and `fct/worker.cjs`: counts the chests opened by the recording player and
  by their teammates;
- streaming/download mode and debug file output removed; Oodle decompression is delegated to the
  separate `oodle-ooz` program.
