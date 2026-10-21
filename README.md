# Nightscout Reporter

A web app based on Angular to create PDF documents from nightscout data.

It uses the api from cgm-remote-monitor to access the nightscout data and
creates PDFs for handing out to diabetes doctors or coaches.

This is the transfer from Dart to Angular which was neccessary, since Dart is no longer maintained by the creators and the community-version of dart is not good enough with handling the dependencies of the framework. Hopefully Angular support will last longer than that of Dart.

Online version available at: https://nightrep.zreptil.de/  
Compiled project avaialbe at: https://nightrep.zreptil.de/nightscout-reporter_local.zip

## Getting started

Initial steps to compile, deploy, and run nightscout reporter on your own infrastructure.

### Preparation

* Download or git clone the repository
* Download and install node.js from https://nodejs.org
* Install Angular using "npm install -g @angular/cli"

### Build

* Call build.bat from the repository folder in cmd
* Result will be avaialbe in directory .\dist\nightrep

### Deploy

* Get a web server (or online web space)
* Copy content of .\dist\nightrep to the content folder of your web server (or any subfolder)

You can run your own nightscout-reporter instance by calling the URL of your web-server in a browser.

### Headless PDF generation (Node.js or Bun)

Daily graphics (`daygraph`) and statistics (`analysis`) can also be generated without a browser. The CLI uses the same Nightscout loader, forms, page collection and preprocessing as the web app. Other forms are rejected.

Install dependencies with Node.js 22.12 or newer (`npm install`; if npm reports conflicting Angular peer versions, use `npm install --legacy-peer-deps`). Bun 1.4 can run the generated bundle too. Save a job as `job.json`:

```json
{
  "nsUrl": "https://your-nightscout.example",
  "start": "2026-10-18",
  "end": "2026-10-18",
  "units": "mmol/L",
  "locale": "en-GB",
  "forms": ["daygraph", "analysis"],
  "output": "report.pdf"
}
```

Set `NS_TOKEN` in the environment when Nightscout requires authentication. Credentials are accepted only from this variable and sent as a Bearer authorization header; never put them in the job or URL. Public Nightscout servers can omit it.

```sh
npm run headless -- job.json
# Or, with Bun installed:
bun run headless:bun -- job.json

# Build once, then execute directly with either runtime:
npm run build:headless
node dist/headless/cli.mjs job.json
bun dist/headless/cli.mjs job.json
```

Dates are inclusive local calendar dates (`YYYY-MM-DD`), at most 31 days apart. Set `TZ`, for example `TZ=Europe/Bratislava`, to select the calendar timezone. Glucose units must be `mg/dL` or `mmol/L`. Locale codes match the web app (`de-DE`, `en-GB`, `en-US`, `sk-SK`, etc.); default is `de-DE`. Both forms are selected by default. Daily graphics use a fixed glucose preset without extra basal/analysis pages; statistics still use profile basal data. One day with both forms produces two pages.

Run from the source checkout with dependencies installed; the bundle reads images and fonts from `src/assets`. Output paths are relative to the current directory. The output directory must exist and contain no symlinks. Each successful job atomically replaces its output; validation, authentication, download and rendering failures exit nonzero and preserve an existing file. Requests time out after 15 seconds, redirects are rejected, and interactive warnings fail the job. The CLI prints a JSON summary on success.

`npm run test:headless` runs synthetic 288-reading/day fixtures through both Node and Bun and checks PDFs using Poppler's `pdfinfo` and `pdftotext` (install Poppler separately). Tests cover both units, translations, missing DOM globals, validation, authentication, partial data, concurrent writes and output preservation. No patient data or saved credentials are used.

```sh
npm run test:headless
npm test -- --watch=false --browsers=ChromeHeadless
npx ng build
```

For environments where Angular's persistent LMDB cache is unavailable, `CI=true` disables its local cache for builds and tests.

### IIS Hosting

#### Web.config

A web.config file is provided in the root-directory of the deployment.

## Installation with Docker

### Build

* git clone the repository
* Run the docker build command in the root directory of the project. This will create a docker image with the name "nightscout-reporter".

```
docker build . -t nightscout-reporter
```

### Run

* Run the docker image with the following command. This will start a container with the name "nightscout-reporter" and expose the port 8088 to the host.

```
docker run --name some-nginx -d -p 8088:80 nightscout-reporter
```

> you can choose any port you want to expose to the host. Just replace the 8088 with the port you want to use.

## Internationalization

#### (i18n is short for i-nternationalizatio-n - i followed by 18 letters and the letter n)

Every text in nightscout reporter can be translated. For this purpose Angular Internationalization is used: https://angular.io/guide/i18n-overview. The source
language for nightscout reporter is german. I decided this, since this is my mother tongue and creating the program needed focus on the programming and not on
the translation. So the first source of the translation is german. The translation itself takes place in https://crowdin.com/ and is mainly done by the community.
I (zreptil) provide german and english as source for translations. The process of creating the translation follows these steps:

1. Extract all texts from code
2. Upload the created file with german language to crowdin

- Translate all texts from german to the given target languages
- Download the files for the target languages

3. Create the target language file for english as a source language file
4. Upload the created file with english language to crowdin

- Translate all texts from english to the given target languages
- Download the files for the target languages

5. Create the file assets/messages.json for use in the application

As you can see, the process is extensive and has some specialities since I decided to use german as source language. To make this tasks easier and reduce the source
for problems, I created some helper-programs to go through the tasks. The tasks can be executed by going through the package.json and run the commands that start
with "i18n-" and the number in the list above.

This works on a windows installation. I think the scripts have to be changed, when running in another environment. But since I am the only one who can upload the
files to this crowdin projects and do the management of the languages there, I wrote this only to have a documentation of the concept. Everyone is invited to adapt this for his
own purposes, but I cannot provide support for systems I do not run by myself.

## Updates

for updating angular to a newer version use this line in the terminal (windows powershell):

_$v=xxx ; ng update @angular/core@$v @angular/cli@$v @angular/material@$v_

xxx is the version number to update to.
