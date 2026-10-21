import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildHeadless} from './build.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = join(root, 'dist/headless/cli.mjs');

test('daily graphic and statistics CLI under Node and Bun', {timeout: 180000}, async t => {
  const [inputs] = await Promise.all([buildHeadless(), buildHeadless()]);
  assert.equal(inputs.some(path => /\/components\/|\/pdf.service.ts$|\/data.service.ts$/.test(path)), false);
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  const temp = await mkdtemp(join(tmpdir(), 'nightrep-test-'));
  // Generated credential is local to this synthetic server and never committed.
  const token = randomBytes(24).toString('hex');
  let mode = 'ok';
  let requests = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests++;
    assert.equal(url.searchParams.has('token'), false);
    if (req.headers.authorization !== `Bearer ${token}` || mode === '401') {
      res.writeHead(401).end('{}');
      return;
    }
    let body;
    if (url.pathname === '/api/v1/status.json') {
      body = {status: 'ok', name: 'Synthetic NS', version: '15.0.0', settings: {
        units: 'mg/dl', thresholds: {bgHigh: 250, bgTargetTop: 180, bgTargetBottom: 70, bgLow: 54}
      }};
    } else if (url.pathname === '/api/v1/profile.json') {
      body = [{_id: 'synthetic', defaultProfile: 'Default', startDate: '2020-01-01T00:00:00.000Z',
        created_at: '2020-01-01T00:00:00.000Z', units: 'mg/dl', store: {Default: {
          dia: 3, carbs_hr: 20, delay: 20, timezone: 'Europe/Bratislava', units: 'mg/dl',
          basal: [{time: '00:00', value: 0.7}], sens: [{time: '00:00', value: 50}],
          carbratio: [{time: '00:00', value: 10}], target_low: [{time: '00:00', value: 90}],
          target_high: [{time: '00:00', value: 110}]
        }}}];
    } else if (url.pathname === '/api/v1/entries.json') {
      if (mode === 'partial') {
        res.writeHead(500).end('{}');
        return;
      }
      const start = +url.searchParams.get('find[date][$gte]');
      const end = +url.searchParams.get('find[date][$lte]');
      assert.ok(start && end && end - start <= 86400000);
      body = mode === 'empty' ? [] : Array.from({length: 288}, (_, i) => ({
        _id: `synthetic-${start + i * 300000}`, date: start + i * 300000,
        dateString: new Date(start + i * 300000).toISOString(),
        sgv: Math.round(135 + 85 * Math.sin(i * Math.PI / 72)),
        type: 'sgv', device: 'synthetic', direction: 'Flat'
      })).filter(entry => entry.date <= end).reverse();
    } else if (['/api/v1/treatments.json', '/api/v1/devicestatus.json', '/api/v1/activity.json'].includes(url.pathname)) {
      body = [];
    } else {
      res.writeHead(404).end('{}');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(temp, {recursive: true, force: true});
  });
  const job = {
    nsUrl: `http://127.0.0.1:${server.address().port}`, start: '2026-10-18', end: '2026-10-18',
    units: 'mmol/L', locale: 'de-DE', forms: ['daygraph', 'analysis'], output: join(temp, 'report.pdf')
  };
  async function run(runtime, overrides = {}, env = {}, entry = cli, runtimeArgs = []) {
    const path = join(temp, `${randomBytes(6).toString('hex')}.json`);
    await writeFile(path, JSON.stringify({...job, ...overrides}));
    return exec(runtime, [...runtimeArgs, entry, path], {
      cwd: root, timeout: 45000, env: {...process.env, TZ: 'Europe/Bratislava', NS_TOKEN: token, ...env}
    });
  }
  async function verifyPdf(path, titles = ['Tagesgrafik', 'Auswertung']) {
    assert.equal((await readFile(path)).subarray(0, 5).toString(), '%PDF-');
    const {stdout: info} = await exec('pdfinfo', [path]);
    assert.match(info, /Pages:\s+2\b/);
    const {stdout: text} = await exec('pdftotext', ['-layout', path, '-']);
    for (const title of titles) assert.ok(text.includes(title), text);
    assert.match(text, /288\s*\(/);
    assert.equal(text.includes(token), false);
    assert.equal((await readFile(path)).includes(Buffer.from(token)), false);
    return text;
  }
  for (const runtime of ['node', 'bun']) {
    await t.test(`${runtime}: two pages, titles, 288 measurements, no DOM`, async () => {
      mode = 'ok';
      const {stdout, stderr} = await run(runtime);
      const result = JSON.parse(stdout.trim());
      assert.equal(result.entries, 288);
      assert.equal(result.days, 1);
      assert.equal(result.browserGlobals, false);
      assert.equal((stdout + stderr).includes(token), false);
      const text = await verifyPdf(job.output);
      assert.match(text, /mmol/);
    });
    await t.test(`${runtime}: documented build-and-run entry point`, async () => {
      mode = 'ok';
      const {stdout} = await run(runtime, {}, {}, join(root, 'src/headless/run.mjs'));
      assert.equal(JSON.parse(stdout.trim()).entries, 288);
      await verifyPdf(job.output);
    });
    await t.test(`${runtime}: validation, authentication and partial-data failures preserve output`, async () => {
      const original = await readFile(job.output);
      for (const [overrides, serverMode, env, message] of [
        [{units: 'invalid'}, 'ok', {}, /units/],
        [{start: '2026-10-19'}, 'ok', {}, /Period/],
        [{start: '2026-02-30'}, 'ok', {}, /calendar/],
        [{forms: ['cgp']}, 'ok', {}, /Only daygraph/],
        [{locale: 'invalid'}, 'ok', {}, /locale/],
        [{token: 'forbidden'}, 'ok', {}, /credentials/],
        [{nsUrl: job.nsUrl + '?token=forbidden'}, 'ok', {}, /credentials/],
        [{}, 'ok', {NS_TOKEN: token + '\n'}, /single visible ASCII token/],
        [{}, '401', {}, /401/],
        [{}, 'ok', {NS_TOKEN: ''}, /401/],
        [{}, 'partial', {}, /500/],
        [{}, 'empty', {}, /No valid Reporter data/]
      ]) {
        mode = serverMode;
        await assert.rejects(run(runtime, overrides, env), error => {
          assert.match(error.stderr, message);
          assert.equal(error.stderr.includes(token), false);
          return true;
        });
        assert.deepEqual(await readFile(job.output), original);
      }
    });
  }
  await t.test('Node: English locale and mg/dL use existing translations and units', async () => {
    mode = 'ok';
    await run('node', {units: 'mg/dL', locale: 'en-GB'});
    const text = await verifyPdf(job.output, ['Daily Graph', 'Analysis']);
    assert.match(text, /mg\/d[Ll]/);
  });
  await t.test('simultaneous retries replace complete PDFs and clean temporary files', async () => {
    mode = 'ok';
    await Promise.all([run('node'), run('bun')]);
    await verifyPdf(job.output);
    assert.deepEqual((await readdir(temp)).filter(name => name.startsWith('.nightrep-')), []);
  });
  await t.test('symlink output fails without changing target', async () => {
    const link = join(temp, 'linked.pdf');
    const original = await readFile(job.output);
    await symlink(job.output, link);
    const before = requests;
    await assert.rejects(run('node', {output: link}), /regular file/);
    assert.deepEqual(await readFile(job.output), original);
    assert.equal(requests, before);
  });
  await t.test('crash before atomic rename preserves output; retry succeeds', async () => {
    mode = 'ok';
    const original = await readFile(job.output);
    const preload = join(temp, 'crash-before-rename.mjs');
    await writeFile(preload, `
      import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module';
      const rename = fs.promises.rename;
      fs.promises.rename = async (source, target) => {
        if (source.endsWith('/report.pdf')) process.kill(process.pid, 'SIGKILL');
        return rename(source, target);
      };
      syncBuiltinESMExports();
    `);
    await assert.rejects(run('node', {}, {}, cli, ['--import', preload]), error => {
      assert.equal(error.signal, 'SIGKILL');
      return true;
    });
    assert.deepEqual(await readFile(job.output), original);
    const staged = (await readdir(temp)).filter(name => name.startsWith('.nightrep-'));
    assert.equal(staged.length, 1);
    // The crash occurred after streaming a complete PDF, before replacing output.
    await verifyPdf(join(temp, staged[0], 'report.pdf'));
    await run('node');
    await verifyPdf(job.output);
  });
});
