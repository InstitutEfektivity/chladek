# Chládek – log zdrojů míst s klimatizací (AC sources)

> **Pracovní log pro hodinovou `/loop` smyčku** „hledej AC zdroje → integruj → loguj".
> Smysl: Chládek = jediná mapa, která ukazuje, KDE je v Praze veřejně dostupná klimatizace.
> **Na začátku každého kola:** přečti tento soubor → zkontroluj stav a výsledky → vymysli strategii, jak dosáhnout lepšího pokrytí → exekuuj jeden krok (research + integrace do mapy) → zaloguj sem (kolo-log nahoře + aktualizuj tabulky).
> **Postup priorit:** 1) low-hanging fruit (zdroje stejným fetch patternem, co už umíme), 2) out-of-the-box (neotřelé cesty k datům), 3) profesionálně-vědecky (nejdřív si sežeň metodiku/know-how z veřejných zdrojů, pak proveď odborně).
> **Statusy:** ✅ INTEGROVÁNO (živě) · 🔶 NALEZENO (neintegrováno) · 🔬 VERIFY (ověřit před zapojením) · ⛔ SKIP (s důvodem) · 💀 MRTVÉ.
> **Princip:** AC pokrytí asertuj podle KATEGORIE/ZNAČKY (mall, multiplex, hypermarket, kultura, knihovna…), ne podle řídkého OSM tagu `air_conditioning`. Chraň USP – nezahlcuj mapu nízkohodnotnými body.

---

## Kolo-log (nejnovější nahoře)

### 2026-06-27 · kolo 4
- **✅ INTEGROVÁNO: kryté bazény split (tier-A)** – `build_venues.py` reklasifikuje plavecké haly: indoor (sports_centre+swimming / building / whitelist Podolí/Šutka/AXA/Slavia/Hloubětín/… mimo „koupaliště") → cooling „ac", outdoor → „water". **32 krytých AC bazénů** (z 91 pools), kategorie zůstává „pool" (ikona). Kanonická změna přímo v pipeline (žádný separátní soubor → žádné duplikáty). Započteno do headline → **969**. Frontend: `computeAcCount` + `venuesAcPools` (Bedřich). Ostatní kategorie beze změny (ověřeno). Ověřeno staging (banner 969), nasazeno live.
- **Přímé AC zdroje docházejí** → další kola = out-of-the-box / vědecká fáze.
- **Další na řadě:** úřady MČ (~22, do civic overlay „Veřejné budovy") → footprint join (brand→building polygon = víc AC jako plochy) → metodika cooling-refuge (Vídeň/Barcelona/Paříž).

### 2026-06-27 · kolo 3
- **✅ INTEGROVÁNO: KULTKKC komunitní/kulturní centra (210, tier-B)** – sloučena do stávajícího civic overlaye, který přejmenován **„Klimatizované čekárny" → „Klimatizované veřejné budovy"** (ordinace 68 + centra 210 = 278 bodů, default OFF). Ikona civic genericizována (lékařský kříž → budova se sloupy), popup kicker dle typu (Poliklinika / Komunitní centrum / Dům dětí a mládeže / …). `data/fetch_ipr_kultkkc_centra.py` → `civic-centra.geojson`, cron `ipr-kultkkc-centra.yml` (týdně). Frontend fold-in (fetchCivicCentra + sloučení source + relabel) udělal Bedřich. Ověřeno staging (toggle + render), nasazeno live.
- Tier-B, default OFF → nezahlcuje core AC view ani headline (**937 beze změny**, USP chráněn).
- **Pozn. – docházejí IPR ArcGIS low-hanging fruity.** Příště zvážit posun k out-of-the-box / vědecké fázi: kryté bazény split (AC haly, tier-A), footprint join brand→building polygon, metodika cooling-refuge (Vídeň/Barcelona/Paříž).
- **Další na řadě:** kryté bazény split (tier-A, upgrade z 75 pools) → úřady MČ (~22, tier-B do civic overlay) → out-of-the-box.

### 2026-06-27 · kolo 2
- **✅ INTEGROVÁNO: IPR KULTKKC knihovny (40 net-new)** okrajových MČ (z 84 knihoven v datasetu, dedup −44 vs MKP 108 do 150 m). Sloučeno do clusterovaného AC source jako kategorie „library" (cooling ac, tier A), započteno do headline → **937**. `data/fetch_ipr_kultkkc.py` → `libraries-kkc.geojson`, cron `ipr-kultkkc.yml` (týdně). Frontend integraci udělal Bedřich sám (fetchLibrariesKkc + normalizeLibraryKkc + count). Ověřeno staging (banner 937 + render), nasazeno live.
- Pozn.: **210 komunitních/kulturních zařízení** z KULTKKC (komunitní/kulturní centra, kluby seniorů, rodinná centra) = kandidát na měkčí tier-B AC vrstvu (invertovaný filtr) – budoucí kolo.
- **Další na řadě:** KULTKKC komunitní centra (210, tier-B AC, do overlay „čekárny"/civic) NEBO kryté bazény split (AC haly). Pozn.: metro vchody (346) a pumpy/studánky (vodní) jsou doplňkové, ne čistě AC → nižší priorita než tier-B AC.

### 2026-06-27 · kolo 1
- Založen tento log + hodinový cron (`7 * * * *`, session-only). Výchozí stav: 12 integrovaných zdrojů, headline 897.
- Zdroj poznání: 2 multi-agent sweepy (live cooling/temp + AC-max, dohromady 16 agentů, 168 kandidátů) – viz tabulky níže.
- **✅ INTEGROVÁNO: IPR Polikliniky (68)** jako overlay „Klimatizované čekárny" (default OFF, tier-B civic AC). `data/fetch_ipr_polikliniky.py` → `ac-civic.geojson`, cron `ipr-polikliniky.yml` (týdně). Ověřeno na staging (toggle + render), nasazeno na live.
- **Plán dalších kol (low-hanging fruit):** IPR KULTKKC knihovny (~180) → OSM metro vchody (346, upgrade z 57 centroidů) → IPR pumpy/studánky (94+215) → kryté bazény split.

---

## ✅ Integrované zdroje (živě na `main` / chladek.institutefektivity.cz)

| Zdroj | Soubor | Počet | cooling | Fetch | Obnova |
|---|---|---|---|---|---|
| OSM venues (kostely/bazény/pítka/fontány/shop_ac/parky) | venues.geojson | 1286 | natural/water/ac/shade | Overpass (build_venues.py) | ac-osm.yml (týdně) |
| IPR „Oázy chladu" pítka/fontány/koupání | (ve venues) | ~590 | water | IPR ArcGIS GeoJSON | (ve venues) |
| **IPR Kulturní zařízení** (galerie 168, muzea 105, divadla 94, kina 31, sály 33, instituty 13) | ac-culture.geojson | 523 (444 tier-A) | ac | IPR ArcGIS `FSV_CUR_OV_KULTZAR_B` (keyless) | ipr-kultzar.yml (týdně) |
| **AC budovy jako PLOCHY** (mall 32, hypermarket 20, DIY 10, obch. dům 7, IKEA 1) | ac-areas.geojson | 70 polygonů | ac | Overpass `out geom` (build_ac_areas.py) | ac-osm.yml (týdně) |
| **Brand-AC obchody** (drogerie 153, elektro 27) | ac-shops.geojson | 180 | ac | Overpass brand-guard (build_ac_shops.py) | ac-osm.yml (týdně) |
| **Golemio knihovny MKP** (+ živá otevírací doba) | libraries.geojson | 108 | ac | Golemio `/v2/municipallibraries` (klíč) | golemio-libraries.yml (denně) |
| **IPR KULTKKC knihovny** (okrajové MČ, net-new) | libraries-kkc.geojson | 40 | ac (kat. library) | IPR ArcGIS `FSV_CUR_OV_KULTKKC_B` (keyless) | ipr-kultkkc.yml (týdně) |
| Zelené/vodní plochy (parky/les/voda) | areas.geojson | 944 polygonů | shade/water | Overpass (build_areas.py) | (manuálně) |
| **ČHMÚ naměřená teplota** (9 pražských stanic) | temp-stations.geojson | 9 | – | opendata.chmi.cz „now" (keyless) | temp-stations.yml (hod.) |
| **Golemio cyklosčítače – teploty** (pouliční čidla) | temp-sensors.geojson | 25 | – | Golemio `/v2/bicyclecounters/temperatures` (klíč) | temp-sensors.yml (hod.) |
| IPR mlžítka | mlzitka.geojson | 44 | (overlay) | IPR ArcGIS `AGD_CUR_AGD_OCH_MLZITKA_B` | mlzitka.yml (týdně) |
| PID/ROPID metro stanice | metro.geojson | 57 | (overlay) | data.pid.cz stops.json | (statické) |
| **IPR polikliniky** (overlay „Klimatizované veřejné budovy") | ac-civic.geojson | 68 | (overlay, tier-B) | IPR ArcGIS `FSV_CUR_OV_ZDRAVPOLIKLINIKY_B` (keyless) | ipr-polikliniky.yml (týdně) |
| **IPR KULTKKC centra** (komunitní/kulturní, tentýž overlay) | civic-centra.geojson | 210 | (overlay, tier-B) | IPR ArcGIS `FSV_CUR_OV_KULTKKC_B` (keyless) | ipr-kultkkc-centra.yml (týdně) |
| Golemio kvalita ovzduší (17 stanic) | air-quality-stations.geojson | 17 | (overlay) | Golemio `/v2/airqualitystations` (klíč) | golemio-aq.yml (hod.) |
| ČHMÚ výstrahy + Open-Meteo (teplota/UV/AQI) | heat-warning.json / client | – | – | CAP feed / Open-Meteo (keyless) | heat-warning.yml (30 min) |

**Headline USP:** 969 = ac-areas 70 + ac-culture tier-A 444 + ac-shops 180 + libraries 108 + KULTKKC knihovny 40 + venues shop_ac 95 + kryté AC bazény 32.

---

## 🔶 Nalezené, neintegrované (kandidáti – low-hanging fruit nahoře)

| Kandidát | Endpoint / fetch | Počet | Tier | Pozn. |
|---|---|---|---|---|
| 🔬 Úřady MČ / magistrát | Overpass townhall + office=government | ~22–60 | B | civic AC do overlay „Veřejné budovy"; silný IE narativ „co má stát designovat". **Další na řadě.** |
| 🔬 Footprint join (brand→building) | Overpass: bod prodejny → enclosing `building=retail` polygon | – | – | víc AC podniků jako PLOCHY (uživatelův důraz „celý objekt = area"); out-of-the-box |
| **OSM metro vchody** | Overpass `railway=subway_entrance` | 346 | – | upgrade metra 57→346 (lepší „nejbližší"); cooling=natural, NE AC |
| IPR pumpy + studánky/prameny | IPR ArcGIS `..._PUMPY_B` (94) + `..._STUDANKYPRAMENY_B` (215) | 94+215 | – | rozšíření vodní vrstvy (chladná pitná voda) |
| IPR vodní plochy a toky (polygon) | IPR ArcGIS `..._VODNIPLOCHYTOKY_P` | 3526 | – | těžké → zjednodušit/bbox; „chlazení vodou" plochy |
| 🔬 Úřady MČ / magistrát | Overpass townhall + ruční kurace | ~22 | B | civic AC (do overlay „Veřejné budovy"); silný IE narativ „co má stát designovat" |
| 🔬 Micro-AC řetězce (McDonald's/KFC/BK/Starbucks/Costa) | Overpass `brand:wikidata` | ~150 | B | default-OFF toggle, chrání USP |
| 🔬 sensor.community / Netatmo | data.sensor.community / api.netatmo getpublicdata | ~22 / ? | – | občanská teplotní čidla (sun-bias, jen jako delta) |
| 🔬 Koupací voda – bezpečnost | koupacivody.cz / hygpraha.cz (scrape) | ~9 | – | badge „zákaz koupání" k IPR koupání |

---

## ⛔ SKIP / 💀 MRTVÉ (ať se znovu nehoní)

- ⛔ OSM `air_conditioning=yes` – už používáme jako booster (shop_ac), řídké/zkreslené, ne jako brána.
- ⛔ Banky / pošty – nízká refuge hodnota (malý půdorys, krátké hodiny), ředí USP.
- ⛔ Czech POINT – bez open GPS exportu, překryv s úřady/poštami.
- ⛔ Hotely / kanceláře – slabý veřejný přístup.
- ⛔ Fitness/gyms – placené/členské, ne walk-in.
- ⛔ Lékárny / variety stores (Action/Tedi) – malý půdorys, clutter.
- ⛔ IPR městské budovy bulk `SED_CUR_SED_BUDOVA_ENO_P` (2292) – většinou neveřejné.
- ⛔ MHMP POI multilayer – nejasná licence, duplikát KULTZAR.
- ⛔ DPP klimatizované linky tram/bus – pohyblivé, ne venue (max info na o-projektu).
- ⛔ Univerzity bulk (289) – slabý veřejný přístup (jen pár akad. knihoven).
- ⛔ Brand store-locator scrapery – OSM `brand:wikidata` pokryje ~95 % bez klíče.
- ⛔ Satelitní LST (Sentinel-3/Landsat) – povrchová teplota ≠ teplota vzduchu.
- 💀 Golemio microclimate – poslední data 2026-04-07, nereportuje.
- 💀 TMEP.cz / Weather Underground – zavřený přístup (per-station klíč owner).

---

## Strategie (jak dosáhnout lepších výsledků)

1. **Low-hanging fruit (kola 1–4):** dotáhnout keyless IPR ArcGIS vrstvy (polikliniky, KULTKKC, pumpy/studánky) a OSM upgrades (metro vchody) – stejný pattern, který už máme. Každá je 1 fetch skript + 1 overlay/merge.
2. **Out-of-the-box (kola 5+):** split krytých bazénů, ruční kurace úřadů, micro-AC toggle, občanská čidla jako „microklima delta". Footprint-join (brand POINT → `building=retail` polygon), aby víc AC budov bylo PLOCHA, ne bod.
3. **Profesionálně-vědecky:** než přidám další třídu, sežeň metodiku z veřejných zdrojů (jak Vídeň „Cooles Wien", Barcelona „refugis climàtics", Paříž „îlots de fraîcheur" definují a publikují cooling-refuge open data; ISO/odborné definice „veřejně přístupné klimatizované"). Pak aplikuj jejich klasifikaci na pražská data. Vést tiered confidence (A garantováno / B pravděpodobné / C reportováno).
4. **Advocacy hook (IE):** chybějící data (teploty z mallů, klima v metru od DPP, registr veřejných budov s AC) = obsah na o-projektu „co by měl stát/Praha otevřít a designovat".
