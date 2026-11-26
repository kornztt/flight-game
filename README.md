# SKYLINE RUNNER

[![make.fun](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/kornztt/flight-game/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/kornztt/flight-game/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

A complete 3D flight game that runs offline in a desktop browser. Chase view
over a living valley — river, lake, town, mountains, clouds — with a
built-from-triangles stunt plane, lit instruments, gold target rings and a
runway to bring her home to.

## Play

`node serve.ts`, then open http://localhost:8080 — or open `game/index.html`
from any static server. No network requests, no audio files: every sound is
synthesised with WebAudio.

- **W / S** — throttle · **Arrow keys** — pitch / roll & turn · **mouse drag** — steer
- **G** — landing gear · **F** — flaps · **A** — autopilot assist
- **P** — pause · **R** — restart · **M** — sound on/off

## Missions

- **RING RUN** — fly all 10 gold rings (chained rings build a combo bonus),
  then land on runway 36. Fuel and the clock are both against you.
- **TIME TRIAL** — 8 rings against a 2:45 clock.
- **LANDING DRILL** — start high on final approach; one clean touchdown wins.

Fly too slow and the wing stalls; fly into the hills and it's over. A gentle
touchdown on the runway after the rings — with fuel and time to spare — is
the win.

## Files

- `game/src/main.js` — state machine, missions, scoring, autopilot, loop
- `game/src/render.js` — WebGL renderer, sky, clouds, chase camera
- `game/src/terrain.js` — seeded heightfield: river, lake, town, runway
- `game/src/aircraft.js` — plane mesh + flight model
- `game/src/rings.js` — ring course, crossing detection, light beams
- `game/src/hud.js` — altitude / speed / heading, compass, attitude gauge, minimap
- `game/src/audio.js` — synthesised engine, chimes, warnings
- `game/src/input.js` — keyboard + mouse drag
- `game/src/config.js` — missions, scoring, ring waypoints

Everything here — code, art, sounds, names — is original work written for
this competition. No real aircraft, places or games are named.

## Hand in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and
writes `dossier.json` with the vendored `vendor/makefun-game.ts`.

## License

MIT — see `LICENSE`.
