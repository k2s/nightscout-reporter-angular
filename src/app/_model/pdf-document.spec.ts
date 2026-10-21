import {firstValueFrom} from 'rxjs';
import {GLOBALS, GlobalsData} from './globals-data';
import {Settings} from './settings';
import {collectPages, preprocessData} from './pdf-document';
import {Utils} from '@/classes/utils';
import type {FormConfig} from '@/forms/form-config';

describe('shared PDF pipeline in the browser', () => {
  beforeAll(() => GlobalsData._globals);

  it('initializes one singleton and preserves browser flags and title', () => {
    expect(GlobalsData._globals).toBe(GLOBALS);
    expect(GlobalsData._globals).toBe(GlobalsData._globals);
    expect(GLOBALS.isDebug).toBe(localStorage.getItem('forceDebug') === 'true');
    expect(GLOBALS.isBeta).toBe(window.location.href.indexOf('/beta/') >= 0);
    expect(GLOBALS.runsLocal).toBe(window.location.href.indexOf('/localhost:') >= 0);
    expect(GLOBALS.appTitle).toBe(document.querySelector('head>title').innerHTML);
  });

  it('retains the browser storage debug switch', () => {
    const previous = localStorage.getItem(Settings.DebugFlag);
    try {
      localStorage.setItem(Settings.DebugFlag, Settings.DebugActive);
      expect(Settings.hastiod).toBeFalse();
      localStorage.removeItem(Settings.DebugFlag);
      expect(Settings.hastiod).toBeTrue();
    } finally {
      if (previous == null) localStorage.removeItem(Settings.DebugFlag);
      else localStorage.setItem(Settings.DebugFlag, previous);
    }
  });

  it('uses Web Crypto for the existing SHA-1 encoding', async () => {
    expect(await Utils.sha1('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  it('uses the same disabled-form gate as PdfService', async () => {
    const form = {getFormPages: jasmine.createSpy('getFormPages')} as any;
    expect(await firstValueFrom(collectPages({form} as FormConfig, 0, null, false))).toBeNull();
    expect(form.getFormPages).not.toHaveBeenCalled();
  });

  it('preprocesses nested Hebrew text while preserving other text', () => {
    const data = [{columns: [{text: 'plain'}, {text: 'שלום עולם'}]}];
    preprocessData(data);
    expect(data[0].columns[0].text).toBe('plain');
    expect((data[0].columns[1] as any).font).toBe('Hebrew');
    expect((data[0].columns[1] as any).stack).toEqual(['עולם  שלום']);
  });
});
