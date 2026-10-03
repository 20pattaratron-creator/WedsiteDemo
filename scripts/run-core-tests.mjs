import {spawnSync} from 'node:child_process';
import {CORE_TEST_FILES} from './core-test-files.mjs';
const run=spawnSync(process.execPath,['--test',...CORE_TEST_FILES],{stdio:'inherit'});
process.exitCode=run.status??1;
