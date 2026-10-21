import {buildHeadless} from './build.mjs';

// Both runtimes execute the same bundle; no source rewriting or DOM shim.
await buildHeadless();
await import('../../dist/headless/cli.mjs');
