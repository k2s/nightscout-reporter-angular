import '@angular/compiler';
import '@angular/localize/init';
import {createWriteStream} from 'node:fs';
import {lstat, mkdtemp, readFile, rename, rm} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {firstValueFrom, from, of} from 'rxjs';
import PdfPrinter from 'pdfmake';
import type {PdfImages} from '@/_model/pdf-document';
import {LanguageService} from '@/_services/language.service';
import messagesData from '../assets/messages.json';
import type {DataService} from '@/_services/data.service';
import type {MessageService} from '@/_services/message.service';
import type {ThemeService} from '@/_services/theme.service';

function requireValue(valid: unknown, message: string): asserts valid {
  if (!valid) throw new Error(message);
}

function calendarDate(value: unknown): Date {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Dates must be YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00`);
  requireValue(Number.isFinite(+date) && date.getFullYear() === +value.slice(0, 4)
    && date.getMonth() + 1 === +value.slice(5, 7) && date.getDate() === +value.slice(8), 'Invalid calendar date');
  return date;
}

async function checkOutput(output: string) {
  try {
    const stat = await lstat(output);
    requireValue(stat.isFile() && !stat.isSymbolicLink(), 'Output must be a regular file');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // Do not follow symlinks in an output path.
  for (let dir = dirname(output); ; dir = dirname(dir)) {
    const stat = await lstat(dir);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'Output directory must not be a symlink');
    if (dirname(dir) === dir) break;
  }
}

async function main() {
  requireValue(typeof window === 'undefined' && typeof document === 'undefined', 'Headless mode requires no browser globals');
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  requireValue(args.length === 1, 'Usage: npm run headless -- job.json');
  const cfg = JSON.parse(await readFile(args[0], 'utf8'));
  requireValue(cfg && typeof cfg === 'object' && !Array.isArray(cfg), 'Job must be an object');
  const keys = ['nsUrl', 'start', 'end', 'units', 'locale', 'forms', 'output'];
  requireValue(Object.keys(cfg).every(key => keys.includes(key)), 'Unknown job field; credentials belong only in NS_TOKEN');
  requireValue(typeof cfg.nsUrl === 'string', 'nsUrl is required');
  const base = new URL(cfg.nsUrl);
  requireValue(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password
    && !base.search && !base.hash, 'nsUrl must be an HTTP(S) URL without credentials, query or fragment');
  requireValue(['mg/dL', 'mmol/L'].includes(cfg.units), 'units must be mg/dL or mmol/L');
  const start = calendarDate(cfg.start);
  const end = calendarDate(cfg.end);
  requireValue(end >= start && +end - +start <= 31 * 86400000, 'Period must be ordered and at most 31 days apart');
  requireValue(typeof cfg.output === 'string' && cfg.output.length > 0, 'output is required');
  const output = resolve(cfg.output);
  await checkOutput(output);
  const formIds: string[] = cfg.forms ?? ['daygraph', 'analysis'];
  requireValue(Array.isArray(formIds) && formIds.length > 0 && formIds.length <= 2
    && new Set(formIds).size === formIds.length
    && formIds.every(id => ['daygraph', 'analysis'].includes(id)), 'Only daygraph and analysis forms are supported');
  requireValue(!process.env['NS_TOKEN'] || /^[\x21-\x7e]+$/.test(process.env['NS_TOKEN']), 'NS_TOKEN must be a single visible ASCII token');

  const locale = cfg.locale ?? 'de-DE';
  requireValue(messagesData.some(lang => lang.id === locale), 'Unsupported locale');
  // Load translations before models evaluate their static localized labels.
  new LanguageService().activate(locale);
  const {GlobalsData} = await import('@/_model/globals-data');
  const {UserData} = await import('@/_model/nightscout/user-data');
  const {UrlData} = await import('@/_model/nightscout/url-data');
  const {collectPages, preprocessData} = await import('@/_model/pdf-document');
  const {NightscoutService} = await import('@/_services/nightscout.service');
  const {ProgressService} = await import('@/_services/progress.service');
  const {Log, LogService} = await import('@/_services/log.service');
  const {PrintDailyGraphic} = await import('@/forms/nightscout/print-daily-graphic');
  const {PrintAnalysis} = await import('@/forms/nightscout/print-analysis');
  const GLOBALS = GlobalsData._globals;
  const language = GLOBALS.languageList.find(lang => lang.code === locale);
  requireValue(language, 'Unsupported locale');
  GLOBALS.language = language;
  GLOBALS.avoidSaveAndLoad = true;
  GLOBALS.ppShowDurationWarning = false;
  GLOBALS.ppShowSlowServerWarning = false;
  GLOBALS.ppUseEmojiImages = false;
  GLOBALS.glucMGDLIdx = cfg.units === 'mg/dL' ? 0 : 1;
  GLOBALS.period.start = start;
  GLOBALS.period.end = end;
  const user = new UserData();
  user.name = '';
  user.listApiUrl = [UrlData.fromJson({u: base.href.replace(/\/$/, '')})];
  GLOBALS.userList = [user];
  LogService.create(false, false, true);

  let failure: Error;
  const failDialog = () => {
    failure ??= new Error('Reporter requires corrected settings; use the browser to inspect this data');
    return of(null);
  };
  const messages = {showDialog: failDialog, warn: failDialog, showPopup: failDialog} as unknown as MessageService;
  const progress = new ProgressService(messages);
  const dataService = {
    async requestJson(requestUrl: string) {
      // NightscoutService handles some errors itself; retain failures so a partial report cannot succeed.
      try {
        const target = new URL(requestUrl);
        requireValue(target.origin === base.origin && target.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/api/'),
          'Nightscout request escaped configured API');
        requireValue(!target.username && !target.password && !target.searchParams.has('token'), 'Credentials must not appear in URLs');
        const response = await fetch(target, {
          redirect: 'error',
          headers: process.env['NS_TOKEN'] ? {Authorization: `Bearer ${process.env['NS_TOKEN']}`} : {},
          signal: AbortSignal.timeout(15000)
        });
        requireValue(response.ok, `Nightscout HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error('Nightscout request failed');
        throw failure;
      }
    }
  } as unknown as DataService;
  const ns = new NightscoutService(progress, dataService, {currTheme: {}} as ThemeService, messages);
  // Bundle lives in dist/headless; assets stay in the source checkout.
  const assets = fileURLToPath(new URL('../../src/assets/', import.meta.url));
  const pdf: PdfImages = {
    collectBase64Images: ids => from(Promise.all(ids.map(async id => {
      requireValue(/^[a-zA-Z0-9_.-]+$/.test(id) && !id.includes('..'), 'Unsupported image identifier');
      return {id, url: `data:image/png;base64,${(await readFile(join(assets, 'img', `${id}.png`))).toString('base64')}`};
    })))
  };
  const forms = formIds.map(id => id === 'daygraph' ? new PrintDailyGraphic(pdf) : new PrintAnalysis(pdf));
  for (const form of forms) {
    form.checked = true;
    if (form.baseId === 'daygraph') {
      // Fixed glucose-only preset; no additional basal/analysis pages below each graph.
      form.params[3].boolValue = false;
      form.params[4].boolValue = false;
    }
  }
  GLOBALS.listConfigOrg = forms;
  GLOBALS.listConfig = forms;
  const data = await ns.loadData(false);
  if (failure) throw failure;
  requireValue(data.isValid && !data.error && data.data.entries.length > 0 && Log.msg['error'].length === 0, 'No valid Reporter data');
  const docs: any[] = [];
  for (const [idx, form] of forms.entries()) {
    const result = await firstValueFrom(collectPages(form, idx, data, ns.checkCfg(form)));
    requireValue(result?.docList.length === 1, 'Form did not produce a single PDF document');
    docs.push(result.docList[0]);
  }
  requireValue(!JSON.stringify(docs).includes('Fehler bei Erstellung'), 'Reporter could not render a form');
  const definition = docs[0];
  for (const doc of docs.slice(1)) {
    definition.content.push({text: '', pageBreak: 'after', pageSize: doc.pageSize, pageOrientation: doc.pageOrientation}, ...doc.content);
    Object.assign(definition.images, doc.images);
  }
  preprocessData(definition.content);
  const vfs = JSON.parse(await readFile(join(assets, 'fonts/pdfmake-fonts.json'), 'utf8'));
  const font = (name: string) => Buffer.from(vfs[name], 'base64');
  const printer = new PdfPrinter({
    Roboto: locale === 'ja-JP'
      ? {normal: font('ipagp.ttf'), bold: font('ipagp.ttf'), italics: font('ipagp.ttf'), bolditalics: font('ipagp.ttf')}
      : {normal: font('Roboto-Regular.ttf'), bold: font('Roboto-Medium.ttf'), italics: font('Roboto-Italic.ttf'), bolditalics: font('Roboto-MediumItalic.ttf')},
    Hebrew: {normal: font('Open Sans Hebrew.ttf'), bold: font('Open Sans Hebrew Bold.ttf'), italics: font('Open Sans Hebrew Italic.ttf'), bolditalics: font('Open Sans Hebrew Bold Italic.ttf')}
  });
  const temp = await mkdtemp(join(dirname(output), '.nightrep-'));
  try {
    const stream = printer.createPdfKitDocument(JSON.parse(JSON.stringify(definition)));
    const finished = pipeline(stream, createWriteStream(join(temp, 'report.pdf'), {flags: 'wx', mode: 0o600}));
    stream.end();
    await finished;
    if (failure) throw failure;
    requireValue(typeof window === 'undefined' && typeof document === 'undefined', 'Browser globals appeared during generation');
    await checkOutput(output);
    await rename(join(temp, 'report.pdf'), output);
  } finally {
    await rm(temp, {recursive: true, force: true});
  }
  console.log(JSON.stringify({output, entries: data.data.entries.length, days: data.data.days.length, forms: formIds, browserGlobals: false}));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Headless report failed');
  process.exitCode = 1;
});
