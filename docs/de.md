# Arlo-Integration

Bringt deine Arlo-Kameras, Video-Türklingeln, Basisstationen und Sirenen in
Gladys: Bilder, Bewegung, Akku, Arlo-Modi (aktiviert, deaktiviert, eigene),
Sirene, Szenen und Dashboard-Widgets.

> **Cloud-Integration.** Arlo hat keine lokale API: Alles läuft über die
> Arlo-Cloud, mit deinem Arlo-Konto. Gladys braucht eine Internetverbindung, und
> Arlo muss erreichbar sein.

## Was du bekommst

| Arlo-Gerät                      | In Gladys                                                       |
| ------------------------------- | --------------------------------------------------------------- |
| Kamera (Pro, Ultra, Essential…) | Bild, Kamera an/aus (Arlo-Privatmodus), Bewegung, Akku          |
| Video-Türklingel                | Wie eine Kamera, plus „Klingeln“                                |
| Audio-Türklingel                | Klingeln, Akku                                                  |
| Basisstation (Hub)              | Arlo-Modus (Liste der Modi der Basis), Sirene bei Pro-Hubs      |
| WLAN-Kamera ohne Hub            | Kamerafunktionen, plus eigener Arlo-Modus und Sirene (ab Pro 3) |
| Arlo-Sirene                     | Sirene an/aus                                                   |

(Noch) nicht unterstützt: Live-Videostreams, Arlo-Leuchten und -Gongs.

## Einrichtung

1. **Tipp:** Lege für Gladys ein zweites Arlo-Konto an und gib deine Geräte in
   der Arlo-App dafür frei (Einstellungen → Zugriff gewähren). Arlo erlaubt nur
   eine Web-Sitzung pro Konto: Dein Hauptkonto in Gladys kann dich bei
   my.arlo.com abmelden, und umgekehrt.
2. Öffne in Gladys die Konfiguration der Integration und fülle aus:
   - **Arlo-E-Mail** und **Arlo-Passwort**;
   - **Bestätigungscode senden per**: E-Mail oder SMS (die Methode muss im
     Arlo-Konto aktiv sein).
3. Speichere und klicke dann auf **Code senden**. Arlo schickt einen Code per
   E-Mail oder SMS.
4. Gib den Code bei **Code bestätigen** ein (innerhalb von 10 Minuten).
5. Der Status wird grün. Öffne den Tab **Erkennung** und füge deine Geräte
   hinzu.

Die Anmeldung wird in der Integration (`/data`) gespeichert und bei jedem
Neustart wiederverwendet. Wenn Arlo sie beendet (meist nach einigen Wochen),
verlangt der Status einen neuen Code: Klicke erneut auf **Code senden**.

### Optionen

| Option                   | Standard | Wirkung                                                                                              |
| ------------------------ | -------- | ---------------------------------------------------------------------------------------------------- |
| Aktualisierungsintervall | 60 s     | Wie oft Modi, Akkus, Bilder und Aufnahmen bei Arlo gelesen werden. Mindestens eine Minute.           |
| Frisches Bild auf Abruf  | aus      | Wenn Gladys ein Bild anfordert, nimmt die Kamera ein neues auf. Weckt Akku-Kameras: das kostet Akku. |
| Detaillierte Logs        | aus      | Protokolliert jedes Arlo-Ereignis. Nützlich, um ein Problem zu melden; danach wieder ausschalten.    |

Die Schaltfläche **Verbindung testen** prüft die Anmeldung und liest die
Geräteliste.

## So funktioniert es

- **Echtzeit:** Bewegung, Klingeln, Akku, Privatmodus und Sirene kommen über den
  Arlo-Ereignisstrom.
- **Bei jeder Aktualisierung:** Die Integration liest die Geräteliste (neues Bild
  jeder Kamera), die aktiven Modi und die Aufnahmen der letzten 24 Stunden.
- **Bilder:** Gladys nimmt Kamerabilder bis 150 KB an. Größere Arlo-Bilder werden
  von der Integration verkleinert.
- Manche Arlo-Konten erhalten keinen Echtzeitstrom. Bewegung, Moduswechsel und
  intelligente Erkennungen kommen trotzdem an, aber bis zu einer Aktualisierung
  später.

## Szenen

### Auslöser

| Schlüssel          | Wann                                                                                                        | Filter                                                    | Variablen           |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------- |
| `motion_detected`  | Eine Kamera hat eine Bewegung gesehen.                                                                      | Kamera                                                    | –                   |
| `object_detected`  | Die intelligente Arlo-Erkennung hat erkannt, was sich bewegt hat (Arlo-Secure-Abo). Kommt mit der Aufnahme. | Kamera, was erkannt wurde (Person, Fahrzeug, Tier, Paket) | `object`            |
| `doorbell_pressed` | Jemand hat eine Türklingel gedrückt.                                                                        | Türklingel                                                | –                   |
| `mode_changed`     | Eine Basis hat den Modus gewechselt (Arlo-App, Zeitplan, Geofencing). Nicht, wenn Gladys ihn geändert hat.  | Basis, neuer Modus (aktiviert, deaktiviert, eigener)      | `mode`, `mode_name` |

Nutze die Variablen in den folgenden Aktionen, zum Beispiel
`{{triggerEvent.data.object}}`.

### Aktionen

| Schlüssel       | Wirkung                                                                                                     | Ergebnis               |
| --------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------- |
| `set_mode`      | Schaltet eine Basis in einen Modus: `armed`, `disarmed` oder den Namen eines eigenen Modus (z. B. `Nacht`). | `changed`, `mode_name` |
| `take_snapshot` | Die Kamera nimmt ein neues Bild auf, das in Gladys erscheint. Danach „Kamerabild senden“ verwenden.         | `taken`                |
| `sound_siren`   | Lässt eine Sirene für eine Dauer (5 bis 300 s) und mit einer Lautstärke (1 bis 8) ertönen.                  | `started`              |

Die Standardaktionen von Gladys funktionieren auch mit den Funktionen: Kamera
ein/aus, „Arlo-Modus“ wählen, Sirene stoppen.

## Dashboard-Widgets

- **Arlo-Übersicht** (`arlo_overview`): der Modus jeder Basis, der Akku jeder
  Kamera, die letzten Aufnahmen mit Vorschaubild und zwei Schaltflächen:
  **Alle aktivieren** / **Alle deaktivieren**.
- **Arlo-Kamera** (`arlo_camera`): Wähle eine Kamera. Zeigt ihr letztes Bild,
  Akku und Bewegung live, ihren Zustand und ihre letzte Aufnahme, mit den
  Schaltflächen **Foto aufnehmen** und **Ein-/Ausschalten**.

## Fehlerbehebung

| Problem                                | Was tun                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| „Arlo verlangt einen Bestätigungscode“ | Klicke auf **Code senden** und dann auf **Code bestätigen**.                                                                                   |
| „No email verification method…“        | Wähle die andere Methode (SMS) oder füge sie in der Arlo-App hinzu (Einstellungen → Bestätigung in zwei Schritten).                            |
| „Invalid credentials“                  | Prüfe E-Mail und Passwort. Melde dich einmal bei my.arlo.com an, um sicherzugehen.                                                             |
| Abgelehnt mit HTTP 403                 | Der Eingang von Arlo hat die Anfrage blockiert. Warte ein paar Minuten und versuche es erneut; wenn es anhält, eröffne ein Issue mit den Logs. |
| Kein Akkuwert                          | Warte auf die nächste Aktualisierung: Arlo sendet ihn über den Ereignisstrom.                                                                  |
| Die Erkennung löst nicht aus           | Die intelligente Erkennung (Person, Fahrzeug…) braucht ein Arlo-Secure-Abo; die reine Bewegung nicht.                                          |

Um ein Problem zu melden, schalte **Detaillierte Logs** ein, stelle es nach und
hänge die Logs der Integration (Gladys → Integrationen → Arlo → Logs) an ein
GitHub-Issue. Die Logs enthalten nie dein Passwort oder dein Token.

## Datenschutz

Deine E-Mail-Adresse, dein Passwort und deine Arlo-Sitzung bleiben in deinem
Gladys. Die Integration spricht nur mit Arlo-Servern (Domains `arlo.com`). Arlo
veröffentlicht keine offizielle API: Diese Integration nutzt dieselben Aufrufe
wie die Arlo-Webanwendung, und eine Änderung bei Arlo kann sie bis zu einem
Update unterbrechen.
