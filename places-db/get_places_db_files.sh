#!/usr/bin/env bash
set -euo pipefail
BASE='https://raw.githubusercontent.com/chuck101/hello/master/places-db'
for i in 00 01 02 03 04 05; do
  wget -q "$BASE/build_pl_places_db.py.part$i" -O "build_pl_places_db.py.part$i"
done
cat build_pl_places_db.py.part00 build_pl_places_db.py.part01 build_pl_places_db.py.part02 build_pl_places_db.py.part03 build_pl_places_db.py.part04 build_pl_places_db.py.part05 > build_pl_places_db.py
rm build_pl_places_db.py.part00 build_pl_places_db.py.part01 build_pl_places_db.py.part02 build_pl_places_db.py.part03 build_pl_places_db.py.part04 build_pl_places_db.py.part05
wget -q "$BASE/requirements_places_db.txt" -O requirements_places_db.txt
wget -q "$BASE/OfflineGeoDb.kt" -O OfflineGeoDb.kt
wget -q "$BASE/README_places_db.md" -O README_places_db.md
chmod +x build_pl_places_db.py
printf 'Pobrano: build_pl_places_db.py, requirements_places_db.txt, OfflineGeoDb.kt, README_places_db.md\n'
