// SKYLINE RUNNER — game configuration: world size, missions, scoring, tuning.
// All values are original to this game; nothing here names a real aircraft or place.
export const WORLD = {
  size: 4200, // world spans -2100..2100 m on x and z
  runwayAlt: 30, // flattened runway elevation (m)
  waterLevel: 4, // river / lake surface (m)
  stallSpeed: 42, // m/s: below this the wing stops lifting
  maxSpeed: 122, // m/s at full throttle
  cruiseSpeed: 82,
};

export const MISSIONS = {
  ringrun: {
    id: 'ringrun',
    name: 'RING RUN',
    tagline: 'Fly all 10 gold rings, then bring her home to the runway.',
    rings: 10,
    fuel: 100,
    timeLimit: 300,
    startFuelDrain: 1.0,
  },
  timetrial: {
    id: 'timetrial',
    name: 'TIME TRIAL',
    tagline: 'Eight rings against the clock. Smooth turns win races.',
    rings: 8,
    fuel: 100,
    timeLimit: 165,
    startFuelDrain: 0.8,
  },
  landing: {
    id: 'landing',
    name: 'LANDING DRILL',
    tagline: 'Start high on final approach. One clean touchdown wins.',
    rings: 0,
    fuel: 100,
    timeLimit: 180,
    startFuelDrain: 0.6,
  },
};

export const SCORING = {
  ringBase: 100,
  comboStep: 25, // extra per consecutive ring inside the combo window
  comboWindowSec: 25,
  landingBonus: 300,
  fuelBonusPerUnit: 2, // per fuel unit left at landing
  timeBonusPerSec: 2,
};

// Ring course: waypoints the gold rings hang on. Headings are derived from
// the segment direction, so the course reads as one winding valley run.
export const RING_WAYPOINTS = [
  { x: 0, y: 150, z: -520 },
  { x: 260, y: 190, z: -880 },
  { x: 620, y: 230, z: -1080 },
  { x: 880, y: 260, z: -820 },
  { x: 760, y: 240, z: -420 },
  { x: 420, y: 200, z: -180 },
  { x: 120, y: 170, z: 120 },
  { x: -260, y: 210, z: 420 },
  { x: -560, y: 250, z: 120 },
  { x: -420, y: 190, z: -320 },
];

export const CONTROLS_TEXT = [
  'W / S — throttle up / down',
  'Arrow Up / Down — pitch',
  'Arrow Left / Right — roll & turn',
  'Mouse drag — steer',
  'G — landing gear   F — flaps',
  'P — pause   R — restart   M — sound',
];
