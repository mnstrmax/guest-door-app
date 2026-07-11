Nur relevant im **Standalone-Modus** (Docker Compose). Hier zwei Fotos ablegen:

- `door.jpg` – Foto der Wohnungstür, wird nach dem Öffnen der Haustür angezeigt.
- `room.jpg` – Foto des Flurs/Gästezimmers, wird nach dem Öffnen der Wohnungstür angezeigt.

Dieser Ordner ist per `.gitignore` ausgeschlossen (außer dieser README) - die Fotos
landen also nie im Git-Repository, auch nicht in der Historie.

**Im Add-on-Modus** werden die Fotos stattdessen unter `/config/guest-door-app-images/`
erwartet (also im normalen Home-Assistant-Konfigurationsordner, z. B. per "File editor"-
Add-on hochladbar) - ebenfalls nie im Git-Repo.
