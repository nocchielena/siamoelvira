# Stato dei lavori — siamoelvira.com

Aggiornato: 20 ottobre 2026

## Dove siamo

- **Codice**: github.com/nocchielena/siamoelvira (pubblico), ramo `main`. Tutto il lavoro è già qui.
- **Pubblicazione**: GitHub Pages, automatica a ogni push (workflow "Pubblica il sito").
- **Dominio**: `siamoelvira.com` è già impostato su GitHub Pages, ma i **DNS su Bluehost puntano ancora a Readymag**, quindi il dominio mostra ancora il vecchio sito.
- **Account GitHub su questo Mac** (`gh auth status`): `nocchielena` (attivo) e `elenanocchi-ui`.

## Fatto

- Sito ricostruito come statico (10 pagine, 3 layout: desktop, tablet, telefono), font Inter al posto di Graphik.
- Repository trasferito su `nocchielena`, Pages attivo.
- Correzioni mobile (commit 39b7f6a): footer su tutte le pagine, pulsante "Invia" visibile su sfondo bianco, spazio sotto i moduli, immagine vuota nel menu.

## Da fare, in ordine

1. **DNS su Bluehost** (serve la persona che ha l'accesso). Dominio siamoelvira.com → DNS:
   - cancellare il record A `@` → `54.194.41.141` (Readymag)
   - aggiungere 4 record A `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - record CNAME `www`: da `domains.readymag.com` a `nocchielena.github.io`
   - non toccare MX e TXT (email)
2. Aspettare la propagazione (ore, al massimo un giorno), poi su GitHub → Settings → Pages: quando il controllo DNS è verde, spuntare **Enforce HTTPS**.
3. Controllare siamoelvira.com dal browser, video di sfondo della home compreso (Vimeo blocca i test automatici).
4. Solo dopo, disdire Readymag.

## Miglioramenti possibili (dal design critique)

- Testi alternativi (`alt`) per le immagini, soprattutto i loghi dei partner.
- Icona del menu mobile: aggiungere uno sfondo, ora si sovrappone al contenuto.
- Font: se un giorno si compra la licenza web di Graphik, si cambia in un punto solo (`src/assets/css/site.css`).
- Il modulo contatti usa FormSubmit: al primo invio arriva un'email di conferma da cliccare.

## Comandi utili

```
cd ~/Documents/GitHub/siamoelvira
npm run build    # rigenera site/ da src/
npm run serve    # anteprima su http://localhost:8080
```
