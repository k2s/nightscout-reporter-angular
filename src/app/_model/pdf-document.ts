import type {PageData} from '@/_model/page-data';
import type {FormConfig} from '@/forms/form-config';
import type {ReportData} from '@/_model/report-data';
import type {TCreatedPdf} from 'pdfmake/build/pdfmake';
import {GLOBALS} from '@/_model/globals-data';
import {Utils} from '@/classes/utils';
import {map, Observable, of} from 'rxjs';

export interface PdfImages {
  collectBase64Images(list: string[]): Observable<any>;
}

export function collectPages(cfg: FormConfig, idx: number, repData: ReportData, enabled: boolean, createThumbs?: (pdf: TCreatedPdf) => void): Observable<{ idx: number, docList: any[] }> {
  let doc: any;
  const docList: any[] = [];

  const form = cfg.form;
  let prevPage: PageData;
  if (enabled || createThumbs != null) {
    const docLen = JSON.stringify(doc ?? {}).length;
    const gmiSave = GLOBALS.glucMGDLIdx;
    if (createThumbs != null) {
      GLOBALS.glucMGDLIdx = 0;
    }
    return form.getFormPages(repData, docLen).pipe(map((formPages: PageData[]) => {
      GLOBALS.glucMGDLIdx = gmiSave;
      const fileList: PageData[][] = [[]];
      for (const page of formPages) {
        const entry = page.content[page.content.length - 1];
        if (entry.pageBreak === 'newFile' && !Utils.isEmpty(fileList[fileList.length - 1])) {
          delete (entry.pageBreak);
          fileList[fileList.length - 1].push(page);
          fileList.push([]);
        } else {
          if (entry.pageBreak === 'newFile') {
            delete (entry.pageBreak);
          } //entry["pageBreak"] = "after";
          fileList[fileList.length - 1].push(page);
        }
      }

      if (createThumbs != null && fileList.length > 1) {
        fileList.splice(1, fileList.length - 1);
        if (fileList[0].length > 1) {
          fileList[0].splice(1, fileList[0].length - 1);
        }
      }

      for (const pageList of fileList) {
        const content: any[] = [];
        for (const page of pageList) {
          if (prevPage != null) {
            const pagebreak: any = {text: '', pageBreak: 'after'};
            if (page.isPortrait != prevPage.isPortrait) {
              pagebreak.pageSize = 'a4';
              pagebreak.pageOrientation = page.isPortrait ? 'portrait' : 'landscape';
            }
            content.push(pagebreak);
          }
          content.push(page.asElement);
          prevPage = page;
        }
        if (doc == null) {
          doc = {
            pageSize: 'a4',
            pageOrientation: Utils.isEmpty(pageList) || pageList[0].isPortrait ? 'portrait' : 'landscape',
            pageMargins: [form.cm(0), form.cm(1.0), form.cm(0), form.cm(0.0)],
            content: content,
            images: form.images,
            styles: {
              infoline: {
                margin: [form.cm(0), form.cm(0.25), form.cm(0), form.cm(0.25)]
              },
              perstitle: {alignment: 'right'},
              persdata: {color: '#0000ff'},
              infotitle: {alignment: 'left'},
              infodata: {alignment: 'right', color: '#0000ff'},
              infounit: {
                margin: [form.cm(0), form.cm(0), form.cm(0), form.cm(0)],
                color: '#0000ff'
              },
              hba1c: {color: '#5050ff'},
              total: {bold: true, fillColor: '#d0d0d0', margin: form.m0},
              timeDay: {bold: true, fillColor: '#d0d0d0', margin: form.m0},
              timeNight: {bold: true, fillColor: '#303030', color: 'white', margin: form.m0},
              timeLate: {bold: true, fillColor: '#a0a0a0', margin: form.m0},
              row: {}
            }
          };
        } else {
          doc.content.push(content);
          for (const key of Object.keys(form.images)) {
            doc.images[key] = form.images[key];
          }
        }

        if (pageList != fileList[fileList.length - 1]) {
          docList.push(doc);
          doc = null;
          prevPage = null;
        }
      }
      if (doc != null) {
        docList.push(doc);
      }

      return {idx: idx, docList: docList};
    }));
  }
  return of(null);
  //        if (g.isLocal && data != fileList.last)doc = null;
  //        prevForm = form;
}

/**
 * Preprocesses the pdf-data before creating it with pdfmake.
 * Every text-node is checked for special format-information
 * and processed accordingly.
 * @param data data to process
 */
export function preprocessData(data: any) {
  if (typeof data === 'object' && data != null) {
    for (const key of Object.keys(data)) {
      if (key === 'text' && !Array.isArray(data[key])) {
        const text = data[key];
        let isHebrew = false;
        for (let i = 0; i < text?.length; i++) {
          const code = text.charCodeAt(i);
          if (code >= 1425 && code <= 1524) {
            isHebrew = true;
          }
        }
        if (isHebrew) {
          data.font = 'Hebrew';
          const text = Utils.join(data.text.split(' ').reverse(), '  ');
          data.text = undefined;
          data.stack = text.split(',').reverse();
        }
      } else {
        preprocessData(data[key]);
      }
    }
  } else if (Array.isArray(data)) {
    for (const subdata of data) {
      preprocessData(subdata);
    }
    return;
  }
}
