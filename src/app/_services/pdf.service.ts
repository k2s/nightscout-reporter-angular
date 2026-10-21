import {DOCUMENT, Inject, Injectable, Renderer2, RendererFactory2} from '@angular/core';
import {HttpClient, HttpRequest} from '@angular/common/http';
import {collectPages, preprocessData} from '@/_model/pdf-document';
import {Log} from '@/_services/log.service';
import {GLOBALS} from '@/_model/globals-data';
import {ProgressService} from '@/_services/progress.service';
import {ReportData} from '@/_model/report-data';
import {FormConfig} from '@/forms/form-config';
import {Utils} from '@/classes/utils';
import {forkJoin, map, Observable, of} from 'rxjs';
import {NightscoutService} from '@/_services/nightscout.service';
import {DataService} from './data.service';
import {TCreatedPdf} from 'pdfmake/build/pdfmake';
import {PrintCGP} from '@/forms/nightscout/print-cgp';
import {PrintDailyAnalysis} from '@/forms/nightscout/print-daily-analysis';
import {PrintPercentile} from '@/forms/nightscout/print-percentile';
import {catchError} from 'rxjs/operators';

export class PdfData {
  isPrinted = false;

  constructor(public pdf: any) {
  }
}

@Injectable({
  providedIn: 'root'
})
export class PdfService {

  pdfMake: any;
  pdfList: PdfData[] = [];
  pdfDoc: any = null;
  images: any;
  private renderer: Renderer2;

  constructor(public http: HttpClient,
              public ps: ProgressService,
              public ns: NightscoutService,
              public ds: DataService,
              rendererFactory: RendererFactory2,
              @Inject(DOCUMENT) private document: Document) {
    this.renderer = rendererFactory.createRenderer(null, null);
  }

  get msgCreatingPDF(): string {
    return $localize`:text when pdf is being created:Erzeuge PDF...`;
  }

  get msgPreparingPDF(): string {
    return $localize`Lade die Basisdaten...`;
  }

  get msgLoadingDataError(): string {
    return $localize`Fehler beim Laden der Daten`;
  }

  get msgShowPDF(): string {
    return $localize`PDF anzeigen`;
  }

  msgLoadingData(error: string, stacktrace: string): string {
    return $localize`Fehler beim Laden der Daten:\n${error}\n${stacktrace}`;
  }

  async loadPdfMaker() {
    if (this.pdfMake == null) {
      const pdfMakeModule: any = await import('pdfmake/build/pdfmake');
      const pdfFontsModule: any = await import('pdfmake/build/vfs_fonts');
      this.pdfMake = pdfMakeModule.default;
      this.pdfMake.vfs = pdfFontsModule.default;
    }
  }

  async generatePdf(doSave = true, createThumbs?: (pdf: TCreatedPdf) => void) {
    if (doSave) {
      this.ds.save({skipReload: createThumbs != null});
    }
    this.pdfList = [];
    this.ps.max = 1;
    this.ps.value = 0;
    this.ps.text = this.msgPreparingPDF;
    const repData = await this.ns.loadData(createThumbs != null);
    Log.showTimer('loadData done');
    if (!repData?.isValid) {
      console.error('repData ist nicht gültig', repData);
      this.ps.text = null;
      return;
    }
    GLOBALS.isCreatingPDF = true;
    try {
      this.ps.max = 1;
      this.ps.value = 0;
      this.ps.text = this.msgCreatingPDF;
      if (repData.error != null) {
        if (GLOBALS.isDebug) {
          Log.error(this.msgLoadingData(repData.error.toString(), repData.error.stack.toString()));
        } else {
          Log.error(this.msgLoadingDataError);
        }
        GLOBALS.isCreatingPDF = false;
        this.ps.text = null;
        return;
      }
      // let docLen = 0;
      // let prevPage: PageData = null;
      let listConfig: FormConfig[] = [];
      if (createThumbs != null) {
        for (let cfg of GLOBALS.listConfigOrg) {
          listConfig.push(cfg);
          switch (cfg.dataId) {
            case 'cgp': {
              const cfg1 = new FormConfig(new PrintCGP(this), false);
              cfg1.form.params[0].thumbValue = 1;
              listConfig.push(cfg1);
              break;
            }
            case 'dayanalysis': {
              const cfg1 = new FormConfig(new PrintDailyAnalysis(this), false);
              cfg1.form.params[2].thumbValue = 1;
              listConfig.push(cfg1);
              break;
            }
            case 'percentile': {
              const cfg1 = new FormConfig(new PrintPercentile(this), false);
              cfg1.form.params[0].thumbValue = 0;
              cfg1.form.params[2].thumbValue = true;
              listConfig.push(cfg1);
              break;
            }
          }
        }
      } else {
        listConfig = GLOBALS.listConfig;
      }
      const cfgList: Observable<any>[] = [];
      let idx = 0;
      for (const cfg of listConfig) {
        cfgList.push(this.collectPages(cfg, idx++, repData, createThumbs));
      }
      forkJoin(cfgList).subscribe({
        next: (dataList: { idx: number, docList: any[] }[]) => {
          // pdfMake.Styles styles = pdfMake.Styles();
          // pdfMake.PDFContent pdf = pdfMake.PDFContent(content: [doc], styles: styles);
          // pdfMake.create(pdf).open();
          // .getDataUrl(function(outDoc)
          // {
          // $("#output").text(outDoc);
          // });
          dataList = dataList.filter(entry => entry != null);
          dataList.sort((a, b) => Utils.compare(a.idx, b.idx));
          const docList: any[] = []
          for (const data of dataList) {
            Utils.pushAll(docList, data.docList);
          }
          if (docList.length > 1) {
            const pdfData: any = docList[0];
            for (let i = 1; i < docList.length; i++) {
              /*
                            const content = [{
                              text: '',
                              pageBreak: 'after',
                              pageSize: 'a4',
                              pageOrientation: listConfig[i]?.form.isPortrait ? 'portrait' : 'landscape',
                              images: docList[i].images
                            }, docList[i].content];
              */
              docList[i].content.splice(0, 0, {
                text: '',
                pageBreak: 'after',
                pageSize: docList[i].pageSize,
                pageOrientation: docList[i].pageOrientation,
              });
              for (const key of Object.keys(docList[i].images)) {
                pdfData.images[key] = docList[i].images[key];
              }
              pdfData.content.push(docList[i].content);
            }
            this.makePdf(pdfData, createThumbs);
            return;
            // this.pdfList = [];
            // let pdfDoc: any = null;
            //
            // // for (const doc of docList) {
            // //   const dst = jsonEncode(doc);
            // //   if (GLOBALS.isDebug) {
            // //     // pdfUrl = 'http://pdf.zreptil.de/playground.php';
            // //     dst = dst.replaceAll('],', '],\n');
            // //     dst = dst.replaceAll(',\"', ',\n\"');
            // //     dst = dst.replaceAll(':[', ':\n[');
            // //   } else {
            // //     // pdfUrl = 'https://nightscout-reporter.zreptil.de/pdfmake/pdfmake.php';
            // //   }
            // //   pdfList.add(PdfData(pdfString(dst)));
            // // }
            // for (const doc of docList) {
            //   this.pdfList.push(new PdfData(doc));
            // }
            // this.ps.progressText = null;
            // this._generatePdf(docList);
            // return;
          } else {
            this.pdfDoc = docList[0];
          }
          this.makePdf(this.pdfDoc, createThumbs);
        }, error: (error) => {
          GLOBALS.isCreatingPDF = false;
          Log.devError(error, 'Fehler im PdfService');
        }, complete: () => {
          GLOBALS.isCreatingPDF = false;
        }
      });
      // if (!g.isDebug) {
      //   if (g.msg.text.isEmpty) {
      //     if (isForThumbs) {
      //       navigate('makePdfImages');
      //     } else {
      //       navigate('showPdf');
      //     }
      //   } else {
      //     displayLink(msgShowPDF, 'showPdf', btnClass: 'action', icon: 'description');
      //   }
      // } else {
      //   displayLink('playground', 'showPlayground', btnClass: 'action', icon: 'description');
      //   displayLink('pdf', 'showPdf', btnClass: 'action', icon: 'description');
      // }
      // sendIcon = 'send';
      // progressText = null;
    } catch (ex) {
      GLOBALS.isCreatingPDF = false;
      Log.devError(ex, 'Fehler im PdfService');
    } finally {
      this.ps.text = null;
    }
    /*
        }).catchError((error) {
          g.info.addDevError(error, msgPDFCreationError);
          sendIcon = 'send';
          progressText = null;
          return -1;
        });
    */
  }

  collectBase64Images(list: string[], images = {}): Observable<any> {
    this.images = images;
    const listObservables: Observable<any>[] = [];
    for (const id of list) {
      listObservables.push(this.collectBase64Image(id));
    }
    return forkJoin(listObservables);
  }

  showPdf(data: any) {
    this._generatePdf(data);
  }

  private collectPages(cfg: FormConfig, idx: number, repData: ReportData, createThumbs?: (pdf: TCreatedPdf) => void) {
    return collectPages(cfg, idx, repData, this.ns.checkCfg(cfg), createThumbs);
  }

  private makePdf(data: any, createThumbs?: (pdf: TCreatedPdf) => void) {
    preprocessData(data.content);
    if (GLOBALS.isDebug) {
      Log.displayLink(this.msgShowPDF, `showPdf`, {btnClass: 'action', icon: 'description', data: data});
      Log.displayLink('Playground', `showPlayground`, {btnClass: 'action', icon: 'description', data: data});
      this.ps.clear();
      Log.stopTimer('pdf generated');
      return;
    }
    this._generatePdf(data, createThumbs).then(_ => {
      this.ps.clear();
      Log.stopTimer('pdf generated');
    });
  }

  private async _generatePdf(data: any, createThumbs?: (pdf: TCreatedPdf) => void) {
    if (data == null) {
      Log.error('Es sind keine Seiten vorhanden');
      return;
    }
    await this.loadPdfMaker();
    this.http.get('assets/fonts/pdfmake-fonts.json').subscribe(vfs => {
      let fonts: any = {
        Roboto: {
          normal: 'Roboto-Regular.ttf',
          bold: 'Roboto-Medium.ttf',
          italics: 'Roboto-Italic.ttf',
          bolditalics: 'Roboto-MediumItalic.ttf'
        },
        /**
         * Emoji font from google fonts
         * url for download:
         * https://fonts.google.com/noto/specimen/Noto+Emoji
         * ttf must be copied to assets/fonts/ttf
         * then convert with pdfmake-font-generator to assets/fonts/created.js
         * and copied from there to pdfmake-fonts.json
         */
        NotoEmoji: {
          normal: 'NotoEmoji-Regular.ttf',
          bold: 'NotoEmoji-Regular.ttf',
          italics: 'NotoEmoji-Regular.ttf',
          bolditalics: 'NotoEmoji-Regular.ttf'
        }
      };

      if (GLOBALS.language.code === 'ja-JP') {
        fonts['Roboto'] = {
          normal: 'ipagp.ttf',
          bold: 'ipagp.ttf',
          italics: 'ipagp.ttf',
          bolditalics: 'ipagp.ttf'
        };
      } else {
        fonts['Hebrew'] = {
          normal: 'Open Sans Hebrew.ttf',
          bold: 'Open Sans Hebrew Bold.ttf',
          italics: 'Open Sans Hebrew Italic.ttf',
          bolditalics: 'Open Sans Hebrew Bold Italic.ttf'
        };
      }
      const pdf: TCreatedPdf = this.pdfMake.createPdf(JSON.parse(JSON.stringify(data)), null, fonts, vfs);
      if (createThumbs != null) {
        createThumbs(pdf);
        // pdf.getBase64(base64 => {
        //   localStorage.setItem(`thumbs.${GLOBALS.language.code}`, base64);
        // });
      } else if (GLOBALS.ppPdfSameWindow) {
        pdf.getDataUrl((base64URL) => {
          const body = this.document.body;
          const root = this.document.querySelector('app-root');
          if (root != null) {
            this.renderer.removeChild(body, root);
          }
          const iframe = this.renderer.createElement('iframe');
          this.renderer.setAttribute(iframe, 'src', base64URL);
          this.renderer.setAttribute(iframe, 'style', 'border:0;top:0;left:0;bottom:0;right:0;width:100%;height:100%;');
          this.renderer.setAttribute(iframe, 'allowfullscreen', '');
          this.renderer.appendChild(this.document.body, iframe);
        });
      } else if (GLOBALS.ppPdfDownload) {
        pdf.download();
      } else {
        try {
          pdf.open();
        } catch (ex) {
          Log.error($localize`Das PDF konnte nicht angezeigt werden. Ist ein Popup-Blocker aktiv?`);
          pdf.download();
        }
      }
    });
  }

  /**
   * Collects a Base64 encoded image URL for the given identifier.
   *
   * @param {string} id - The identifier for the image, which may include custom data in the format '@id@urlFormat'.
   * @return {Observable<{ id: string, url: string }>} An observable emitting an object containing the image `id` and its Base64 encoded `url`. If an error occurs, the `url` will be an empty string.
   */
  private collectBase64Image(id: string): Observable<{ id: string, url: string }> {
    let urlFormat = `assets/img/${id}.png`;
    let imgFormat = 'image/png';
    if (id.startsWith('@')) {
      const parts = id.split('@');
      id = parts[1];
      urlFormat = parts[2];
    }
    const req = new HttpRequest('GET', urlFormat,
      null,
      {responseType: 'arraybuffer'});
    return this.http.request(req)
      .pipe(map(data => {
        if ((data as any)?.body != null) {
          if (urlFormat.startsWith(GLOBALS.urlEmojiImage)) {
            GLOBALS.emojiRetries = GLOBALS.emojiMaxRetries;
          }
          return {id: id, url: `data:${imgFormat};base64,${btoa(String.fromCharCode(...new Uint8Array((data as any).body)))}`};
        }
        return {id: id, url: null};
      }), catchError(_err => {
        if (urlFormat.startsWith(GLOBALS.urlEmojiImage)) {
          GLOBALS.emojiRetries--;
        }
        return of({id: id, url: ''});
      }));
  }
}
