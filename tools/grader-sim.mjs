// Grader simulation: copies the entry to a read-only directory and runs
// main.ts twice as uid 65534 (setpriv), into two fresh output dirs.
// Both runs must exit 0 and write byte-identical dossiers.
// Run: node tools/grader-sim.mjs
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ROOT = '/tmp/gsim-readonly';
const OUT1 = '/tmp/gsim-out1';
const OUT2 = '/tmp/gsim-out2';
execSync(`rm -rf ${ROOT} ${OUT1} ${OUT2}`, { stdio: 'inherit' });
execSync(`cp -r /home/hatch/workspace/makefun-flight-game/entry ${ROOT}`, { stdio: 'inherit' });
execSync(`chmod -R a+rX ${ROOT} && chmod -R a-w ${ROOT}`, { stdio: 'inherit' });
execSync(`mkdir -p ${OUT1} ${OUT2} && chmod 777 ${OUT1} ${OUT2}`, { stdio: 'inherit' });
for (const out of [OUT1, OUT2]) {
  execSync(
    `sh -c 'cd ${ROOT} && MAKEFUN_OUTPUT_DIR=${out} setpriv --reuid=65534 --regid=65534 --clear-groups node main.ts'`,
    { stdio: 'inherit' },
  );
}
const h = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const d1 = h(`${OUT1}/dossier.json`);
const d2 = h(`${OUT2}/dossier.json`);
console.log('run1 dossier sha256:', d1);
console.log('run2 dossier sha256:', d2);
console.log(d1 === d2 ? 'GRADER-SIM PASS: dossiers byte-identical' : 'GRADER-SIM FAIL: dossiers differ');
process.exit(d1 === d2 ? 0 : 1);
