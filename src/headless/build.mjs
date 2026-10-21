import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdir, rename, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';

export async function buildHeadless() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/headless/cli.ts'],
    outfile: 'dist/headless/cli.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    banner: {js: "import '@angular/compiler'; import '@angular/localize/init';"},
    tsconfig: 'tsconfig.json',
    metafile: true,
    write: false
  });
  const dir = join(root, 'dist/headless');
  await mkdir(dir, {recursive: true});
  const temp = join(dir, `cli-${randomUUID()}.mjs`);
  try {
    await writeFile(temp, result.outputFiles[0].contents, {flag: 'wx'});
    await rename(temp, join(dir, 'cli.mjs'));
  } finally {
    await rm(temp, {force: true});
  }
  return Object.keys(result.metafile.inputs);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildHeadless();
