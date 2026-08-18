# Polska: miejscowości + administracja + wjazdy drogowe -> SQLite dla Androida

## 1. Dane wejściowe

Nic nie musisz pobierać ręcznie. Przy pierwszym uruchomieniu skrypt sam pobiera z oficjalnego Open Data Geoportalu tylko dwie potrzebne klasy BDOT10k w GeoParquet:

- `OT_ADMS_A.parquet` - obszary miejscowości,
- `OT_SKJZ_L.parquet` - jezdnie.

Pliki trafiają domyślnie do `.cache/bdot10k/` i przy kolejnych uruchomieniach są używane z cache. PRG (gminy/powiaty/województwa) jest pobierany automatycznie przez oficjalny WFS.

Nie jest pobierana pełna krajowa paczka BDOT10k.

## 2. Instalacja

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements_places_db.txt
```

Windows PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements_places_db.txt
```

## 3. Budowa bazy

Najprościej:

```bash
python build_pl_places_db.py --out poland_places.db
```

Pierwsze uruchomienie pobierze tylko wymagane klasy. Kolejne użyje cache. Aby wymusić ponowne pobranie aktualnych plików:

```bash
python build_pl_places_db.py --refresh --out poland_places.db
```

Inny katalog cache:

```bash
python build_pl_places_db.py --cache-dir ./dane_bdot --out poland_places.db
```

Nadal można użyć wcześniej pobranych danych lokalnych przez `--bdot`, `--bdot-places` i `--bdot-roads`.

Jeżeli PRG/WFS nie działa, można podać lokalne PRG:

```bash
python build_pl_places_db.py \
  --prg /sciezka/do/PRG.gpkg \
  --out poland_places.db
```

Najważniejsze parametry:

```text
--cache-dir DIR          katalog pobranych klas BDOT10k
--refresh                pobierz aktualne klasy ponownie
--place-simplify-m 5     uproszczenie granic miejscowości
--admin-simplify-m 3     uproszczenie PRG
--tile-km 40             kafle przetwarzania dróg
--dedupe-m 12            scalanie prawie identycznych wjazdów
```

## 4. Wynik

`poland_places.db`:

- `area.level=0` - miejscowości (miasto, wieś, osada itd.)
- `area.level=1` - gminy
- `area.level=2` - powiaty
- `area.level=3` - województwa
- `area_cell` - indeks przestrzenny bez SpatiaLite
- `entry` - punkty przecięcia jezdni z granicą miejscowości

## 5. Android

Skopiuj:

```text
poland_places.db -> app/src/main/assets/poland_places.db
OfflineGeoDb.kt  -> moduł aplikacji, popraw package
```

Przykład:

```kotlin
val geo = OfflineGeoDb(context)
val areas = geo.areasAt(location.latitude, location.longitude)

val place = areas.firstOrNull { it.level == 0 }
val gmina = areas.firstOrNull { it.level == 1 }
val powiat = areas.firstOrNull { it.level == 2 }
val woj = areas.firstOrNull { it.level == 3 }

val ahead = geo.entriesAhead(
    location.latitude,
    location.longitude,
    location.bearing.toDouble(),
    1200.0
).firstOrNull()

val nearby = geo.nearbyPlaces(location.latitude, location.longitude, 3000.0)
```

Do komunikatu "wjazd" nie reaguj na pojedynczy fix GPS. Uznaj zmianę miejscowości dopiero po 2-3 kolejnych zgodnych pomiarach albo po przebyciu np. 20-30 m po nowej stronie granicy.

`entriesAhead()` jest świadomie heurystyką dla GPS bez trasy nawigacji: odległość + kierunek do punktu + styczna drogi w miejscu przecięcia. Dla pewnego wykrywania kilka kilometrów wcześniej na krętej drodze potrzebna jest polilinia planowanej trasy albo lokalny graf drogowy/map-matching.
