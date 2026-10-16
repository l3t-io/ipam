// Translations for l3t ipam. German is the source language: every German text is also
// its own key, EN provides the English version for it.
//
//   t(de, vars)       own text, {name} is replaced from vars
//   tn(n, eins, mehr) singular/plural, {n} stands for the count
//   tr(text)          finished German message (usually from the server) back into the current language
//
// Keys of the form «Kontext|Text» separate identical words with different meanings
// (e.g. the role «Bearbeiten» and the button «Bearbeiten»); only «Text» is displayed.
//
// Runs in the browser (global I18N) and in Node (require), without dependencies.

(function (root) {
  'use strict';

  const EN = {
    /* ---------- UI: frame and navigation ---------- */
    'Netze anzeigen': 'Show networks',
    'Übersicht': 'Overview',
    'IP, Hostname, MAC, Notiz …': 'IP, hostname, MAC, note …',
    'Bestand durchsuchen': 'Search inventory',
    'Sichern': 'Export',
    'Laden': 'Import',
    'Einstellungen': 'Settings',
    'Konto': 'Account',
    'Netze': 'Networks',
    'Netz anlegen': 'Add network',
    'Statistik und Auffälligkeiten': 'Statistics and issues',
    'Bearbeiten': 'Edit',
    'Schliessen': 'Close',
    'Anmeldung erforderlich': 'Sign-in required',
    'Fehler {status}': 'Error {status}',
    'Keine Verbindung zum Dienst': 'No connection to the service',
    'Keine Verbindung zum Dienst: {fehler}': 'No connection to the service: {fehler}',

    /* ---------- Appearance ---------- */
    'Systemvorgabe': 'System default',
    'Hell': 'Light',
    'Dunkel': 'Dark',
    'Erscheinungsbild: {name}': 'Appearance: {name}',
    'Erscheinungsbild: {name}. Umschalten.': 'Appearance: {name}. Toggle.',
    'Nicht gespeichert: {fehler}': 'Not saved: {fehler}',

    /* ---------- Colours (screen readers only) ---------- */
    'blau': 'blue',
    'kupferton': 'copper',
    'gruen': 'green',
    'braun': 'brown',
    'schiefer': 'slate',
    'violett': 'violet',

    /* ---------- Types ---------- */
    'statisch': 'static',
    'dhcp': 'DHCP',
    'reserviert': 'reserved',
    'DHCP': 'DHCP',
    'DHCP-Lease': 'DHCP lease',
    'am Gerät eingestellt': 'configured on the device',
    'vom DHCP-Server fest vergeben': 'fixed lease from the DHCP server',
    'dynamisch vergeben': 'assigned dynamically',
    'sporadisch': 'sporadic',
    'meldet sich nur sporadisch': 'connects only sporadically',

    /* ---------- Zones ---------- */
    'Sicherheitszone': 'Security zone',
    'Sicherheitszone aus UniFi': 'Security zone from UniFi',
    'Sicherheitszonen': 'Security zones',
    'Zone': 'Zone',
    'ohne Zone': 'no zone',
    'aus UniFi': 'from UniFi',

    /* ---------- Time ---------- */
    'gerade eben': 'just now',
    'vor {n} Min.': '{n} min ago',
    'vor {n} Std.': '{n} h ago',
    'vor 1 Tag': '1 day ago',
    'vor {n} Tagen': '{n} days ago',
    'zuletzt gesehen {zeit}': 'last seen {zeit}',
    'zuletzt {zeit}': 'last seen {zeit}',

    /* ---------- Quantities ---------- */
    '1 Eintrag': '1 entry',
    '{n} Einträge': '{n} entries',
    '1 Netz': '1 network',
    '{n} Netze': '{n} networks',
    '1 Host': '1 host',
    '{n} Hosts': '{n} hosts',
    '1 Sitzung': '1 session',
    '{n} Sitzungen': '{n} sessions',

    /* ---------- UniFi sync ---------- */
    'UniFi-Abgleich': 'UniFi sync',
    'Controller wird abgefragt …': 'Querying controller …',
    'Erneut versuchen': 'Try again',
    'Dokumentation und Controller stimmen überein.': 'Documentation and controller match.',
    'Netze im Controller, hier noch nicht erfasst': 'Networks in the controller, not yet recorded here',
    'Netze mit Abweichung': 'Networks with differences',
    'UniFi-Geräte, hier nicht erfasst': 'UniFi devices, not recorded here',
    'Geräte mit Abweichung': 'Devices with differences',
    'Feste Reservierungen, hier nicht erfasst': 'Fixed reservations, not recorded here',
    'Hosts mit Abweichung': 'Hosts with differences',
    'In UniFi prüfen': 'Check in UniFi',
    'Veraltete feste Reservierungen im Controller. Hier ist nichts zu übernehmen — die Dokumentation stimmt.':
      'Stale fixed reservations in the controller. Nothing to apply here — the documentation is correct.',
    'Die App liest UniFi nur und kann die Reservierung dort nicht selbst entfernen.':
      'The app only reads from UniFi and cannot remove the reservation there itself.',
    '1 Hinweis «In UniFi prüfen» ausgeblendet.': '1 «Check in UniFi» notice hidden.',
    '{n} Hinweise «In UniFi prüfen» ausgeblendet.': '{n} «Check in UniFi» notices hidden.',
    'Wieder einblenden': 'Show again',
    'Live im Netz, nirgends dokumentiert': 'Live on the network, not documented anywhere',
    'Die MAC taucht auf mehreren Adressen auf (Gerät als Brücke, etwa eine Sonos-Soundbar) — vor dem Übernehmen prüfen.':
      'This MAC appears on several addresses (device acting as a bridge, e.g. a Sonos soundbar) — check before applying.',
    'Seit über {tage} Tagen offline — zum Entfernen': 'Offline for more than {tage} days — to remove',
    'Ausgewählte Einträge werden aus der Dokumentation entfernt, vorher entsteht eine Sicherung. Geräte, die sich nur selten melden, im Host als «sporadisch» markieren.':
      'Selected entries are removed from the documentation; a backup is created first. Mark devices that rarely connect as «sporadic» in the host.',
    'Nur hier dokumentiert': 'Documented only here',
    '{cidr} — im Controller nicht gefunden': '{cidr} — not found in the controller',
    'Auswahl übernehmen': 'Apply selection',
    'Alle auswählen': 'Select all',
    'Neu abfragen': 'Query again',
    'Hinweis ausgeblendet': 'Notice hidden',
    'Nichts ausgewählt': 'Nothing selected',
    '1 Eintrag übernommen': '1 entry applied',
    '{n} Einträge übernommen': '{n} entries applied',
    ', {n} bereits vorhanden': ', {n} already present',
    'Achtung: In UniFi ist die Adresse noch fest für {name} ({mac}) reserviert — siehe «In UniFi prüfen».':
      'Note: in UniFi this address is still reserved for {name} ({mac}) — see «Check in UniFi».',
    'ein anderes Gerät': 'another device',
    'ein Gerät ohne Namen': 'an unnamed device',
    'In UniFi fest reserviert für:': 'Reserved in UniFi for:',
    'von UniFi nicht mehr gesehen': 'no longer seen by UniFi',
    'Hier dokumentiert und online:': 'Documented here and online:',
    'Hier dokumentiert:': 'Documented here:',
    'ohne Namen': 'unnamed',
    'Meldet sich {name} wieder, bekommt es diese Adresse zugeteilt — dann gibt es einen Konflikt.':
      'If {name} reconnects, it will be assigned this address — causing a conflict.',
    'In UniFi unter <i>Client Devices → {name} → Einstellungen</i> die feste IP-Adresse ausschalten oder dem neuen Gerät zuweisen.':
      'In UniFi, go to <i>Client Devices → {name} → Settings</i> and turn off the fixed IP address or assign it to the new device.',
    'Bewusst so belassen. Ändert sich die Reservierung in UniFi, erscheint der Hinweis wieder.':
      'Leave as is on purpose. If the reservation changes in UniFi, the notice reappears.',
    'Ausblenden': 'Hide',

    /* ---------- Settings: UniFi ---------- */
    'Benutzer': 'Users',
    'Wird geladen …': 'Loading …',
    'UniFi-Anbindung': 'UniFi connection',
    'In der Oberfläche gespeichert.': 'Saved in the web interface.',
    'Kommt aus der Compose-Datei. Einmal hier speichern, dann übersteht es jedes Update.':
      'Comes from the Compose file. Save it here once and it survives every update.',
    'Noch nicht eingerichtet.': 'Not set up yet.',
    'Controller-Adresse': 'Controller address',
    'API-Schlüssel': 'API key',
    'gespeichert {hinweis}': 'saved {hinweis}',
    'Leer lassen behält den gespeicherten Schlüssel.': 'Leave empty to keep the saved key.',
    'In UniFi Network: Einstellungen → Control Plane → Integrationen → Create New API Key.':
      'In UniFi Network: Settings → Control Plane → Integrations → Create New API Key.',
    'Zertifikat prüfen': 'Verify certificate',
    'Nur einschalten, wenn der Controller ein gültiges Zertifikat hat — ab Werk ist es selbst signiert.':
      'Only enable if the controller has a valid certificate — by default it is self-signed.',
    'Speichern': 'Save',
    'Verbindung testen': 'Test connection',
    'Entfernen': 'Remove',
    'Controller-Adresse fehlt': 'Controller address missing',
    'Adresse muss mit https:// beginnen, etwa https://10.1.1.1': 'Address must start with https://, e.g. https://10.1.1.1',
    'API-Schlüssel fehlt': 'API key missing',
    'Verbindung steht': 'Connected',
    '{netze} Netze, {geraete} Geräte, {live} Clients': '{netze} networks, {geraete} devices, {live} clients',
    'Keine Verbindung: {fehler}': 'No connection: {fehler}',
    'UniFi-Anbindung gespeichert': 'UniFi connection saved',
    'UniFi-Anbindung entfernen? Adresse und Schlüssel werden gelöscht, der IPAM-Bestand bleibt.':
      'Remove the UniFi connection? Address and key are deleted, the IPAM inventory stays.',
    'UniFi-Anbindung entfernt': 'UniFi connection removed',

    /* ---------- Settings: offline devices ---------- */
    'Offline-Geräte': 'Offline devices',
    'Dokumentierte Hosts, die UniFi länger nicht gesehen hat. Als «sporadisch» markierte Hosts sowie Geräte ohne MAC oder unbekannt bei UniFi bleiben immer stehen.':
      'Documented hosts that UniFi has not seen for a while. Hosts marked «sporadic», devices without a MAC and devices unknown to UniFi are always kept.',
    'Frist in Tagen': 'Threshold in days',
    'Auch statische und reservierte Einträge': 'Include static and reserved entries',
    'Aus: nur DHCP-Einträge. Ein ausgeschalteter Server soll nicht verschwinden.':
      'Off: DHCP entries only. A server that is switched off should not disappear.',
    'Automatisch entfernen': 'Remove automatically',
    'Prüft alle sechs Stunden. Vorher entsteht eine Sicherung, jeder Eintrag steht im Protokoll. Sind mehr als die Hälfte betroffen, wird nichts entfernt.':
      'Checks every six hours. A backup is created first and every entry is logged. If more than half would be affected, nothing is removed.',
    'Vorschau': 'Preview',
    'Jetzt aufräumen': 'Clean up now',
    'Gespeichert — entfernt automatisch nach {tage} Tagen': 'Saved — removes automatically after {tage} days',
    'Gespeichert — nur von Hand': 'Saved — manual only',
    'Wird geprüft …': 'Checking …',
    '{tage} T.': '{tage} d',
    'Nichts zu entfernen. {geprueft} geprüft, {ohne} unbekannt bei UniFi.': 'Nothing to remove. {geprueft} checked, {ohne} unknown to UniFi.',
    'Nichts zu entfernen. {geprueft} geprüft.': 'Nothing to remove. {geprueft} checked.',
    'Offline-Geräte jetzt aus der Dokumentation entfernen? Vorher entsteht eine Sicherung.':
      'Remove offline devices from the documentation now? A backup is created first.',
    '{n} entfernt: {liste}': '{n} removed: {liste}',
    'Nichts zu entfernen': 'Nothing to remove',

    /* ---------- Users and roles ---------- */
    'Rolle|Administrator': 'Administrator',
    'Rolle|Bearbeiten': 'Editor',
    'Rolle|Lesen': 'Viewer',
    'darf alles, auch Benutzer, UniFi-Einstellungen und Import': 'can do everything, including users, UniFi settings and import',
    'pflegt Netze, Hosts und übernimmt den UniFi-Abgleich': 'maintains networks and hosts, applies the UniFi sync',
    'sieht alles, ändert nichts': 'sees everything, changes nothing',
    'Benutzer anlegen': 'Add user',
    'Benutzername': 'Username',
    'Rolle': 'Role',
    'Passwort': 'Password',
    'Mindestens {n} Zeichen. Teile es der Person auf einem sicheren Weg mit.': 'At least {n} characters. Share it with the person through a secure channel.',
    'Passwort wiederholen': 'Repeat password',
    'Anlegen': 'Create',
    'Zurück': 'Back',
    'Benutzername fehlt': 'Username missing',
    'Passwort muss mindestens {n} Zeichen lang sein': 'Password must be at least {n} characters long',
    'Die beiden Passwörter stimmen nicht überein': 'The two passwords do not match',
    '«{user}» angelegt': '«{user}» created',
    '(du)': '(you)',
    'Dieses Konto steht in der Compose-Datei (IPAM_USER/IPAM_PASS) und lässt sich nur dort ändern.':
      'This account is defined in the Compose file (IPAM_USER/IPAM_PASS) and can only be changed there.',
    'Die eigene Rolle ändert ein anderer Administrator.': 'Your own role can only be changed by another administrator.',
    'Passwort neu setzen': 'Reset password',
    'Neues Passwort': 'New password',
    'Leer lassen behält das Passwort. Ein neues meldet {user} auf allen Geräten ab.':
      'Leave empty to keep the password. A new one signs {user} out on all devices.',
    'Neues Passwort wiederholen': 'Repeat new password',
    'Das eigene Passwort änderst du über das Benutzersymbol oben rechts.': 'Change your own password via the user icon at the top right.',
    'Löschen': 'Delete',
    'Nichts geändert': 'Nothing changed',
    '«{user}» gespeichert': '«{user}» saved',
    '«{user}» löschen? Die Person wird sofort abgemeldet.': 'Delete «{user}»? The person is signed out immediately.',
    '«{user}» gelöscht': '«{user}» deleted',
    'zuletzt angemeldet {zeit}': 'last signed in {zeit}',
    'noch nie angemeldet': 'never signed in',
    'aus der Compose-Datei': 'from the Compose file',
    'Ansehen': 'View',

    /* ---------- Account ---------- */
    'Angemeldet als <b>{user}</b> · {rolle}': 'Signed in as <b>{user}</b> · {rolle}',
    'Dieses Konto wird über IPAM_USER und IPAM_PASS in der Compose-Datei verwaltet. Das Passwort lässt sich nur dort ändern.':
      'This account is managed via IPAM_USER and IPAM_PASS in the Compose file. The password can only be changed there.',
    'Passwort ändern': 'Change password',
    'Aktuelles Passwort': 'Current password',
    'Mindestens {n} Zeichen. Andere Geräte werden danach abgemeldet.': 'At least {n} characters. Other devices are signed out afterwards.',
    'Abmelden': 'Sign out',
    'Aktuelles Passwort fehlt': 'Current password missing',
    'Neues Passwort muss mindestens {n} Zeichen lang sein': 'New password must be at least {n} characters long',
    'Die beiden neuen Passwörter stimmen nicht überein': 'The two new passwords do not match',
    'Passwort geändert, andere Geräte abgemeldet': 'Password changed, other devices signed out',

    /* ---------- Network view ---------- */
    'Noch keine Netze erfasst': 'No networks yet',
    'Leg dein erstes Netz an — VLAN-ID, Name und Subnetz genügen. Hosts und DNS-Namen kommen danach dazu.':
      'Add your first network — VLAN ID, name and subnet are enough. Hosts and DNS names come afterwards.',
    '1 doppelter Eintrag — dieselbe Adresse ist im selben Netz mehrfach erfasst.': '1 duplicate entry — the same address is recorded more than once in the same network.',
    '{n} doppelte Einträge — dieselbe Adresse ist im selben Netz mehrfach erfasst.': '{n} duplicate entries — the same address is recorded more than once in the same network.',
    'Bereinigen': 'Clean up',
    '1 Eintrag wird zusammengeführt. Felder, die nur im entfernten Eintrag stehen, werden übernommen. Fortfahren?':
      '1 entry will be merged. Fields that exist only in the removed entry are carried over. Continue?',
    '{n} Einträge werden zusammengeführt. Felder, die nur im entfernten Eintrag stehen, werden übernommen. Fortfahren?':
      '{n} entries will be merged. Fields that exist only in the removed entries are carried over. Continue?',
    '1 Eintrag entfernt': '1 entry removed',
    '{n} Einträge entfernt': '{n} entries removed',
    'Netz bearbeiten': 'Edit network',
    'Host hinzufügen': 'Add host',
    'Details': 'Details',
    'erfasst': 'recorded',
    'frei': 'free',
    'nutzbar': 'usable',
    'Noch nichts erfasst. Klick im Raster auf eine freie Adresse.': 'Nothing recorded yet. Click a free address in the grid.',
    'Kein Platz mehr in diesem Netz': 'No free address left in this network',
    'IPv6-Netz — das Raster bleibt aus, die Hostliste funktioniert weiter.': 'IPv6 network — no address grid, the host list still works.',
    'Kein gültiges IPv4-Subnetz hinterlegt, deshalb kein Raster.': 'No valid IPv4 subnet set, so no address grid.',
    'Netz grösser als /22 — Raster ausgeblendet, siehe Hostliste.': 'Network larger than /22 — address grid hidden, see host list.',
    'Netzadresse': 'Network address',
    'online': 'online',
    'online, nicht dokumentiert': 'online, not documented',
    'DHCP-Bereich': 'DHCP range',
    'Adresse': 'Address',
    'Netz': 'Network',
    'Name': 'Name',
    'Typ': 'Type',
    'Notiz': 'Note',

    /* ---------- Overview ---------- */
    'Statische Adresse im DHCP-Bereich': 'Static address in the DHCP range',
    'Der DHCP-Server kann diese Adresse an ein anderes Gerät vergeben — dann gibt es einen Konflikt. Als Reservierung erfassen oder ausserhalb des Bereichs legen.':
      'The DHCP server may hand this address to another device — causing a conflict. Record it as a reservation or move it outside the range.',
    'Adresse mehrfach erfasst': 'Address recorded more than once',
    'Lässt sich über die Hinweisleiste oben zusammenführen.': 'Can be merged via the notice bar at the top.',
    'Gleiche MAC im selben Netz': 'Same MAC in the same network',
    'Ein Gerät mit mehreren Adressen im selben Netz — gewollt, oder ein Überbleibsel? Geräte, die andere durchreichen (etwa eine Sonos-Soundbar), können das auslösen.':
      'One device with several addresses in the same network — intended, or a leftover? Devices that pass others through (e.g. a Sonos soundbar) can cause this.',
    'Adresse ausserhalb des Netzes': 'Address outside the network',
    'Meist aus einem Import oder nach einer Änderung des Subnetzes.': 'Usually from an import or after the subnet was changed.',
    'Überlappende Netze': 'Overlapping networks',
    'Zwei Netze teilen sich Adressen.': 'Two networks share addresses.',
    'Netz ohne Gateway': 'Network without gateway',
    'Netz ohne Sicherheitszone': 'Network without security zone',
    'Ohne Zone ist nicht ersichtlich, welche Firewall-Regeln für das Netz gelten.': 'Without a zone it is unclear which firewall rules apply to the network.',
    'Seit über {tage} Tagen offline': 'Offline for more than {tage} days',
    'Laut UniFi länger nicht gesehen — wird automatisch entfernt. Seltene Geräte im Host als «sporadisch» markieren.':
      'Not seen by UniFi for a while — will be removed automatically. Mark rarely connected devices as «sporadic» in the host.',
    'Laut UniFi länger nicht gesehen. Entfernen über «UniFi» oder automatisch in den Einstellungen. Seltene Geräte im Host als «sporadisch» markieren.':
      'Not seen by UniFi for a while. Remove via «UniFi» or automatically in the settings. Mark rarely connected devices as «sporadic» in the host.',
    'Host ohne Namen': 'Host without name',
    'Online, aber nicht dokumentiert': 'Online but not documented',
    'Laut UniFi aktiv, hier nirgends erfasst. Im Raster schraffiert, übernehmen über «UniFi».':
      'Active according to UniFi, not recorded anywhere here. Hatched in the address grid, apply via «UniFi».',
    '1 Adresse — Abgleich öffnen': '1 address — open sync',
    '{n} Adressen — Abgleich öffnen': '{n} addresses — open sync',
    '{n} von {gesamt} belegt: {typen}': '{n} of {gesamt} in use: {typen}',
    '{n} davon IPv6': '{n} of them IPv6',
    'Adressen erfasst': 'Addresses recorded',
    '{p} % von {n} nutzbaren': '{p} % of {n} usable',
    'Adressen frei': 'Addresses free',
    'in IPv4-Netzen': 'in IPv4 networks',
    'Online laut UniFi': 'Online according to UniFi',
    '{n} davon nicht dokumentiert': '{n} of them not documented',
    'alle dokumentiert': 'all documented',
    'Auffälligkeiten': 'Issues',
    'siehe unten': 'see below',
    'alles sauber': 'all clean',
    'Belegung nach Typ': 'Usage by type',
    'Noch keine Hosts erfasst.': 'No hosts recorded yet.',
    'Subnetz': 'Subnet',
    'Belegung': 'Usage',
    'nächste freie': 'next free',
    'fast voll': 'almost full',
    'Belegung: Anteil erfasster Adressen an den nutzbaren, in der Farbe des Netzes — die Aufteilung nach Typ zeigt der Hinweis beim Darüberfahren. «nächste freie» liegt ausserhalb des DHCP-Bereichs und ist nicht das Gateway.':
      'Usage: share of recorded addresses among the usable ones, in the network\'s colour — hover to see the split by type. «next free» lies outside the DHCP range and is not the gateway.',
    'Bewusst so belassen': 'Leave as is on purpose',
    'ausblenden': 'hide',
    '… und {n} weitere': '… and {n} more',
    'Keine Auffälligkeiten gefunden.': 'No issues found.',
    '1 Eintrag ausgeblendet.': '1 entry hidden.',
    '{n} Einträge ausgeblendet.': '{n} entries hidden.',
    'Zuletzt geändert': 'Recently changed',
    'Noch nichts erfasst.': 'Nothing recorded yet.',

    /* ---------- Search ---------- */
    'Treffer für „{suche}“': 'Results for “{suche}”',
    'Zweck': 'Purpose',
    'Keine Hosts gefunden.': 'No hosts found.',

    /* ---------- Forms ---------- */
    'Abbrechen': 'Cancel',
    'VLAN-ID': 'VLAN ID',
    'CIDR-Schreibweise. IPv6 wird gespeichert, aber ohne Raster dargestellt.': 'CIDR notation. IPv6 is saved but shown without an address grid.',
    'DHCP von': 'DHCP from',
    'DHCP bis': 'DHCP to',
    'z. B. Internal': 'e.g. Internal',
    'Aus UniFi — wird automatisch übernommen. Ändern in der zonenbasierten Firewall von UniFi.':
      'From UniFi — applied automatically. Change it in UniFi\'s zone-based firewall.',
    'UniFi kennt dieses Netz nicht oder liefert keine Zone, deshalb von Hand.': 'UniFi does not know this network or reports no zone, so set it manually.',
    'Zone der Firewall, etwa aus UniFi.': 'Firewall zone, e.g. from UniFi.',
    'Farbe': 'Colour',
    'Folgt der Zone «{zone}».': 'Follows the zone «{zone}».',
    'Kameras, isoliert': 'Cameras, isolated',
    'Notizen': 'Notes',
    'Warum diese Adresse? Was steckt dahinter?': 'Why this address? What is behind it?',
    'Netz löschen': 'Delete network',
    'Name fehlt': 'Name missing',
    'Subnetz fehlt': 'Subnet missing',
    'VLAN-ID muss eine Zahl von 0 bis 4094 sein': 'VLAN ID must be a number from 0 to 4094',
    'Subnetz muss CIDR sein, etwa 10.13.37.0/24': 'Subnet must be in CIDR notation, e.g. 10.13.37.0/24',
    '{feld} ist keine gültige IPv4-Adresse': '{feld} is not a valid IPv4 address',
    '{feld} liegt ausserhalb von {cidr}': '{feld} is outside {cidr}',
    'DHCP-Bereich braucht Anfang und Ende': 'DHCP range needs a start and an end',
    'DHCP-Bereich läuft rückwärts': 'DHCP range runs backwards',
    '{cidr} ist schon bei „{name}“ hinterlegt': '{cidr} is already used by “{name}”',
    'Netz angelegt': 'Network added',
    'Netz gespeichert': 'Network saved',
    '„{name}“ löschen?': 'Delete “{name}”?',
    '„{name}“ löschen? 1 zugehöriger Host wird mitgelöscht.': 'Delete “{name}”? 1 associated host will be deleted as well.',
    '„{name}“ löschen? {n} zugehörige Hosts werden mitgelöscht.': 'Delete “{name}”? {n} associated hosts will be deleted as well.',
    'Netz gelöscht': 'Network deleted',
    'Laut UniFi gerade online': 'Online right now according to UniFi',
    'Laut UniFi zuletzt gesehen {zeit}': 'Last seen by UniFi {zeit}',
    'UniFi kennt diese MAC nicht': 'UniFi does not know this MAC',
    'Host': 'Host',
    'Host bearbeiten': 'Edit host',
    'DNS-Name': 'DNS name',
    'Leer lassen ergänzt automatisch .{domain}': 'Leave empty to append .{domain} automatically',
    'DNS-Container': 'DNS container',
    'Meldet sich nur sporadisch': 'Connects only sporadically',
    'Etwa Batteriegeräte, die das WLAN nur kurz nutzen. Wird nie als offline entfernt.':
      'E.g. battery devices that use the Wi-Fi only briefly. Never removed as offline.',
    'Host löschen': 'Delete host',
    'Netz fehlt': 'Network missing',
    'Adresse fehlt': 'Address missing',
    'Keine gültige IPv4-Adresse': 'Not a valid IPv4 address',
    'Das ist die Netzadresse': 'That is the network address',
    'Das ist die Broadcast-Adresse': 'That is the broadcast address',
    'MAC-Adresse hat ein ungültiges Format': 'MAC address has an invalid format',
    '{ip} ist bereits vergeben: {name}': '{ip} is already taken: {name}',
    'unbenannt': 'unnamed',
    'Host hinzugefügt': 'Host added',
    'Host gespeichert': 'Host saved',
    '{ip} löschen?': 'Delete {ip}?',
    'Host gelöscht': 'Host deleted',
    'Import ersetzt den gesamten Bestand. Vorher wird automatisch eine Sicherung angelegt. Fortfahren?':
      'Import replaces the entire inventory. A backup is created automatically first. Continue?',
    'Bestand importiert': 'Inventory imported',
    'Import fehlgeschlagen: {fehler}': 'Import failed: {fehler}',

    /* ---------- Sign-in page ---------- */
    'Anmelden · l3t ipam': 'Sign in · l3t ipam',
    'Anmelden': 'Sign in',
    'Angemeldet bleiben (30 Tage)': 'Stay signed in (30 days)',
    'Konto einrichten': 'Set up account',
    'Noch ist kein Konto angelegt. Den Einrichtungscode findest du im Protokoll des Containers:':
      'No account exists yet. You will find the setup code in the container log:',
    'Protokoll': 'Log',
    'Einrichtungscode': 'Setup code',
    'Mindestens 12 Zeichen. Ein Satz aus mehreren Wörtern ist ideal.': 'At least 12 characters. A sentence of several words is ideal.',
    'Konto anlegen': 'Create account',
    'Benutzername und Passwort eingeben': 'Enter username and password',
    'Einrichtungscode fehlt': 'Setup code missing',

    /* ---------- Server: inventory (server.js) ---------- */
    'geladen: {vlans} VLANs, {hosts} Hosts': 'loaded: {vlans} VLANs, {hosts} hosts',
    'WARNUNG: ipam.json unlesbar, starte leer:': 'WARNING: ipam.json unreadable, starting empty:',
    'WARNUNG: ipam.json unlesbar, starte leer: {fehler}': 'WARNING: ipam.json unreadable, starting empty: {fehler}',
    'Defekte Datei gesichert als': 'Broken file saved as',
    'Defekte Datei gesichert als {datei}': 'Broken file saved as {datei}',
    'Schreibfehler:': 'Write error:',
    'Schreibfehler: {fehler}': 'Write error: {fehler}',
    'Body zu gross': 'Request body too large',
    'Ungueltiges JSON': 'Invalid JSON',
    'Subnetz (CIDR) fehlt': 'Subnet (CIDR) missing',
    'VLAN fehlt': 'VLAN missing',
    'IP fehlt': 'IP missing',
    'VLAN existiert nicht': 'VLAN does not exist',
    'Unbekannter Hinweis': 'Unknown notice',
    'Methode nicht erlaubt': 'Method not allowed',
    'Erwartet: vlans[] und hosts[]': 'Expected: vlans[] and hosts[]',
    'Import abgebrochen: {fehler}': 'Import aborted: {fehler}',
    'UniFi-Anbindung in der Oberfläche gespeichert: {url}, Site {site}': 'UniFi connection saved in the web interface: {url}, site {site}',
    'UniFi-Anbindung aus der Oberfläche entfernt': 'UniFi connection removed from the web interface',
    'Frist: 1 bis 3650 Tage': 'Threshold: 1 to 3650 days',
    'Offline-Aufräumen: automatisch nach {tage} Tagen, alle Typen': 'Offline cleanup: automatic after {tage} days, all types',
    'Offline-Aufräumen: automatisch nach {tage} Tagen, nur DHCP': 'Offline cleanup: automatic after {tage} days, DHCP only',
    'Offline-Aufräumen: nur von Hand, alle Typen': 'Offline cleanup: manual only, all types',
    'Offline-Aufräumen: nur von Hand, nur DHCP': 'Offline cleanup: manual only, DHCP only',
    'Keine Auswahl übergeben': 'No selection submitted',
    'Netz {cidr} angelegt': 'Network {cidr} added',
    'Netz {cidr} aktualisiert': 'Network {cidr} updated',
    'Gerät {ip} angelegt': 'Device {ip} added',
    'Gerät {ip} aktualisiert': 'Device {ip} updated',
    'Host {ip} angelegt': 'Host {ip} added',
    'Host {ip} aktualisiert': 'Host {ip} updated',
    'Host {ip} aus Live-Bestand übernommen': 'Host {ip} applied from live data',
    'Host {ip} entfernt (seit {tage} Tagen offline)': 'Host {ip} removed (offline for {tage} days)',
    'Offline-Aufräumen von Hand: {ip} {hostname} {mac}, seit {tage} Tagen offline': 'Manual offline cleanup: {ip} {hostname} {mac}, offline for {tage} days',
    'Nichts übernommen — der Abgleich hat sich zwischenzeitlich geändert': 'Nothing applied — the sync has changed in the meantime',
    'Unbekannter Endpunkt': 'Unknown endpoint',
    'Anfrage zu gross': 'Request too large',

    // Zone management (2.1)
    'Farben und Zuordnung': 'Colours and assignment',
    'Netze tragen die Farbe ihrer Zone. Zonen aus UniFi werden automatisch angelegt; eigene Zonen lassen sich frei anlegen.':
      'Networks take the colour of their zone. Zones from UniFi are created automatically; you can add your own as well.',
    'Noch keine Zonen.': 'No zones yet.',
    'Zone anlegen': 'Add zone',
    'Zone bearbeiten': 'Edit zone',
    'Zone löschen': 'Delete zone',
    'Zone angelegt': 'Zone added',
    'Zone gespeichert': 'Zone saved',
    'Zone gelöscht': 'Zone deleted',
    'Zonen verwalten': 'Manage zones',
    'Verwalten': 'Manage',
    'Anzeigen': 'Show',
    'Beschreibung': 'Description',
    'z. B. exponierte Dienste': 'e.g. exposed services',
    'Eigene Farbe': 'Custom colour',
    'Rot': 'Red',
    'Bernstein': 'Amber',
    'Grün': 'Green',
    'Blau': 'Blue',
    'Violett': 'Violet',
    'Rosa': 'Pink',
    'Grau': 'Grey',
    'Der Name kommt aus UniFi und wird dort geändert.': 'The name comes from UniFi and is changed there.',
    'Die sieben Farben sind auf Unterscheidbarkeit geprüft, hell wie dunkel. Eigene Farben gehen auch — die Schrift darauf passt sich an.':
      'The seven colours are checked to stay distinguishable in light and dark mode. Custom colours work too — the text on them adapts.',
    'Gilt für 1 Netz.': 'Used by 1 network.',
    'Gilt für {n} Netze.': 'Used by {n} networks.',
    'Zone «{zone}» löschen?': 'Delete zone «{zone}»?',
    'Zone «{zone}» löschen? {n} Netze sind dann ohne Zone und zeigen wieder ihre eigene Farbe.':
      'Delete zone «{zone}»? {n} networks will have no zone and show their own colour again.',
    'Nur für Netze ohne Zone — mit Zone gilt die Farbe der Zone.': 'Only for networks without a zone — with a zone, the zone\'s colour applies.',
    'Farbe kommt von der Zone «{zone}» — änderbar unter «Zonen verwalten».': 'Colour comes from zone «{zone}» — change it under «Manage zones».',
    'Die Zone «{zone}» wird beim Speichern angelegt.': 'Zone «{zone}» will be created when you save.',
    'Name der Zone fehlt': 'Zone name missing',
    'Die Zone «{name}» gibt es schon': 'Zone «{name}» already exists',
    'Unbekannte Farbe': 'Unknown colour',
    'Zone nicht gefunden': 'Zone not found',
    'Diese Zone kommt aus UniFi und würde beim nächsten Abgleich wieder angelegt': 'This zone comes from UniFi and would be created again on the next sync',
    'Zone «{name}» angelegt': 'Zone «{name}» created',
    'Zone «{name}» gelöscht, {n} Netze ohne Zone': 'Zone «{name}» deleted, {n} networks without zone',
    'Zonen eingerichtet: {n}': 'Zones set up: {n}',
    'Zone «{name}» kommt jetzt aus UniFi': 'Zone «{name}» now comes from UniFi',
    'Zone «{name}» nicht mehr in UniFi': 'Zone «{name}» no longer in UniFi',

    // Diagnostic tool unifi-check.js
    'l3t ipam — UniFi-Diagnose': 'l3t ipam — UniFi diagnostics',
    'Oberfläche (data/unifi.json)': 'web UI (data/unifi.json)',
    'Compose-Datei': 'compose file',
    'Eingestellt in': 'Configured in',
    'Controller': 'Controller',
    '(nicht gesetzt)': '(not set)',
    'gesetzt ({n} Zeichen)': 'set ({n} characters)',
    '(nicht gesetzt, nur als Rückfall nötig)': '(not set, only needed as fallback)',
    'Site': 'Site',
    'Zertifikat': 'Certificate',
    'wird über eine Zertifizierungsstelle geprüft': 'verified against a certificate authority',
    'keines (HTTP)': 'none (HTTP)',
    'gemerkt: {fp}': 'pinned: {fp}',
    'noch nicht gemerkt — wird beim nächsten Abruf gemerkt': 'not pinned yet — will be pinned on the next fetch',
    'Es fehlen Zugangsdaten. In der Oberfläche unter Einstellungen → UniFi eintragen.': 'Credentials missing. Enter them in the web UI under Settings → UniFi.',
    'Verbindung steht.': 'Connected.',
    'Network-Version': 'Network version',
    'unbekannt': 'unknown',
    'Gelesen über': 'Read via',
    'keine Quelle': 'no source',
    'Zonen': 'Zones',
    'Warnungen': 'Warnings',
    'Netze ({n})': 'Networks ({n})',
    'UniFi-Geräte ({n})': 'UniFi devices ({n})',
    'Feste Reservierungen ({n})': 'Fixed-IP reservations ({n})',
    'Aktuell verbunden: {n} Clients': 'Currently connected: {n} clients',
    'Hinweis: Es kamen keine Netze zurück. Meist fehlt dem Konto hinter dem Schlüssel die Berechtigung, oder die Site heisst anders — dann in den Einstellungen anpassen.':
      'Note: no networks were returned. Usually the account behind the key lacks permission, or the site has a different name — adjust it in the settings.',
    'Fehlgeschlagen': 'Failed',
    'Häufige Ursachen': 'Common causes',
    'Schlüssel abgelehnt → in UniFi neu erzeugen, das Konto braucht Administratorrechte': 'Key rejected → create a new one in UniFi; the account needs admin rights',
    'ECONNREFUSED / Zeitüberschreitung → Adresse falsch, oder das Netz darf den Controller nicht erreichen': 'ECONNREFUSED / timeout → wrong address, or this network may not reach the controller',
    'Zertifikat geändert → nach einem Update des Controllers die Anbindung in den Einstellungen erneut speichern': 'Certificate changed → after a controller update, save the connection in the settings again',
    '404 auf allen Pfaden → Network-App älter als 9.3; dann ein Konto per IPAM_UNIFI_USER und IPAM_UNIFI_PASS hinterlegen': '404 on every path → Network app older than 9.3; set an account via IPAM_UNIFI_USER and IPAM_UNIFI_PASS',
    'Zertifikat des Controllers nicht lesbar — Verbindung abgebrochen': 'Could not read the controller certificate — connection aborted',
    'Zertifikat des Controllers hat sich geändert (jetzt {fp}) — Verbindung abgebrochen. Ist das erwartet, etwa nach einem Update des Controllers, die Anbindung in den Einstellungen erneut speichern.':
      'The controller certificate has changed (now {fp}) — connection aborted. If this is expected, e.g. after a controller update, save the connection in the settings again.',
    'Zertifikat gemerkt: {fp} — jede Verbindung wird damit verglichen, bevor der Schlüssel gesendet wird.':
      'Certificate pinned: {fp} — every connection is compared against it before the key is sent.',
    'Das Zertifikat wird bei der nächsten Verbindung gemerkt und danach bei jeder Verbindung geprüft.':
      'The certificate is pinned on the next connection and checked on every connection after that.',
    'Zertifikat {fp}': 'Certificate {fp}',
    'Antwort des Controllers zu gross': 'Controller response too large',
    'Unbekanntes Erscheinungsbild': 'Unknown appearance',
    'VLAN nicht gefunden': 'VLAN not found',
    '{ip} ist in diesem Netz bereits vergeben': '{ip} is already taken in this network',
    'Host nicht gefunden': 'Host not found',
    'Verboten': 'Forbidden',
    'Nicht gefunden': 'Not found',
    'Zonen aus UniFi übernommen: {aenderungen}': 'Zones applied from UniFi: {aenderungen}',
    'UniFi ist nicht eingerichtet': 'UniFi is not set up',
    'automatisches Aufräumen ist aus': 'automatic cleanup is off',
    '{anzahl} von {geprueft} geprüften Hosts wären betroffen — zu viele auf einmal, nichts entfernt':
      '{anzahl} of {geprueft} checked hosts would be affected — too many at once, nothing removed',
    'Offline-Aufräumen abgebrochen: {grund}': 'Offline cleanup aborted: {grund}',
    'Offline-Aufräumen: {ip} {hostname} {mac} entfernt, seit {tage} Tagen offline': 'Offline cleanup: {ip} {hostname} {mac} removed, offline for {tage} days',
    'Offline-Aufräumen (automatisch): {ip} {hostname} {mac} entfernt, seit {tage} Tagen offline':
      'Offline cleanup (automatic): {ip} {hostname} {mac} removed, offline for {tage} days',
    'Offline-Aufräumen fehlgeschlagen:': 'Offline cleanup failed:',
    'Offline-Aufräumen fehlgeschlagen: {fehler}': 'Offline cleanup failed: {fehler}',
    'Nur für Administratoren': 'Administrators only',
    'Nur Lesezugriff — für Änderungen braucht es die Rolle «Bearbeiten»': 'Read-only access — changes require the «Editor» role',
    'Anfrage abgelehnt': 'Request rejected',
    'Fehler:': 'Error:',
    'Fehler: {fehler}': 'Error: {fehler}',
    'l3t-ipam {version} laeuft auf http://{host}:{port}': 'l3t-ipam {version} running on http://{host}:{port}',
    'UniFi-Anbindung aktiv (aus der Oberfläche): {url}': 'UniFi connection active (from the web interface): {url}',
    'UniFi-Anbindung aktiv (aus der Compose-Datei): {url}': 'UniFi connection active (from the Compose file): {url}',
    'UniFi-Anbindung nicht eingerichtet': 'UniFi connection not set up',
    'Start abgebrochen:': 'Startup aborted:',
    'Start abgebrochen: {fehler}': 'Startup aborted: {fehler}',

    /* ---------- Server: sign-in and users (auth.js) ---------- */
    'Sitzungen nicht gespeichert:': 'Sessions not saved:',
    'Sitzungen nicht gespeichert: {fehler}': 'Sessions not saved: {fehler}',
    'WARNUNG: auth.json unlesbar, Einrichtung wird neu angeboten:': 'WARNING: auth.json unreadable, offering setup again:',
    'WARNUNG: auth.json unlesbar, Einrichtung wird neu angeboten: {fehler}': 'WARNING: auth.json unreadable, offering setup again: {fehler}',
    'WARNUNG: {n} ungültige Einträge in auth.json übersprungen': 'WARNING: skipped {n} invalid entries in auth.json',
    'auth.json auf mehrere Benutzer umgestellt, «{user}» ist Administrator': 'auth.json converted to multiple users, «{user}» is administrator',
    'WARNUNG: Anmeldung ist mit IPAM_AUTH=off abgeschaltet — die Oberfläche ist ohne Passwort erreichbar.':
      'WARNING: sign-in is disabled with IPAM_AUTH=off — the web interface is reachable without a password.',
    'IPAM_USER enthält unzulässige Zeichen': 'IPAM_USER contains invalid characters',
    'WARNUNG: IPAM_PASS ist kürzer als {n} Zeichen.': 'WARNING: IPAM_PASS is shorter than {n} characters.',
    'WARNUNG: «{user}» steht in auth.json und in IPAM_USER — es gilt das Konto aus der Compose-Datei':
      'WARNING: «{user}» is in auth.json and in IPAM_USER — the account from the Compose file applies',
    'Anmeldung aktiv, 1 Konto': 'Sign-in active, 1 account',
    'Anmeldung aktiv, {n} Konten': 'Sign-in active, {n} accounts',
    ' Noch kein Konto eingerichtet. Im Browser öffnen und mit diesem': ' No account set up yet. Open in the browser and use this',
    ' Einrichtungscode ein Konto anlegen:   {code}': ' setup code to create an account:   {code}',
    ' Der Code gilt bis zum nächsten Neustart des Containers.': ' The code is valid until the next container restart.',
    'Anmeldung: {ip} nach {n} Fehlversuchen für 15 Minuten gesperrt': 'Sign-in: {ip} locked for 15 minutes after {n} failed attempts',
    'Zu viele gleichzeitige Anmeldeversuche, bitte kurz warten': 'Too many simultaneous sign-in attempts, please wait a moment',
    'Anmeldung fehlgeschlagen ({was}) von {ip}': 'Sign-in failed ({was}) from {ip}',
    'Benutzer «{user}»': 'user «{user}»',
    'Passwortwechsel': 'password change',
    'Zu viele Fehlversuche. Erneut möglich in {min} Min.': 'Too many failed attempts. Try again in {min} min.',
    'Passwort darf höchstens {n} Zeichen lang sein': 'Password must be at most {n} characters long',
    'Passwort darf den Benutzernamen nicht enthalten': 'Password must not contain the username',
    'Passwort besteht nur aus einem Zeichen': 'Password consists of a single repeated character',
    'Anmeldung ist abgeschaltet': 'Sign-in is disabled',
    'Noch kein Konto eingerichtet': 'No account set up yet',
    'Benutzername oder Passwort falsch': 'Wrong username or password',
    'Anmeldung: «{user}» ({rolle}) von {ip}': 'Sign-in: «{user}» ({rolle}) from {ip}',
    'Konto ist bereits eingerichtet': 'Account is already set up',
    'Einrichtungscode stimmt nicht': 'Setup code is incorrect',
    'Benutzername: 1–64 Zeichen, erlaubt sind Buchstaben, Ziffern und . _ @ -': 'Username: 1–64 characters; letters, digits and . _ @ - are allowed',
    'Konto «{user}» eingerichtet von {ip}': 'Account «{user}» set up from {ip}',
    'Das Konto wird über IPAM_USER/IPAM_PASS in der Compose-Datei verwaltet': 'The account is managed via IPAM_USER/IPAM_PASS in the Compose file',
    'Aktuelles Passwort stimmt nicht': 'Current password is incorrect',
    'Das neue Passwort ist dasselbe wie das alte': 'The new password is the same as the old one',
    'Passwort für «{user}» geändert, andere Sitzungen beendet': 'Password for «{user}» changed, other sessions ended',
    '«{user}» gibt es schon': '«{user}» already exists',
    'Unbekannte Rolle': 'Unknown role',
    'Benutzer «{user}» ({rolle}) angelegt von «{admin}»': 'User «{user}» ({rolle}) created by «{admin}»',
    'Benutzer nicht gefunden': 'User not found',
    'Dieses Konto wird über IPAM_USER/IPAM_PASS in der Compose-Datei verwaltet': 'This account is managed via IPAM_USER/IPAM_PASS in the Compose file',
    'Mindestens ein Administrator muss bleiben': 'At least one administrator must remain',
    'Die eigene Rolle kann nur ein anderer Administrator ändern': 'Only another administrator can change your own role',
    'Rolle {rolle}': 'role {rolle}',
    'Das eigene Passwort bitte unter «Konto» ändern': 'Please change your own password under «Account»',
    'Passwort neu gesetzt, Sitzungen beendet': 'password reset, sessions ended',
    'Benutzer «{user}»: {aenderungen} — von «{admin}»': 'User «{user}»: {aenderungen} — by «{admin}»',
    'Das eigene Konto kann nicht gelöscht werden': 'You cannot delete your own account',
    'Benutzer «{user}» gelöscht von «{admin}»': 'User «{user}» deleted by «{admin}»',

    /* ---------- Server: UniFi (unifi.js) ---------- */
    'WARNUNG: unifi.json unlesbar:': 'WARNING: unifi.json unreadable:',
    'WARNUNG: unifi.json unlesbar: {fehler}': 'WARNING: unifi.json unreadable: {fehler}',
    'Adresse ist keine gültige URL, etwa https://10.1.1.1': 'Address is not a valid URL, e.g. https://10.1.1.1',
    'Adresse muss mit https:// oder http:// beginnen': 'Address must start with https:// or http://',
    'Zugangsdaten gehören nicht in die Adresse': 'Credentials do not belong in the address',
    'Nur die Adresse des Controllers angeben, ohne Pfad': 'Enter only the controller address, without a path',
    'API-Schlüssel hat ein ungültiges Format': 'API key has an invalid format',
    'Site: nur Buchstaben, Ziffern und . _ -': 'Site: only letters, digits and . _ -',
    'Bei geänderter Adresse den API-Schlüssel neu eingeben': 'Re-enter the API key when the address changes',
    'Netzwerkfehler: {fehler}': 'Network error: {fehler}',
    'Zeitüberschreitung': 'Timeout',
    'Anmeldung am Controller fehlgeschlagen (HTTP {status})': 'Sign-in to the controller failed (HTTP {status})',
    'Zugriff abgelehnt — API-Schlüssel prüfen (HTTP {status})': 'Access denied — check the API key (HTTP {status})',
    'HTTP {status} bei {pfad}': 'HTTP {status} at {pfad}',
    'Zonen über Integration API': 'Zones via Integration API',
    'Zonen über klassische API': 'Zones via classic API',
    'Keine Sicherheitszonen gelesen — zonenbasierte Firewall nicht aktiv oder vom Controller nicht ausgegeben':
      'No security zones read — zone-based firewall not active or not reported by the controller',
    '{zonen} Zonen gelesen, {zugeordnet} von {netze} Netzen zugeordnet': '{zonen} zones read, {zugeordnet} of {netze} networks assigned',
    '{zonen} Zonen gelesen, {zugeordnet} von {netze} Netzen zugeordnet — ohne Zone: {liste}':
      '{zonen} zones read, {zugeordnet} of {netze} networks assigned — without zone: {liste}',
    'Keine UniFi-Zugangsdaten hinterlegt': 'No UniFi credentials configured',
    'Integration API': 'Integration API',
    'Netze über Integration API': 'Networks via Integration API',
    'Netze über klassische API': 'Networks via classic API',
    'Netze nicht lesbar: {fehler}': 'Networks not readable: {fehler}',
    'Zonen nicht lesbar: {fehler}': 'Zones not readable: {fehler}',
    'Reservierungen nicht lesbar: {fehler}': 'Reservations not readable: {fehler}',
    'Reservierungen über klassische API': 'Reservations via classic API',
    'Geräte über Integration API': 'Devices via Integration API',
    'Geräte nicht lesbar: {fehler}': 'Devices not readable: {fehler}',
    'Geräte über klassische API': 'Devices via classic API',
    'Clients über Integration API': 'Clients via Integration API',
    'Clients nicht lesbar: {fehler}': 'Clients not readable: {fehler}',
    'Clients über klassische API': 'Clients via classic API',
    '{cidr}: Zone nicht mehr aus UniFi': '{cidr}: zone no longer from UniFi',
    'Hostname': 'Hostname',
    'MAC': 'MAC',
    'Gateway': 'Gateway',
  };

  // Placeholders whose value is itself a German message (e.g. «Import abgebrochen: {fehler}»).
  // tr() translates them as well.
  const VERSCHACHTELT = new Set(['fehler', 'grund', 'was']);
  // Placeholders holding a comma-separated list of messages: each entry is translated.
  const LISTEN = new Set(['aenderungen']);

  const LANGS = ['de', 'en'];
  const SPEICHER = 'l3t-lang';
  const imBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

  function gespeichert() {
    try { return window.localStorage.getItem(SPEICHER); } catch { return null; }
  }

  function startSprache() {
    if (!imBrowser) return 'de';
    const s = gespeichert();
    if (LANGS.includes(s)) return s;
    const nav = String((window.navigator && window.navigator.language) || '').toLowerCase();
    return nav.startsWith('de') ? 'de' : 'en';
  }

  let lang = startSprache();

  const fill = (text, vars) => (vars
    ? text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
    : text);

  // German display text of a key: «Kontext|Text» → «Text».
  const deutsch = (key) => {
    const i = key.indexOf('|');
    return i === -1 ? key : key.slice(i + 1);
  };

  const gewarnt = new Set();
  function t(key, vars) {
    const k = String(key);
    if (lang === 'de') return fill(deutsch(k), vars);
    if (Object.prototype.hasOwnProperty.call(EN, k)) return fill(EN[k], vars);
    if (imBrowser && !gewarnt.has(k)) {
      gewarnt.add(k);
      console.warn(`[i18n] keine Übersetzung für: ${k}`);
    }
    return fill(deutsch(k), vars);
  }

  // Singular/plural: `eins` for exactly 1, otherwise `mehr`. {n} is the count unless vars says otherwise.
  const tn = (n, eins, mehr, vars) => t(Number(n) === 1 ? eins : mehr, { n, ...(vars || {}) });

  // Prepare keys with placeholders once as patterns. Longer fixed parts first, so that
  // «Benutzer «{user}» gelöscht von «{admin}»» matches before «Benutzer «{user}»».
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Placeholders that are always numbers only match digits. Otherwise a template starting
  // with «{anzahl} von …» would swallow the beginning of a longer message.
  const ZAHLEN = new Set(['n', 'tage', 'status', 'netze', 'geprueft', 'zugeordnet', 'geraete', 'live',
    'gesamt', 'zonen', 'anzahl', 'min', 'port', 'vlans', 'hosts', 'p']);
  const MUSTER = Object.keys(EN)
    .filter((k) => /\{\w+\}/.test(k) && !k.includes('|'))
    .map((key) => {
      const namen = [];
      const teile = key.split(/\{(\w+)\}/);
      let quelle = '';
      teile.forEach((teil, i) => {
        if (i % 2) { namen.push(teil); quelle += ZAHLEN.has(teil) ? "(\\d[\\d.,'’]*)" : '(.*?)'; } else quelle += reEsc(teil);
      });
      return { key, namen, re: new RegExp(`^${quelle}$`), fest: teile.filter((x, i) => i % 2 === 0).join('').length };
    })
    .sort((a, b) => b.fest - a.fest);

  // Translates a finished German message. Anything unknown stays as it is.
  function tr(text) {
    if (lang === 'de' || typeof text !== 'string' || !text) return text;
    if (Object.prototype.hasOwnProperty.call(EN, text)) return EN[text];
    for (const m of MUSTER) {
      const treffer = m.re.exec(text);
      if (!treffer) continue;
      const vars = {};
      m.namen.forEach((name, i) => {
        const wert = treffer[i + 1];
        vars[name] = VERSCHACHTELT.has(name) ? tr(wert)
          : LISTEN.has(name) ? wert.split(', ').map(tr).join(', ') : wert;
      });
      return fill(EN[m.key], vars);
    }
    return text;
  }

  function setLang(l) {
    if (!LANGS.includes(l)) return;
    lang = l;
    if (imBrowser) {
      try { window.localStorage.setItem(SPEICHER, l); } catch { /* private mode: applies to this page only */ }
      document.documentElement.lang = l;
    }
  }

  const getLang = () => lang;
  const locale = () => (lang === 'en' ? 'en-GB' : 'de-CH');

  // Fixed texts in the HTML: the attribute value is the German source text.
  const ATTRIBUTE = [
    ['data-i18n', (el, s) => { el.textContent = s; }],
    ['data-i18n-placeholder', (el, s) => { el.setAttribute('placeholder', s); }],
    ['data-i18n-title', (el, s) => { el.setAttribute('title', s); }],
    ['data-i18n-aria-label', (el, s) => { el.setAttribute('aria-label', s); }],
  ];
  function applyStatic(rootEl) {
    const wurzel = rootEl || (imBrowser ? document : null);
    if (!wurzel) return;
    if (imBrowser) document.documentElement.lang = lang;
    // In German, the text is already in the HTML.
    if (lang === 'de') return;
    for (const [attr, setzen] of ATTRIBUTE) {
      wurzel.querySelectorAll(`[${attr}]`).forEach((el) => setzen(el, t(el.getAttribute(attr))));
    }
  }

  if (imBrowser) document.documentElement.lang = lang;

  const api = { EN, ZAHLEN, t, tn, tr, setLang, getLang, locale, applyStatic };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.I18N = api;
})(this);
