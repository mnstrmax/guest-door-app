# Guest Door App – Home Assistant Add-on Repository

Dieses Repo ist ein Home-Assistant-**Add-on-Repository**. Es enthält aktuell ein
Add-on: [`guest-door-app`](./guest-door-app) – die PIN-geschützte WebApp für
Airbnb-Gäste (Ring Intercom + Nuki).

## 1. Auf GitHub veröffentlichen

Im Studio-Code-Server-Terminal (oder lokal, falls du diesen Ordner heruntergeladen hast):

```bash
cd guest-door-app-repo   # dieser Ordner
git init
git add .
git commit -m "Initial commit: guest-door-app add-on"
git branch -M main
git remote add origin https://github.com/<dein-github-name>/<dein-repo-name>.git
git push -u origin main
```

Voraussetzung: ein leeres GitHub-Repository (öffentlich oder privat – beides
funktioniert als HA-Add-on-Repository) unter `<dein-github-name>/<dein-repo-name>`.
Falls es noch nicht existiert, vorher auf github.com/new anlegen.

Anschließend in `repository.yaml` das Feld `url` auf die echte Repo-URL anpassen,
committen und pushen (rein informativ, wird von HA nicht zwingend gebraucht, aber
schadet nicht).

## 2. In Home Assistant einbinden

1. **Einstellungen → Add-ons → Add-on Store**.
2. Oben rechts **⋮ → Repositories**.
3. Deine GitHub-URL eintragen: `https://github.com/<dein-github-name>/<dein-repo-name>`
   → **Hinzufügen**.
4. Store neu laden (Seite aktualisieren) – **"Guest Door App"** erscheint jetzt als
   eigener Abschnitt in der Add-on-Liste.
5. Öffnen → **Installieren**.

## 3. Konfigurieren & starten

Siehe [`guest-door-app/README.md`](./guest-door-app/README.md), Abschnitt
"Option B: Als lokales Home Assistant Add-on" – ab Schritt 4 (Konfigurations-Tab
ausfüllen, kein Token nötig, Supervisor stellt automatisch Zugriff bereit).

## Updates

Wenn du den Code änderst: `version` in `guest-door-app/config.yaml` erhöhen,
committen, pushen. Home Assistant erkennt die neue Version im Add-on Store und
zeigt einen "Update"-Button an.
