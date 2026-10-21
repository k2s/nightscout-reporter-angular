import {enableProdMode} from '@angular/core';
import {platformBrowserDynamic} from '@angular/platform-browser-dynamic';

import {AppModule} from '@/app.module';
import {environment} from '@environments/environment';
import {GlobalsData} from '@/_model/globals-data';

// Initialize after module evaluation, before Angular creates services and components.
GlobalsData._globals;

if (environment.isProduction) {
  enableProdMode();
}

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.error(err));
