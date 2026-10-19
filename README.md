# siamoelvira.com

Versione indipendente del sito di Elvira, ricostruita dal progetto Readymag originale.
È un sito **statico**: solo HTML, CSS, JavaScript e immagini. Non dipende da Readymag
né da altri servizi a pagamento, e può essere ospitato gratis.

## Struttura

```
site/            ← il sito pronto da pubblicare (generato, non modificare a mano)
src/data/        ← contenuti: testi, posizioni, colori di ogni pagina (fonte del sito)
  project.json     pagine, stili di testo e di link
  pages/*.json     elementi di ciascuna pagina, nei tre layout (desktop, tablet, mobile)
  config.json      indirizzo del modulo contatti
  text-fit.json    piccole correzioni di spaziatura per singoli testi
src/assets/      ← CSS, JavaScript, font, immagini ottimizzate
originals/       ← archivio delle immagini originali in alta risoluzione
scripts/         ← build.mjs (genera site/), serve.mjs (anteprima), download-assets.mjs
```

## Comandi

Serve [Node.js](https://nodejs.org) 18 o superiore. Nessuna dipendenza da installare.

```bash
npm run build    # rigenera la cartella site/ a partire da src/
npm run serve    # anteprima su http://localhost:8080
```

## Modificare i contenuti

I testi si trovano in `src/data/pages/<pagina>.json`, nel campo `"text"` dei blocchi
(`"blocks"`). Dopo una modifica eseguire `npm run build`. Per sostituire un'immagine,
mettere il nuovo file in `src/assets/img/` con lo stesso nome di quello da sostituire.

## Pubblicazione gratuita

La cartella `site/` si può pubblicare così com'è su uno di questi servizi gratuiti:

- **GitHub Pages**: pubblicare il contenuto di `site/` (il file `CNAME` per il dominio è già incluso).
- **Netlify** o **Cloudflare Pages**: collegare il repository e impostare la cartella di pubblicazione su `site`
  (comando di build `npm run build`, oppure nessun comando dato che `site/` è già generata).

Poi, dal pannello del registrar del dominio `siamoelvira.com`, puntare i DNS al nuovo servizio
seguendo le sue istruzioni. Conviene disattivare Readymag solo dopo aver verificato che il
nuovo sito risponda correttamente sul dominio.

## Modulo contatti

I moduli inviano i messaggi a **siamoelvira@gmail.com** tramite [FormSubmit](https://formsubmit.co)
(gratuito, senza account). Al **primo invio** FormSubmit manda un'email di conferma a quell'indirizzo:
bisogna cliccare il link di attivazione una sola volta. Per cambiare destinatario modificare
`src/data/config.json` e rieseguire `npm run build`.

## Differenze rispetto all'originale

- **Font**: l'originale usa *Graphik*, un font commerciale con licenza legata a Readymag.
  Qui è usato *Inter* (licenza libera OFL, incluso in `src/assets/fonts/`), con la spaziatura
  calibrata per riprodurre gli stessi a capo. Se in futuro si acquista una licenza web di
  Graphik, basta aggiungere i file in `src/assets/fonts/` e cambiare `--font` in `src/assets/css/site.css`.
- I video restano ospitati su Vimeo e YouTube (account di Elvira); i video YouTube si caricano
  solo quando si preme play.
- Il layout tablet si usa sui dispositivi touch tra 768 e 1023 px di larghezza; sui computer
  si vede sempre il layout desktop, come nell'originale.
