# L3T IPAM auf der Synology einrichten

Komplett im Browser, ohne SSH. Zwei Wege:

- **Variante A — fertiges Image (empfohlen, ab 2.0):** Der Container Manager lädt das
  Image `ghcr.io/l3t-io/ipam` selbst. Kein Code-Upload, Updates per
  «Neu erstellen». Braucht Internetzugang der Synology zur GitHub Container Registry.
- **Variante B — Code einhängen (das ZIP):** Der Container startet das offizielle
  `node:22-alpine` und führt die Anwendung aus dem hochgeladenen Ordner aus. Funktioniert
  ohne Registry. So lief es bis 1.x.

Dauer: rund fünf Minuten.

---

## Variante A — fertiges Image

1. File Station: im gemeinsamen Ordner `docker` den Ordner `l3t-ipam` und darin `data`
   anlegen. (Fehlt `docker`: Systemsteuerung → Gemeinsamer Ordner → Erstellen.)
2. Container Manager → **Projekt** → **Erstellen**, Name `l3t-ipam`, Pfad
   `docker/l3t-ipam`, Quelle **docker-compose.yml erstellen** und den Inhalt von
   [`deploy/synology/docker-compose.yml`](deploy/synology/docker-compose.yml) einfügen.
   Eigene Domain bei `IPAM_DOMAIN` eintragen.
3. **Weiter** → **Fertig**. Dann weiter bei «3. Konto einrichten».

`PUID`/`PGID` bestimmen, wem der Datenordner gehört; `1026`/`100` passt für den ersten
Benutzer einer Synology. Meldet das Protokoll «could not chown», läuft die App trotzdem.

**Von Variante B umsteigen:** Projekt → **Aktion → Bearbeiten**, den Inhalt der
Compose-Datei durch die Image-Variante ersetzen, **Speichern**, **Neu erstellen**. Der
Ordner `data/` bleibt, wie er ist; `app/` kann danach weg.

**Aktualisieren:** Container Manager → **Image** → bei `ghcr.io/l3t-io/ipam` das
angebotene Update holen, danach Projekt → **Aktion → Neu erstellen**. Die Compose-Datei
nutzt den Tag `:2` — so kommen alle 2.x-Versionen, aber kein ungeprüfter Sprung auf 3.0.

---

## Variante B — Code einhängen

## 1. Dateien hochladen (File Station)

1. File Station öffnen. Falls der gemeinsame Ordner `docker` fehlt: Systemsteuerung →
   Gemeinsamer Ordner → Erstellen → Name `docker`.
2. In den Ordner `docker` wechseln.
3. Hochladen → die ZIP auswählen.
4. Rechtsklick auf die hochgeladene ZIP → **Entpacken** → **Hierher entpacken**.

Danach muss die Struktur so aussehen:

```
/volume1/docker/l3t-ipam/
├── app/
│   ├── server.js
│   ├── auth.js
│   └── public/          (inkl. fonts/, logo.svg und login.html)
├── data/
└── docker-compose.yml
```

Die ZIP kannst du danach löschen.

> Falls beim Entpacken ein zusätzlicher Zwischenordner entsteht (`l3t-ipam/l3t-ipam/…`),
> verschiebe den inneren Ordner eine Ebene nach oben. Die Pfade in der Compose-Datei
> gehen von `/volume1/docker/l3t-ipam` aus.

---

## 2. Projekt anlegen (Container Manager)

1. Container Manager öffnen → **Projekt** → **Erstellen**.
2. Projektname: `l3t-ipam`
3. Pfad: **Festlegen** → `docker/l3t-ipam` auswählen.
4. Quelle: **docker-compose.yml verwenden** — die vorhandene Datei wird erkannt und
   im Editor angezeigt.
5. **Weiter** → Web-Portal-Einstellungen überspringen → **Weiter** → **Fertig**.

Container Manager lädt `node:22-alpine` herunter und startet den Container. Beim
ersten Mal dauert das ein bis zwei Minuten.

---

## 3. Konto einrichten

Beim ersten Start gibt es noch kein Konto. Die Anwendung schreibt dafür einen
Einrichtungscode ins Protokoll:

1. Container Manager → **Container** → `l3t-ipam` → **Protokoll**.
2. Dort steht ein Block mit `Einrichtungscode ein Konto anlegen:   ABCD-EFGH-JKLM`.
3. `http://<synology-ip>:8480` öffnen. Es erscheint «Konto einrichten».
4. Code, Benutzername und Passwort (mindestens 12 Zeichen) eingeben → **Konto anlegen**.

Der Code gilt bis zum nächsten Neustart des Containers und wird danach nicht mehr
gebraucht. Ab jetzt erscheint beim Aufruf die Anmeldemaske. Das Passwort liegt nur als
scrypt-Hash in `data/auth.json`.

Passwort ändern und Abmelden: oben rechts auf das Personensymbol.

Weitere Benutzer legst du über das Zahnrad → **Benutzer** an. Es gibt drei Rollen:

| Rolle | Darf |
|---|---|
| Administrator | alles, auch Benutzer, UniFi-Einstellungen und Import |
| Bearbeiten | Netze und Hosts pflegen, den UniFi-Abgleich übernehmen |
| Lesen | alles ansehen, nichts ändern |

Das erste Konto ist Administrator. Ein Rollenwechsel wirkt sofort, ohne neue Anmeldung.
Setzt ein Administrator ein Passwort neu oder löscht ein Konto, ist die Person sofort
auf allen Geräten abgemeldet. Der letzte Administrator lässt sich weder löschen noch
herabstufen.

Ist der Port belegt, im Editor bei `ports` die linke Zahl ändern, etwa `8481:8080`,
und das Projekt neu erstellen.

---

## 4. Optional: eigener Name statt Port

Systemsteuerung → Anmeldeportal → Erweitert → **Reverse Proxy** → Erstellen:

| Feld | Wert |
|---|---|
| Quelle Protokoll | HTTPS |
| Quelle Hostname | `ipam.example.com` |
| Quelle Port | 443 |
| Ziel Protokoll | HTTP |
| Ziel Hostname | `localhost` |
| Ziel Port | 8480 |

Dazu im DNS einen Eintrag auf die Synology zeigen lassen. Wenn davor ohnehin ein
Cloudflare-Tunnel steht, zeigt der einfach auf `http://<synology-ip>:8480`.

**Cloudflare Access ist nicht mehr nötig.** Die Anwendung hat eine eigene Anmeldung.
Die Access-Application für `ipam.example.com` kannst du im Zero-Trust-Dashboard löschen;
der Tunnel selbst bleibt. Die Zeile `IPAM_TRUST_PROXY: "1"` in der Compose-Datei
sorgt dafür, dass hinter Tunnel oder Reverse Proxy die echte Absenderadresse zählt.

---

## Anmeldung — was dahinter steckt

- Sitzungs-Cookie mit `HttpOnly` und `SameSite=Strict`, über HTTPS zusätzlich `Secure`.
  Ohne «Angemeldet bleiben» endet die Sitzung nach 12 Stunden Inaktivität, mit nach 30 Tagen.
- Nach 10 Fehlversuchen innerhalb von 15 Minuten ist die Absenderadresse 15 Minuten
  gesperrt. Bei mehr als 100 Fehlversuchen pro Stunde insgesamt wird die Anmeldung
  für alle gebremst — ein Neustart des Containers hebt das auf.
- Jeder Versuch steht im Protokoll, mit Absenderadresse.
- `IPAM_TRUST_PROXY: "1"` vertraut den Proxy-Headern von überall. Ist der Port 8480 im
  LAN direkt erreichbar, kann dort jemand eine falsche Absenderadresse vortäuschen und die
  Sperre pro Adresse umgehen. Sicherer: nur die Adresse des Proxys eintragen, etwa die
  des Cloudflare-Tunnel-Containers oder `127.0.0.1` für den Reverse Proxy der Synology —
  mehrere mit Komma, auch als Netz (`172.16.0.0/12`).
- Ein Passwortwechsel meldet alle anderen Geräte ab.

**Passwort vergessen?** Ein anderer Administrator setzt es über Zahnrad → Benutzer neu.

Gibt es keinen anderen Administrator, hilft ein vorübergehendes Notfallkonto:

1. Container Manager → Projekt → **Aktion → Bearbeiten**, unter `environment` ergänzen:
   ```yaml
         IPAM_USER: notfall
         IPAM_PASS: ein-langes-einmalpasswort
   ```
2. Projekt neu erstellen, mit `notfall` anmelden und unter Zahnrad → Benutzer das
   eigene Passwort neu setzen.
3. Die beiden Zeilen wieder entfernen und das Projekt neu erstellen.

Alle anderen Benutzer bleiben dabei erhalten. Nur als letzter Ausweg: `data/auth.json`
löschen und neu starten — dann sind **alle** Konten weg, und es erscheint wieder
«Konto einrichten» mit neuem Code im Protokoll. Der IPAM-Bestand bleibt in beiden
Fällen unberührt.

**Konto fest vorgeben** (statt im Browser einrichten): im Editor unter `environment`
`IPAM_USER` und `IPAM_PASS` setzen. Das ergibt einen zusätzlichen Administrator, dessen
Passwort im Klartext in der Compose-Datei steht und sich im Browser nicht ändern lässt —
für den Alltag ist ein Konto aus dem Browser deshalb der bessere Weg.

**Anmeldung abschalten** (etwa wenn doch wieder Cloudflare Access davor steht):
`IPAM_AUTH: "off"`. Das Protokoll warnt dann bei jedem Start.

---

## UniFi anbinden (optional)

In UniFi einen Schlüssel erzeugen: Network öffnen → Einstellungen → Control Plane →
Integrationen → **Create New API Key**. Der Schlüssel wird nur einmal angezeigt.
Das Konto, mit dem du ihn erzeugst, braucht Administratorrechte, und der Schlüssel
erbt genau dessen Berechtigungen.

Danach in der Oberfläche oben rechts auf das **Zahnrad** → Bereich «UniFi-Anbindung»:

1. Controller-Adresse eintragen, etwa `https://10.1.1.1`.
2. API-Schlüssel einfügen, Site meist `default`.
3. **Verbindung testen** — zeigt, wie viele Netze, Geräte und Clients gelesen werden.
4. **Speichern**. Oben erscheint dann der Knopf «UniFi».

Gespeichert wird in `data/unifi.json`, getrennt vom Bestand. Der Schlüssel taucht
deshalb weder im Export («Sichern») noch in der Oberfläche wieder auf — dort steht
nur «gespeichert …abcd». Ein Update oder eine neue Compose-Datei lässt ihn unberührt.

Die **Sicherheitszone** jedes Netzes (zonenbasierte Firewall ab Network 9) wird
automatisch aus UniFi übernommen und ist dann im Netzformular gesperrt — geändert wird
sie in UniFi. Für Netze, die UniFi nicht kennt, lässt sie sich von Hand eintragen.

**Offline-Geräte:** Unter Zahnrad → UniFi → Offline-Geräte stellst du ein, nach wie
vielen Tagen ohne Lebenszeichen ein dokumentierter Host als offline gilt, und ob er dann
automatisch entfernt wird. Vorgabe: nur von Hand, nur DHCP-Einträge, 30 Tage. Geräte, die
sich nur selten melden (Batteriesensoren und ähnliches), im Host als «sporadisch»
markieren — die bleiben immer stehen. Vor jedem Entfernen entsteht eine Tagessicherung.

**Zertifikat:** Beim Speichern merkt sich die App das Zertifikat des Controllers und
prüft es bei jeder Verbindung, bevor der Schlüssel gesendet wird. Meldet der Abgleich
«Zertifikat des Controllers hat sich geändert», und du hast den Controller gerade
aktualisiert: die Anbindung unter Zahnrad → UniFi einfach erneut speichern.

Einen neuen Schlüssel trägst du einfach im selben Feld ein. Wird die Adresse geändert,
muss der Schlüssel neu eingegeben werden — so geht der alte nie an eine andere Adresse.

Wer die Anbindung noch über `IPAM_UNIFI_URL`/`IPAM_UNIFI_KEY` in der Compose-Datei
hat: Das funktioniert weiter, die Oberfläche zeigt es an. Einmal dort speichern, dann
gilt die Oberfläche und die Zeilen in der Compose-Datei können weg.

Wichtig: Die Synology muss den Controller erreichen dürfen. Liegt sie in einem
anderen VLAN, braucht es eine passende Firewall-Regel.

## Daten und Sicherung

Der gesamte Bestand liegt als lesbares JSON in `/volume1/docker/l3t-ipam/data/`:

- `ipam.json` — aktueller Stand, inklusive der Wahl des Erscheinungsbilds
- `auth.json` — Benutzer, Rollen und Passwort-Hashes
- `unifi.json` — UniFi-Adresse und API-Schlüssel
- `ipam-JJJJ-MM-TT.bak.json` — automatische Tagessicherung, die letzten 14 bleiben liegen

Damit erfasst jedes Hyper Backup des `docker`-Ordners auch das IPAM. Zusätzlich lädt
der Knopf „Sichern“ in der Oberfläche denselben Stand als Datei herunter.

---

## Aktualisieren

Neue Dateien in `app/` per File Station ersetzen, dann im Container Manager beim
Projekt auf **Aktion → Neu erstellen** klicken. Der Datenordner bleibt unberührt.
Die laufende Version steht in der Oberfläche oben neben dem Logo.

Seit 1.6 liegen alle Einstellungen, die man selbst einträgt (Konto, UniFi), im
Datenordner. Die Compose-Datei aus dem Paket kann deshalb gefahrlos übernommen werden.

### Von 1.5 auf 1.6

`app/` ersetzen, **Aktion → Neu erstellen**, dann über das Zahnrad die UniFi-Anbindung
eintragen. Die Compose-Datei muss nicht angepasst werden.

### Von 1.4 auf 1.5

1.5 bringt die eigene Anmeldung und ändert deshalb auch die Compose-Datei.

1. Container Manager → Projekt `l3t-ipam` → **Aktion → Stoppen**.
2. File Station: den Ordner `docker/l3t-ipam/app` löschen und den `app`-Ordner aus der
   neuen ZIP an seine Stelle legen. `data/` nicht anfassen.
3. Container Manager → Projekt → **Aktion → Bearbeiten** → im Editor den Inhalt durch
   die `docker-compose.yml` aus der ZIP ersetzen. Einen geänderten Port wieder
   ergänzen. **Speichern**.
4. **Aktion → Neu erstellen**, dann wie unter «3. Konto einrichten» den Code aus dem
   Protokoll holen.

Wichtig ist vor allem der neue Healthcheck auf `/healthz`. Mit der alten Compose-Datei
läuft die Anwendung zwar, der Container wird aber als «fehlerhaft» angezeigt, weil
`/api/state` jetzt eine Anmeldung verlangt.

## Wenn etwas nicht startet

**`unable to evaluate symlinks in Dockerfile path`** — das Projekt versucht, ein Image
zu bauen. Die mitgelieferte Compose-Datei tut das nicht, es wird das fertige
`node:22-alpine` verwendet. Prüfe im Container Manager unter **Aktion → Bearbeiten**,
ob im Editor eine Zeile `build:` steht. Wenn ja, ersetze den Inhalt durch die
`docker-compose.yml` aus dem Paket und erstelle das Projekt neu.



Sonst: Container Manager → Container → `l3t-ipam` → **Protokoll**. Die Anwendung meldet
beim Start eine Zeile mit Version, Port und geladenem Bestand. Bleibt sie aus, stimmt
meist der Pfad nicht: `app/server.js` muss direkt unter dem in der Compose-Datei
angegebenen Ordner liegen.
