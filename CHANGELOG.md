# Changelog

Die Version steht in `server.js` (`APP_VERSION`), wird über `/api/state` ausgeliefert
und ist in der Oberfläche oben neben der Wortmarke sichtbar.

## 2.1.2 — 16.10.2026

### Security

- **Certificate pinning for a UniFi connection from the Compose file.** A connection set
  only via `IPAM_UNIFI_URL`/`IPAM_UNIFI_KEY` (not saved in the web UI) skipped the
  certificate check: the key went to whatever certificate the address presented. It is
  now pinned on first contact (in memory, per container start), and a different
  certificate aborts the connection before the key is sent. In general the key is now
  never sent without a known certificate when the CA check is off — except in the
  connection test for a new address, which is where the pin comes from. Connections
  saved in the web UI were already pinned (2.0.0).
- The setup code is drawn without modulo bias (`crypto.randomInt`). Previously a few
  characters were very slightly more likely; not practically exploitable, found by
  CodeQL.

## 2.1.1 — 16.10.2026

### Fixed

- After an update, a cache in front of the app (e.g. Cloudflare) could still serve the old
  stylesheet: the colour swatches in zone management stayed empty. Stylesheet and scripts
  are now linked with the version (`style.css?v=2.1.1`), so every release loads fresh files.

## 2.1.0 — 16.10.2026 · Zone management

### New

- **Security zones are now records of their own**, with a name, a colour and an optional
  description. Manage them under «Security zones» in the sidebar or via «Manage» in the
  overview: create, rename (networks follow), recolour, delete (networks lose the zone and
  show their own colour again).
- **Colour choice per zone**: the seven validated palette colours or any custom colour;
  text on custom colours switches between dark and light for contrast.
- **Zones from UniFi are created automatically** during sync if they don't exist yet.
  Their name is owned by UniFi and locked here; colour and description stay editable. A
  manual zone with the same name becomes the UniFi zone and keeps its colour. A zone that
  disappears from the controller stays as a manual zone. The system zones «External» and
  «Gateway» are only created when a network uses them.
- Giving a network a zone name that doesn't exist yet creates the zone.
- The overview shows every zone, including those without networks, with its description.

### Changed

- The network colour only applies to networks without a zone and is hidden in the network
  form as soon as a zone is set.
- Data from earlier versions is migrated on start: every zone name in use becomes a zone,
  well-known names (DMZ, Hotspot, Internal, Management, Multimedia, Server, VPN) with
  their established colour. Export and import include zones.
- License notice for the bundled IBM Plex Mono font (SIL Open Font License) in
  `app/public/fonts/LICENSE.txt`.

## 2.0.1 — 15.10.2026

### Changed

- «Usage by type» in the overview shows an icon for every type, in the same shapes as the
  address grid: static as a full square, reserved with a cut corner, DHCP in the slate
  colour of DHCP leases.

## 2.0.0 — 15.10.2026 · Open source

L3T IPAM is now open source under the MIT license. From this version on, the changelog is
written in English; earlier entries are in German.

### New

- **English user interface** next to German, with a language switch in the top bar and on
  the sign-in page (stored per device; default follows the browser). Server messages are
  translated as well.
- **Container log in English or German** via `IPAM_LANG` (default `en`).
- **Docker image** `ghcr.io/l3t-io/ipam` for `linux/amd64` and `linux/arm64`
  (Raspberry Pi), built on every version tag. The container prepares the data folder and
  drops root privileges to `PUID`/`PGID`.
- **Compose templates** for any Docker host (`docker-compose.yml`) and for Synology
  (`deploy/synology/`). The previous «mounted code» variant stays available under
  `deploy/synology-mount/` and is still what the Synology ZIP contains.
- **Certificate pinning for the UniFi controller.** With CA verification off (the default,
  since controllers use self-signed certificates), the controller certificate is pinned
  when the connection is saved. Every connection is checked against it before the API key
  or password is sent; a changed certificate stops the sync with a clear message, and
  saving again accepts it.
- English README with screenshots, German `README.de.md`.

### Changed

- Default domain is `home.arpa` (RFC 8375) instead of `l3t.io`. Existing installations
  that set `IPAM_DOMAIN` are unaffected.
- On narrow screens the search field gets its own row in the top bar.
- `IPAM_TRUST_PROXY` also accepts a list of trusted proxy addresses or networks (since
  1.14.4).

### Upgrading from 1.x

Nothing to migrate: data, accounts, sessions and the UniFi connection are kept. Set
`IPAM_DOMAIN` if you relied on the old default, and `IPAM_LANG: de` for a German log.
To switch a Synology to the ready-made image, see SYNOLOGY.md («Variant A»).

### Tests

- 121 tests, among them translation coverage (every UI string has an English entry with
  the same placeholders), the English log, certificate pinning with a live certificate
  swap, and the Docker templates.

## 1.14.4 — 15.10.2026 · Sicherheits-Update

Ergebnis einer unabhängigen Sicherheitsprüfung. **Bitte zeitnah einspielen.**

### Hoch

- **Rechteprüfung liess sich mit einem Schrägstrich umgehen.** Pfade wie
  `/api/import/` oder `/api//unifi/config` landeten beim selben Endpunkt, wurden aber
  nicht als «nur für Administratoren» erkannt. Ein Konto mit der Rolle «Bearbeiten»
  konnte so den Bestand ersetzen, die UniFi-Anbindung umstellen und das automatische
  Offline-Aufräumen einschalten; «Lesen» konnte die UniFi-Einstellungen sehen. Jetzt
  werden nur kanonische API-Pfade angenommen, alles andere ist unbekannt (404).
- **Rechteausweitung über präparierte IDs.** Beim Import wurden IDs ungeprüft übernommen.
  Eine Host-ID wie `../users/<id>` liess den Browser beim Speichern eines Hosts einen
  ganz anderen Endpunkt aufrufen — ein Administrator konnte so unbemerkt die Rolle eines
  anderen Kontos ändern oder Konten löschen. IDs bestehen jetzt nur aus Buchstaben,
  Ziffern und Bindestrich; andere werden beim Import neu vergeben (samt der Bezüge der
  Hosts auf ihr Netz), doppelte werden eindeutig gemacht. Die Oberfläche kodiert IDs
  zusätzlich in jeder Adresse.

### Mittel

- **UniFi-Konto aus der Umgebung ging an eine geänderte Controller-Adresse.**
  `IPAM_UNIFI_USER`/`IPAM_UNIFI_PASS` werden nur noch für den Controller verwendet,
  für den sie in der Umgebung stehen.
- **Globale Anmeldesperre liess sich als Angriff nutzen.** Nach 100 Fehlversuchen pro
  Stunde war die Anmeldung für alle gesperrt — auch mit richtigem Passwort. Jetzt wird
  dann nur gebremst, ebenso bei vielen Fehlversuchen für denselben Benutzernamen. Die
  Sperre pro Absender bleibt.
- **Gefälschte Proxy-Header.** `IPAM_TRUST_PROXY` nimmt jetzt auch eine Liste
  vertrauter Proxys an, etwa `IPAM_TRUST_PROXY: "172.17.0.1"` oder `"10.0.0.0/8"`. Dann
  zählen `CF-Connecting-IP` und `X-Forwarded-*` nur von dort. `"1"` vertraut wie bisher
  allen und ist nur sinnvoll, wenn der Port nicht direkt erreichbar ist.

### Niedrig

- Antworten des Controllers sind auf 20 MB begrenzt, Anfragen dorthin haben eine
  Obergrenze für die Gesamtdauer; Zonennamen werden auf 40 Zeichen gekürzt.
- «Neu abfragen» im UniFi-Abgleich höchstens alle fünf Sekunden.
- Höchstens 20 Sitzungen je Konto — ein Konto kann nicht mehr die Sitzungen aller anderen
  verdrängen.
- Netzfarben nur noch aus der bekannten Liste (vorher liess sich CSS einschleusen).
- Gewöhnliche Anfragen sind auf 64 KB begrenzt und werden bei Überschreitung mit
  «413 zu gross» beantwortet; nur der Import darf 8 MB gross sein. Der Import prüft
  Netze schneller.
- Benutzernamen werden vor dem Protokollieren von Steuerzeichen befreit.
- Zwei gleichzeitige Ersteinrichtungen legen nicht mehr beide ein Konto an.
- `ipam.json` und die Tagessicherungen werden nur für den Eigentümer lesbar gespeichert.
- Über HTTPS sendet der Server jetzt HSTS.

### Bekannt, noch offen

- Die Zertifikatsprüfung zum UniFi-Controller ist standardmässig aus, weil Controller
  ab Werk selbst signierte Zertifikate haben. Ein Angreifer im selben Netzsegment könnte
  den API-Schlüssel mitlesen. Geplant: Zertifikat beim ersten Verbinden merken und danach
  prüfen.

### Tests

- `tests/security.test.js` stellt jeden Befund nach (12 Prüfungen).

## 1.14.3 — 15.10.2026

### Oberfläche

- Reservierte Adressen im Raster sind jetzt mit einer abgeschnittenen Ecke oben rechts
  markiert statt mit einem Punkt in der Mitte. Die Zelle bleibt eine ruhige Fläche in
  der Netzfarbe; der Punkt war zu auffällig. Legende und Übersicht entsprechend.

## 1.14.2 — 15.10.2026

### Behoben

- **Typen hatten in Raster und Übersicht verschiedene Farben.** Im Raster waren
  Reservierungen braun, in der Übersicht grün — und Grün und Blau stehen seit 1.14.0
  auch für die Zonen Internal und Management. Farbe bedeutet jetzt überall «Netz» bzw.
  «Zone», der Typ wird anders gezeigt:
  - **Raster:** statisch und reserviert in der Netzfarbe, reserviert zusätzlich mit
    einem Punkt in der Mitte (seit 1.14.3 eine Ecke). DHCP-Leases bleiben im Schieferton des DHCP-Bereichs.
    Der Tooltip jeder Zelle nennt den Typ.
  - **Übersicht:** «Belegung nach Typ» als drei Zahlen mit Anteil und kurzer
    Erklärung statt als bunter Balken. Der Belegungsbalken je Netz in der Netztabelle
    hat die Farbe des Netzes; die Aufteilung nach Typ steht beim Darüberfahren.

## 1.14.1 — 15.10.2026

### Behoben

- **Reservierungen kamen als «statisch» an.** Eine feste Reservierung aus UniFi wurde
  beim Übernehmen mit dem Typ «statisch» angelegt statt «reserviert». Das ist falsch:
  «statisch» heisst, die Adresse ist am Gerät selbst eingestellt; «reserviert» heisst,
  der DHCP-Server vergibt sie fest. Neue Reservierungen kommen jetzt als «reserviert».
- **Bestehende Hosts mit falschem Typ** meldet der Abgleich jetzt unter «Hosts mit
  Abweichung» als «Typ: statisch → reserviert» (oder «dhcp → reserviert») — aber nur,
  wenn die Reservierung im Controller zu genau diesem Gerät gehört. So lässt sich der
  Bestand in einem Durchgang korrigieren.

## 1.14.0 — 15.10.2026

### Feste Farben je Sicherheitszone

- Netze in diesen Zonen bekommen ihre Farbe von der Zone, in der Seitenleiste, im
  Raster, in der Netztabelle und als Streifen an den Zonenkacheln der Übersicht:

  | Zone | Farbe |
  |---|---|
  | DMZ | Rot — exponiert |
  | Hotspot | Bernstein — Achtung, aber nur Gäste |
  | Internal | Grün |
  | Management | Blau |
  | Multimedia | Violett |
  | Server | Rosa |
  | VPN | Grau |

- Rot statt Orange für die DMZ, weil Kupfer bereits Akzentfarbe der App ist und Gold
  im Raster das Gateway markiert.
- Die Werte sind darauf geprüft, dass sich alle Paare bei normalem Sehen klar
  unterscheiden, im hellen wie im dunklen Erscheinungsbild (dort mit eigenen
  Abstufungen). Bei Rot-Grün-Schwäche lassen sich DMZ und Internal nicht über die Farbe
  trennen — die Zone steht deshalb überall auch als Text.
- Auf Bernstein und Rosa ist die VLAN-Kennung dunkel statt weiss geschrieben.
- Im Netzformular ist die Farbwahl gesperrt, solange die Zone eine feste Farbe hat;
  das gilt auch sofort beim Eintippen einer Zone. Andere Zonen (External, Gateway,
  eigene) behalten die frei gewählte Netzfarbe. Die Schreibweise der Zone spielt keine
  Rolle, «MGMT» und «Media» werden ebenfalls erkannt.

## 1.13.0 — 15.10.2026

### Auffälligkeiten ausblenden

- Jede Auffälligkeit in der Übersicht lässt sich mit «ausblenden» bewusst belassen —
  etwa die gleiche MAC auf zwei Adressen, wenn ein Gerät tatsächlich so arbeitet.
  Bei «Gleiche MAC im selben Netz» gilt das für die ganze Gruppe: dieselbe MAC bleibt
  ausgeblendet, eine andere erscheint neu.
- Gilt für: statische Adresse im DHCP-Bereich, Adresse mehrfach erfasst, gleiche MAC,
  Adresse ausserhalb des Netzes, überlappende Netze, Netz ohne Gateway, Netz ohne
  Sicherheitszone, Host ohne Namen. Für Offline-Geräte gibt es weiterhin «sporadisch»
  am Host.
- Unter den Auffälligkeiten steht, wie viele Einträge ausgeblendet sind, mit
  «Wieder einblenden». Die Hinweise im UniFi-Abgleich bleiben davon unberührt.
- Neuer Endpunkt `/api/ignore` für beide Sorten; `/api/unifi/ignore` funktioniert weiter.

## 1.12.1 — 15.10.2026

### Behoben

- **Geräte, die andere durchreichen, verwirrten den Abgleich.** Bei einem Sonos-Heimkino
  funken Sub und Rear-Lautsprecher über die Soundbar; UniFi zeigt ihre Adressen dann
  hinter der MAC der Soundbar. Der Abgleich hielt deshalb die feste Reservierung eines
  Rear-Lautsprechers für veraltet und schlug vor, dessen Eintrag die MAC der Soundbar zu
  geben — danach stand dieselbe MAC auf zwei Adressen. Jetzt gilt eine MAC, die live auf
  mehreren Adressen auftaucht, als Brücke: Für diese Adressen wird das eigentliche Gerät
  aus der Client-Liste von UniFi eingesetzt. Wo das nicht geht, warnt der Abgleich vor
  dem Übernehmen.
- **Eine Reservierung, deren Gerät in den letzten 24 Stunden gesehen wurde, gilt nie als
  veraltet** — unabhängig davon, was die Live-Daten unter der Adresse zeigen. Ein falsch
  übernommener Eintrag wird stattdessen zur MAC-Korrektur angeboten.
- **Zonen wurden nicht zugeordnet, wenn Netze und Zonen aus verschiedenen APIs kamen.**
  Die Netz-IDs unterscheiden sich je nach API; die Zuordnung klappte nur, wenn beide aus
  derselben stammten. Jetzt wird über Subnetz, VLAN-ID oder Name zugeordnet, was immer
  vorhanden ist.
- Das UniFi-Panel und `unifi-check.js` zeigen jetzt, wie viele Zonen gelesen und wie
  viele Netze zugeordnet wurden — oder dass der Controller keine Zonen liefert.

## 1.12.0 — 15.10.2026

### Sicherheitszonen werden automatisch gespiegelt

- Bisher meldete der Abgleich eine abweichende Zone nur, und jedes Netz musste einzeln
  ausgewählt und übernommen werden. Die Zone wird aber in der Firewall von UniFi
  festgelegt — hier soll sie nur abgebildet sein. Jetzt übernimmt jede Abfrage des
  Controllers (auch das normale Laden der Seite) die Zonen automatisch für alle Netze,
  die UniFi kennt. Jede Änderung steht im Protokoll.
- Eine Zone aus UniFi ist im Netzformular gesperrt und als «aus UniFi» gekennzeichnet,
  auch im Kopf des Netzes. Geändert wird sie in UniFi.
- Netze, die UniFi nicht kennt, und Controller ohne Zonen: Die Zone bleibt wie bisher
  von Hand pflegbar. Verschwindet ein Netz aus dem Controller, bleibt seine Zone stehen
  und ist wieder frei bearbeitbar.
- Der Platzhalter im Zonenfeld lautet jetzt «z. B. Internal» — vorher sah er aus wie
  ein eingetragener Wert.

## 1.11.0 — 15.10.2026

### Hinweise ausblenden

- Jeder Hinweis unter «In UniFi prüfen» hat einen Knopf «Ausblenden» — für Fälle, die
  bewusst so bleiben sollen. Der Hinweis ist an Adresse und MAC der Reservierung
  gebunden: Ändert sich die Reservierung in UniFi, erscheint er wieder.
- Ausgeblendete Hinweise werden im Abgleich gezählt und lassen sich mit «Wieder
  einblenden» zurückholen. Sie liegen in `ipam.json` und überstehen Neustarts und Import.
- Ausblenden dürfen die Rollen Administrator und Bearbeiten.

## 1.10.1 — 15.10.2026

### Behoben

- **Unverständlicher Hinweis zu veralteten Reservierungen.** «UniFi reserviert diese
  Adresse noch für …» stand ohne Zusammenhang unter «Hosts mit Abweichung», obwohl im
  IPAM nichts abwich und nichts zu übernehmen war. Solche Fälle stehen jetzt in einer
  eigenen Gruppe «In UniFi prüfen» und erklären beide Seiten: für welches Gerät UniFi
  die Adresse reserviert hat und wann es zuletzt gesehen wurde, welches Gerät hier
  dokumentiert ist, welcher Konflikt droht und wo er in UniFi zu beheben ist.
- **Alte MAC wurde zurückgeschrieben, wenn das neue Gerät gerade offline war.** War der
  dokumentierte Host beim Abgleich nicht online, schlug der Abgleich vor, seine MAC auf
  die des alten, reservierten Geräts zu ändern. Jetzt entscheidet «zuletzt gesehen»:
  Wurde das dokumentierte Gerät später gesehen als das reservierte, gilt die
  Reservierung als veraltet. Ist die Reservierung neuer, wird die MAC wie bisher zur
  Korrektur angeboten.

## 1.10.0 — 15.10.2026

### Behoben

- **Offline-Geräte erschienen als feste Reservierungen.** Die ältere UniFi-API liefert
  alle bekannten Clients, auch längst verschwundene. Als «fest» galt bisher jeder
  Client, bei dem noch ein Feld `fixed_ip` stand — das bleibt in UniFi aber oft stehen,
  nachdem die feste IP ausgeschaltet wurde. Daher kamen alte Einträge wie «old-vm»
  oder «SonosZP» immer wieder, mitsamt falscher MAC-Korrekturen und Hinweisen auf
  veraltete Reservierungen. Jetzt zählt nur noch der Schalter `use_fixedip`.
- **Rechtelücke bei den Einstellungen.** Über das Umschalten des Erscheinungsbilds
  konnte jede Rolle — auch «Lesen» — beliebige Einstellungen mitschreiben. Der
  Endpunkt nimmt jetzt nur noch das Erscheinungsbild an.

### Offline-Geräte aufräumen

- UniFi merkt sich, wann es jeden bekannten Client zuletzt gesehen hat. Daraus wird
  ermittelt, welche dokumentierten Hosts seit einer einstellbaren Frist (Vorgabe
  30 Tage) offline sind.
- **Von Hand:** neue Gruppe «Seit über N Tagen offline» im UniFi-Abgleich, entfernen
  per Auswahl — mit Sicherung vorher.
- **Automatisch:** einschaltbar unter Zahnrad → UniFi → Offline-Geräte, mit Vorschau
  und «Jetzt aufräumen». Prüft alle sechs Stunden, legt vorher eine Sicherung an und
  protokolliert jeden entfernten Eintrag.
- **Vorsichtig von Haus aus:** nur DHCP-Einträge (statische und reservierte nur auf
  Wunsch), nie Hosts ohne MAC, nie UniFi-Geräte, nie Hosts, deren MAC UniFi gar nicht
  kennt. Wären mehr als die Hälfte der geprüften Hosts betroffen, wird nichts entfernt.
- **«Meldet sich nur sporadisch»** als Schalter im Host, etwa für Batteriegeräte, die
  das WLAN nur kurz nutzen: Solche Hosts werden nie als offline behandelt.
- Das Hostformular zeigt, wann UniFi das Gerät zuletzt gesehen hat. Die Übersicht hat
  die neue Auffälligkeit «Seit über N Tagen offline».

## 1.9.0 — 15.10.2026

### Sicherheitszonen

- Jedes Netz hat ein Feld «Sicherheitszone» — die Zone der zonenbasierten Firewall
  in UniFi (ab Network 9). Vorschläge im Formular: Internal, External, Gateway, DMZ,
  Hotspot, VPN sowie alle bereits verwendeten eigenen Zonen.
- Der UniFi-Abgleich liest die Zone mit: bei neuen Netzen gleich übernommen, bei
  bestehenden als Abweichung gemeldet. Gelesen über die Integration API, sonst über
  die ältere Controller-API. Weil die beiden APIs unterschiedliche Netz-IDs vergeben,
  wird im Zweifel über das Subnetz zugeordnet. Controller ohne Zonen funktionieren
  unverändert weiter.
- Angezeigt in der Seitenleiste, im Kopf des Netzes, in der Suche und in der Übersicht:
  dort als Kacheln je Zone mit Netzen und Hosts sowie als Spalte der Netztabelle.
- Neue Auffälligkeit «Netz ohne Sicherheitszone», sobald Zonen im Einsatz sind oder
  UniFi angebunden ist.

## 1.8.0 — 15.10.2026

### Benutzerverwaltung

- Mehrere Benutzer mit drei Rollen: **Administrator** (alles, auch Benutzer,
  UniFi-Einstellungen und Import), **Bearbeiten** (Netze, Hosts, UniFi-Abgleich
  übernehmen) und **Lesen** (alles ansehen, nichts ändern).
- Verwaltung unter Zahnrad → Benutzer: anlegen, Rolle ändern, Passwort neu setzen,
  löschen. Die Liste zeigt die letzte Anmeldung und die offenen Sitzungen.
- Die Rechte prüft der Server bei jeder Anfrage. Rolle und Konto werden pro Anfrage
  frisch nachgeschlagen: Ein Rollenwechsel wirkt sofort, ein neu gesetztes Passwort
  oder ein gelöschtes Konto meldet die Person sofort auf allen Geräten ab.
- Schutz vor dem Aussperren: Der letzte Administrator lässt sich weder löschen noch
  herabstufen, das eigene Konto nicht löschen und die eigene Rolle nicht ändern.
  Das eigene Passwort geht weiterhin nur mit dem alten über das Benutzersymbol.
- Die Oberfläche blendet aus, was die Rolle nicht darf. Für «Lesen» öffnen sich Netze
  und Hosts schreibgeschützt.
- Benutzernamen sind bei der Anmeldung unempfindlich gegen Gross- und Kleinschreibung.
  Ein unbekannter Name dauert gleich lang wie ein falsches Passwort.
- Das Konto-Panel zeigt die eigene Rolle.

### Umstieg

- Das bisherige Konto wird beim ersten Start automatisch Administrator, bestehende
  Sitzungen bleiben gültig. `auth.json` wechselt dabei in das neue Format.
- `IPAM_USER`/`IPAM_PASS` ergeben einen zusätzlichen Administrator, nützlich als
  Notfallzugang, wenn das einzige Administratorpasswort vergessen ist (siehe SYNOLOGY.md).

### Tests

- 13 neue Prüfungen für Rollen, Rechte, Schutz des letzten Administrators, Neustart
  und die Umstellung von 1.7.

## 1.7.1 — 15.10.2026

### Oberfläche

- Navigation und Hauptbereich scrollen getrennt. Die Seite selbst bleibt stehen,
  die Kopfleiste ist immer oben, und der Fuss der Navigation mit der Zusammenfassung
  bleibt auch bei vielen Netzen sichtbar.
- Beim Wechsel zu einem anderen Netz oder zur Übersicht beginnt der Hauptbereich
  wieder oben; nach dem Speichern eines Hosts bleibt die Position erhalten.

## 1.7.0 — 15.10.2026

### Übersicht

Neue Startseite mit dem Gesamtbild — erreichbar über «Übersicht» oben in der
Seitenleiste oder einen Klick aufs Logo.

- **Kennzahlen:** Netze, erfasste und freie Adressen samt Gesamtbelegung,
  Auffälligkeiten und — mit UniFi — wie viele Geräte gerade online sind und wie
  viele davon nicht dokumentiert.
- **Belegung nach Typ:** statisch, DHCP und reserviert als gestapelter Balken mit
  Anzahl und Anteil.
- **Netztabelle:** pro Netz die Belegung nach Typ, erfasst, frei, Grösse des
  DHCP-Bereichs, online laut UniFi (plus undokumentierte) und die nächste freie
  statische Adresse. Netze ab 90 % Belegung sind als «fast voll» markiert.
- **Auffälligkeiten**, jeweils mit den betroffenen Einträgen zum Anklicken:
  statische Adresse im DHCP-Bereich (Konfliktgefahr), Adresse mehrfach erfasst,
  gleiche MAC im selben Netz, Adresse ausserhalb ihres Netzes, überlappende Netze,
  Netz ohne Gateway, Host ohne Namen, online aber nicht dokumentiert.
- **Zuletzt geändert:** die acht jüngsten Änderungen an Hosts und Netzen.

Die Farben der Typen (Kupfer, Blau, Grün) sind auf Farbsehschwächen geprüft, im
hellen wie im dunklen Erscheinungsbild. Die Rasterfarben Schiefer und Braun waren
dafür zu ähnlich. Jeder Wert steht zusätzlich als Zahl in Legende oder Tabelle.

Beim Start öffnet sich jetzt die Übersicht statt des ersten Netzes.

## 1.6.2 — 15.10.2026

### Behoben

- **Abgleich schlug veraltete Daten vor.** Hatte UniFi eine Adresse noch für ein altes
  Gerät reserviert, während dort längst ein anderes online war (etwa ein Server mit
  statisch konfigurierter IP), zeigte der Abgleich Name und MAC der alten Reservierung.
  Der Live-Fund wurde wegen der Rangfolge «Reservierung vor Live-Fund» ausgeblendet —
  nur das Raster zeigte den richtigen Namen.
  Jetzt gilt, was tatsächlich antwortet: Bei anderer MAC wird das Gerät vorgeschlagen,
  das online ist, mit dem Hinweis, dass die Reservierung im Controller veraltet ist.
  Bei gleicher MAC gewinnt der aktuelle Name. Einem bereits erfassten Host wird nicht
  mehr die MAC der veralteten Reservierung als Korrektur angeboten.
- Die Knöpfe unten im UniFi-Panel liefen bei schmalem Panel aus dem Bild; sie brechen
  jetzt um.

## 1.6.1 — 15.10.2026

### Oberfläche

- Einstellungen und Konto sind wieder getrennt: Das Zahnrad enthält die
  UniFi-Anbindung, das Benutzersymbol ganz rechts Passwortwechsel und Abmelden.

### Behoben

- **Online-Geräte im hellen Erscheinungsbild nicht erkennbar.** Der Ring um Adressen,
  die laut UniFi online sind, war weiss und verschwand zwischen den hellen Fugen des
  Rasters. Er hat jetzt die Textfarbe — dunkel im hellen, hell im dunklen Modus.
- **DHCP-Bereich nicht erkennbar.** Die Zellen unterschieden sich in beiden Modi kaum
  von freien Adressen. Sie tragen jetzt einen hellen Ton der Lease-Farbe, damit
  Bereich und vergebene Leases sichtbar zusammengehören.
- Die Legende zeigte das Gateway in Kupfer statt in der Farbe, die das Raster verwendet.

## 1.6.0 — 15.10.2026

### UniFi-Anbindung in der Oberfläche

- Neues Zahnrad oben rechts mit den Einstellungen für UniFi und das Konto
  (ersetzt das Personensymbol aus 1.5).
- Controller-Adresse, API-Schlüssel, Site und Zertifikatsprüfung werden dort gepflegt
  und in `data/unifi.json` gespeichert. Ein Update oder eine neue Compose-Datei
  überschreibt sie nicht mehr — genau das war mit 1.5 passiert.
- «Verbindung testen» probiert die Eingaben aus, bevor sie gespeichert werden, und
  zeigt, wie viele Netze, Geräte und Clients gelesen werden.
- Der Schlüssel verlässt den Server nicht mehr: Die Oberfläche zeigt nur
  «gespeichert …abcd», und er steht weder in `ipam.json` noch im Export.
  Leer lassen behält den gespeicherten Schlüssel; bei geänderter Adresse muss er
  neu eingegeben werden, damit er nie an eine andere Adresse geht.
- Vom UniFi-Panel führt bei einem Verbindungsfehler ein Knopf direkt in die Einstellungen.
- `IPAM_UNIFI_*` in der Compose-Datei gilt weiter als Rückfall, solange in der
  Oberfläche nichts gespeichert ist. Die Zeilen sind aus der mitgelieferten
  Compose-Datei entfernt.
- `unifi-check.js` liest dieselben Einstellungen wie die Anwendung.

### Tests

- Nachgebauter Controller unter `tests/fake-unifi.js`, 14 neue Prüfungen für
  Einstellungen, Verbindungstest, Vorrang und Schutz des Schlüssels.

## 1.5.0 — 15.10.2026

### Eigene Anmeldung statt Cloudflare Access

- Anmeldemaske im l3t-Erscheinungsbild, hell und dunkel nach Systemvorgabe.
- Ersteinrichtung im Browser: Beim ersten Start schreibt die Anwendung einen
  Einrichtungscode ins Container-Protokoll. Nur wer den Code hat, kann das Konto
  anlegen — das Protokoll ist nur im Container Manager einsehbar.
- Passwort als scrypt-Hash in `data/auth.json`, mindestens 12 Zeichen.
- Sitzungen per Cookie (`HttpOnly`, `SameSite=Strict`, über HTTPS `Secure`),
  serverseitig nur als Hash gespeichert und über Neustarts hinweg gültig.
  Wahlweise «Angemeldet bleiben» für 30 Tage, sonst Ablauf nach 12 Stunden Inaktivität.
- Konto-Panel oben rechts: Passwort ändern (meldet alle anderen Geräte ab), Abmelden.
- Sperre nach 10 Fehlversuchen pro Adresse für 15 Minuten, globale Bremse, Verzögerung
  bei jedem Fehlversuch, gleiche Meldung für falschen Namen und falsches Passwort.
  Jeder Versuch landet mit Absenderadresse im Protokoll.
- `IPAM_TRUST_PROXY` wertet `CF-Connecting-IP` und `X-Forwarded-*` aus, damit hinter
  Cloudflare-Tunnel oder Synology-Reverse-Proxy die echte Adresse zählt.
- `IPAM_USER`/`IPAM_PASS` funktionieren weiter und haben Vorrang; die bisherige
  HTTP-Basic-Anmeldung entfällt. `IPAM_AUTH=off` schaltet die Anmeldung ganz ab.

### Härtung

- Sicherheits-Header auf allen Antworten: Content-Security-Policy, kein Einbetten
  in fremde Seiten, `nosniff`, kein Referrer.
- Schreibende API-Aufrufe verlangen den Header `X-IPAM-Request` — Schutz gegen
  Cross-Site-Request-Forgery zusätzlich zum `SameSite`-Cookie.
- Strengere Prüfung, dass nur Dateien aus `public/` ausgeliefert werden.

### Betrieb

- Neuer Endpunkt `/healthz` ohne Anmeldung; der Healthcheck in der Compose-Datei
  zeigt jetzt dorthin. **Beim Update die Compose-Datei mit ersetzen**, siehe SYNOLOGY.md.
- Ohne `IPAM_DATA` liegt der Bestand jetzt in `data/` im Projektordner statt in
  `app/data/` — betrifft nur den Start ausserhalb des Containers.

### Repository

- Sauber aufgesetzt: README, `.gitignore`, `.gitattributes` (LF), `package.json`.
- Testsuite unter `tests/` mit dem eingebauten Testrunner von Node, ohne
  Abhängigkeiten: Anmeldung, Sperre, Sitzungen, API und Paket.
- `scripts/package.js` baut das Synology-Paket plattformunabhängig und prüft es vorher.
  Die in 1.3.1 beschriebenen Skripte und Tests waren nie im Repository gelandet.

## 1.4.0 — 07.09.2026

### UniFi-Geräte

- Gateway, Switches und Access Points werden jetzt mitgelesen. Sie sind keine Clients
  und stehen im Controller in einer eigenen Quelle — deshalb fehlten sie bisher
  vollständig im Abgleich. Gelesen über die Integration API, mit Rückfall auf die
  klassische API.
- Eigene Gruppe im Abgleich mit Adresse, Name, Modell und MAC. Bei der Übernahme
  landet das Modell im Feld «Rolle», der Gerätename als Hostname, und der Typ richtet
  sich nach der Konfiguration im Controller: statisch konfigurierte Geräte als
  `statisch`, per DHCP versorgte als `dhcp`.
- Geräte zählen im Belegungsraster als online, erscheinen also mit hellem Ring
  beziehungsweise schraffiert, wenn sie noch nicht dokumentiert sind.
- Geräte ohne Adresse — etwa gerade nicht erreichbare — werden übersprungen.
- `unifi-check.js` listet die gefundenen Geräte mit Modell mit auf.

### Rangfolge im Abgleich

Eine Adresse kann in mehreren Quellen gleichzeitig stehen. Es gilt jetzt durchgehend:
Gerät vor Reservierung vor Live-Fund. Jede Adresse erscheint genau einmal, egal wie
viele Quellen sie kennen.

### Behoben

- Eine noch nicht dokumentierte Reservierung wurde zusätzlich als Live-Fund geführt.
  Das ist derselbe Fehler wie in 1.3.2, nur im Zweig für neue Einträge — beim Umbau
  auf die Rangfolge war das Vormerken dort verlorengegangen. Jetzt mit eigenem
  Regressionstest für genau diesen Zweig abgedeckt.

## 1.3.2 — 07.09.2026

### Behoben

- **Feste Reservierungen wurden bei der Übernahme doppelt angelegt.** Eine reservierte
  Adresse stand im Abgleich in zwei Listen gleichzeitig: einmal als Reservierung aus
  dem Controller, einmal als «live gesehen, nicht dokumentiert». Wer beide Listen
  auswählte, bekam denselben Host zweimal — einmal als `statisch`, einmal als `dhcp`.
  Adressen, die bereits als Reservierung zur Übernahme stehen, erscheinen jetzt nicht
  mehr zusätzlich unter den Live-Funden.

### Zusätzlich abgesichert

- Der Server lehnt eine Adresse ab, die im selben Netz schon vergeben ist — beim
  Anlegen, beim Ändern und bei der Übernahme aus UniFi. Bisher prüfte das nur die
  Oberfläche, die Schnittstelle nahm alles an. Was bei der Übernahme übersprungen
  wurde, meldet die Bestätigung mit.
- Neue Hinweisleiste über der Ansicht, sobald dieselbe Adresse in einem Netz mehrfach
  erfasst ist, mit einem Knopf zum Zusammenführen. Behalten wird der aussagekräftigste
  Eintrag — feste Reservierungen vor DHCP-Einträgen; Felder, die nur im entfernten
  Eintrag stehen, werden übernommen. Vor dem Zusammenführen entsteht eine Sicherung.
- Der Import bleibt bewusst nachsichtig, damit sich ältere Bestände weiter einlesen
  lassen. Doppel darin fängt die Hinweisleiste ab.

## 1.3.1 — 07.09.2026

### Behoben

- **Das Synology-Paket enthielt die falsche Compose-Datei.** Beim Schnüren von 1.3.0
  wurde die allgemeine Variante mit `build: .` hineinkopiert statt der Synology-Variante.
  Da im Paket bewusst kein Dockerfile liegt, brach der Container Manager mit
  `unable to evaluate symlinks in Dockerfile path` ab. Die Anwendung selbst war nie
  betroffen — es war ein reiner Verpackungsfehler.

### Damit das nicht wiederkommt

- `deploy/docker-compose.synology.yml` ist jetzt die einzige Quelle für die
  Synology-Variante, statt sie beim Paketieren jedes Mal neu hinzuschreiben.
- `build-packages.sh` baut beide Pakete in einem Durchlauf.
- `tests/package.test.sh` prüft die fertigen Archive, bevor sie jemand hochlädt:
  keine `build:`-Zeile im Synology-Paket, richtige Einhängepunkte, alle Dateien
  vorhanden, keine Datenreste. Das Paketieren war bisher der einzige ungetestete
  Schritt der Kette.

## 1.3.0 — 07.09.2026

### UniFi-Anbindung

- Lesender Abgleich mit einem UniFi-Controller. Gelesen wird über die offizielle
  Integration API mit API-Schlüssel; was der jeweilige Firmwarestand dort nicht
  ausgibt, holt die Anwendung über die klassische Controller-API — zuerst mit
  demselben Schlüssel, erst danach mit einem hinterlegten Konto.
- Das Panel zeigt: Netze im Controller, die hier fehlen; Netze mit abweichendem
  Subnetz, Gateway, DHCP-Bereich oder VLAN-ID; feste Reservierungen ohne Eintrag;
  Adressen, die live antworten, aber nirgends dokumentiert sind; und Netze, die es
  nur hier gibt. Übernommen wird nur die getroffene Auswahl.
- Vor der Übernahme wird der Abgleich serverseitig neu berechnet. Was sich
  zwischenzeitlich geändert hat, wird nicht blind geschrieben.
- Im Belegungsraster zwei neue Zustände: dokumentierte Adresse ist online (heller
  Ring), und Adresse antwortet, ist aber nicht erfasst (schraffiert). Ein Klick auf
  die zweite Sorte öffnet das Formular mit Name und MAC aus dem Controller.
- `unifi-check.js` als Diagnosewerkzeug für die Kommandozeile.
- UniFi wird nie beschrieben. Die Anbindung ist ausschliesslich lesend.

### Umrechnungen, die dabei nötig waren

- UniFi legt in `ip_subnet` die Gateway-Adresse samt Präfix ab, etwa `10.13.37.1/24`.
  Daraus werden Netzadresse und Gateway getrennt, sonst landet die Gateway-Adresse
  als Subnetz im Bestand.
- WAN-Einträge und deaktivierte Netze werden aussortiert.
- Live-Adressen ausserhalb aller dokumentierten Netze werden ignoriert statt
  fälschlich zugeordnet.

### Tests

- Nachgebauter Controller unter `tests/fake-unifi.js`, der beide API-Wege abbildet
  und Ausfälle nachstellen kann. Damit sind Abruf, Rückfall auf die klassische API,
  Anmeldung per Konto, Abgleich und Übernahme geprüft, ohne echte Hardware.
- 99 Oberflächen-, 34 API-, 33 Modul- und 26 Durchstichprüfungen.

## 1.2.0 — 07.09.2026

### Marke

- Wortmarke `~/l3t` mit Cursorblock aus den gelieferten Vorlagen übernommen.
  Die Pfade zeichnen mit `currentColor`, dadurch färbt sich das Logo je nach
  Untergrund und es braucht keine drei Dateivarianten.
- Farben aus dem l3t-Branding: Kupfer `#B4551E` für Schaltflächen und Verweise,
  weisser Schaltflächentext, Kopfleiste `#1C1C1A`, Text `#232326`, Flächen `#FFFFFF`.
  Das hellere Kupfer `#E07A22` aus der Logovorlage dient als Akzent auf dunklem Grund.
- Zwei Erscheinungsbilder: hell mit genau diesen Werten, dunkel aus derselben
  Palette abgeleitet. Umschalter oben rechts, Vorgabe folgt dem System.
  Die Wahl liegt im Bestand und gilt geräteübergreifend — kein Browserspeicher.
- Netzfarbe `orange` heisst jetzt `kupferton` und trägt den Markenwert. Bestehende
  Einträge mit `orange` funktionieren weiter.
- Das Gateway hat eine eigene Farbe bekommen, damit es sich vom Markenkupfer
  unterscheidet.

### Tests

- Prüfung der Farbtokens gegen die Markenwerte, beide Erscheinungsbilder auf
  Vollständigkeit, und ein Abgleich, dass keine CSS-Variable ohne Rückfallwert
  benutzt wird, die es nicht gibt. Genau daran wäre die Umbenennung von
  `orange` sonst still gescheitert.
- 77 Oberflächen- und 30 API-Prüfungen.

## 1.1.0 — 07.09.2026

### Behoben

- **Seitenpanel liess sich nicht schliessen und war von Anfang an sichtbar.**
  Ursache war ein Kaskadenkonflikt: `.drawer { display: flex }` hat das
  `hidden`-Attribut überstimmt, weil Klassenselektoren stärker sind als die
  Browser-Standardregel für `[hidden]`. Damit blieb das Panel dauerhaft im
  Aufbau und jeder Schliessversuch verpuffte. Eine explizite Regel
  `[hidden] { display: none !important }` deckt jetzt alle Elemente ab,
  die über dieses Attribut gesteuert werden.
- **Schrägstrich sprang beim Tippen ins Suchfeld.** Das Tastenkürzel `/`
  reagierte auch in Eingabefeldern, wodurch sich eine CIDR-Notation nicht
  eintippen liess. Es greift nun nur ausserhalb von Feldern und bei
  geschlossenem Panel.
- **Eigener DNS-Name wurde beim Bearbeiten überschrieben.** Wer den Hostnamen
  eines bestehenden Eintrags änderte, verlor einen abweichend gesetzten
  DNS-Namen. Ein bereits gefülltes Feld gilt jetzt als bewusst gesetzt.
- Panelinhalt wird beim Schliessen geleert und der Fokus kehrt an die Stelle
  zurück, von der aus geöffnet wurde.
- Import prüft jeden Datensatz einzeln; bei einem Fehler bleibt der bisherige
  Bestand unverändert statt halb überschrieben zu werden.

### Neu

- Versionsanzeige in der Oberfläche und unter `/api/state`
- Eingabeprüfung: Adresse innerhalb des Subnetzes, Netz- und Broadcastadresse
  gesperrt, MAC-Format, VLAN-ID 0–4094, DHCP-Bereich vollständig und in der
  richtigen Reihenfolge, doppelte Subnetze, ungültige CIDR
- Belegungsraster in Reihen zu 16 Adressen mit Beschriftung des letzten Oktetts
- IBM Plex Mono lokal eingebettet, Bild- und Wortmarke, dunkles l3t-Farbbild
- Escape schliesst Panel, Navigation und Suche; Dialogrollen für Screenreader
- Testsuite unter `tests/` (57 Oberflächen- und 25 API-Prüfungen)

## 1.0.0 — 07.09.2026

Erste Fassung: Netze, Hosts, Belegungsraster, Suche, Sichern und Laden,
JSON-Persistenz, optionale Anmeldung, LXC- und Container-Installation.
