Nur relevant im **Standalone-Modus** (Docker Compose). Hier zwei Fotos ablegen:

- `door.jpg` – Foto der Wohnungstür, wird nach dem Öffnen der Haustür angezeigt.
- `room.jpg` – Foto des Flurs/Gästezimmers, wird nach dem Öffnen der Wohnungstür angezeigt.

Dieser Ordner ist per `.gitignore` ausgeschlossen (außer dieser README) - die Fotos
landen also nie im Git-Repository, auch nicht in der Historie.

**Im Add-on-Modus** werden die Fotos stattdessen im Supervisor-"share"-Ordner erwartet,
unter `share/guest-door-app/door.jpg` bzw. `share/guest-door-app/room.jpg`
(z. B. per Samba-Netzlaufwerk "share" ablegen) - ebenfalls nie im Git-Repo.
