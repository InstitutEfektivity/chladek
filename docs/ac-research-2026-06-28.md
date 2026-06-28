# Deep-research: rozšíření datové základny klimatizovaných míst (Praha)

> Výstup multi-agent deep-research (28. 6. 2026). Zadání TK: „evidujeme jen 969 klimatizovaných míst, reálně jich jsou tisíce – udělej research, který je odhalí, a nastav cestu, jak je systematicky vytěžit i nadále." Doplněno vlastním měřením OSM (Bedřich).

---

## Finální report – rozšíření mapy Chládek (klimatizovaná místa v Praze)

**Projekt:** Chladek-OpenData-Mapa (IE open-data showcase, [chladek.institutefektivity.cz](https://chladek.institutefektivity.cz))
**Stav mapy dnes:** 969 míst
**Cíl:** systematicky a opakovatelně rozšířit počet spolehlivě klimatizovaných / chladných veřejných míst v Praze
**Datum:** 28. 6. 2026

---

### 1) Tabulka kategorií

Seřazeno od nejlepší příležitosti (vysoký počet × spolehlivost × veřejná přístupnost) dolů.

| Kategorie | Odhad počtu v Praze | Je AC pravidlem? | Opora pro předpoklad (norma / certifikace / provozní standard) | Spolehlivost | Vhodnost pro VEŘEJNOU mapu |
|---|---|---|---|---|---|
| Nákupní centra / galerie | 60+ velkých OC (uvnitř desítky–stovky obchodů s vlastní AC) | Ano | Centrální VZT/HVAC jako stavební standard krytých galerií (potvrzeno Médiář); volný vstup | vysoká | Výborná – jádro mapy, volně přístupné |
| Hotely 4★ a 5★ | 4★: 262, 5★: 49 (ČSÚ 2022) | Ano | Mezinárodní standard 4★/5★ = AC pokojů i společných prostor | vysoká | Dobrá – lobby/recepce přístupné; pokoje ne |
| Supermarkety / hypermarkety (Albert 68, Billa 45, Lidl 25, Penny 25, Kaufland 8, Tesco ~32, Globus 3) | ~206 (součet, agregátor mapaobchodu.cz – *neověřeno proti oficiálním locatorům*) | Ano (u hyper/super); Tesco Expres ne vždy | Chladicí provoz + plocha + komfort; řetězcový standard | vysoká (Tesco Expres střední) | Výborná – volně přístupné |
| Lékárny | 323 (ÚZIS 31.12.2024) / 340 (SÚKL 26.6.2026, *vlastní výpočet z CSV*) | Ne formálně; de-facto ano | Vyhláška 84/2008 Sb. § 21 odst. 1 – výsledková povinnost dodržet teplotu dle SmPC (drtivě „do 25 °C", Český lékopis pokojová teplota 15–25 °C) → v létě fakticky AC | vysoká (právní rámec); střední (přesný počet) | Výborná – volně přístupné, hustá síť |
| Multiplexová kina (Cinema City 6, CineStar 2, Premiere Cinemas 1) | ~9 multiplexů | Ano | Řetězcový standard multikin (potvrzeno) | vysoká | Dobrá – přístupné v provozní době |
| Fast-food (McDonald's 35; KFC/Burger King *jen ČR, ne Praha*) | McD 35 v Praze; KFC ~105 a BK 50 jen ČR | Ano | Provozní standard sítí | vysoká (McD); střední (KFC/BK) | Dobrá – volně přístupné |
| Drogerie (dm 51, Teta 33, Rossmann 19) | ~103 (mapaobchodu.cz) | dm/Rossmann ano; malé Teta / „TOP drogerie" ne vždy | Moderní retail jednotky, často v OC | vysoká (dm/Rossmann); střední (Teta) | Výborná – volně přístupné |
| Fitness (Form Factory + The Gym) | 32 klubů v Praze (oficiální web) | Ano | Provozní standard fitness | vysoká | Střední – přístup členům/za poplatek |
| Banky (ČS 79, Raiffeisen ~72*, ČSOB 52) | ČS 79, ČSOB 52, Raiffeisen 72 (*nadhodnoceno?*), Air Bank 8, Moneta ~14, KB ~40–60* | Ano | Komfortní bankovní pobočky | vysoká (AC); střední/nízká (počty u KB, Moneta, Raiffeisen) | Střední – přístupné v provozní době |
| Operátoři (Vodafone 26, O2 ~20–30, T-Mobile 15) | ~60–70 | Ano | Moderní prodejny operátorů, často v OC | střední (rozkolísané zdroje) | Dobrá – volně přístupné |
| Elektro (Datart 11, Alza – jen kamenné) | Datart 11; Alza jednotky kamenných (z 43 v ČR); AlzaBoxy NE | Ano (kamenné); AlzaBoxy ne | Elektroprodejny v OC/retail parcích | vysoká (Datart); střední (Alza) | Dobrá – AlzaBoxy vyloučit (venkovní) |
| Muzea / galerie | desítky (*přesný počet neuveden*) | NE plošně | AC jen u moderních budov (Nová budova NM, Veletržní palác); památkové paláce ne | nízká | Střední – jen ověřené moderní budovy |
| Kanceláře třídy A | nízké/střední stovky budov (*odhad*); ~2,9 mil. m² plochy | Ano (definice třídy A + BREEAM/LEED HVAC) | Klimatizace = tržní znak třídy A; BREEAM Hea 02 / LEED ePM1 50 % | vysoká (AC); přístupnost nízká | Slabá – jen lobby/atrium, patra zavřená (viz tier-B) |
| Parfumerie (Notino) | jednotky (z 7 v ČR) | Ano | Prémiové parfumerie | střední | Marginální – zanedbatelný přínos |

---

### 2) Datové zdroje a metody vytěžení

#### (a) Přímý signál AC

**OpenStreetMap – tag `air_conditioning=*`**
- Co umí: de-facto standardní tag přidávaný přímo na objekty (restaurace, kina, hotely, obchody, knihovny). Hodnoty `yes`/`no`. Jediný zdroj s **explicitním** AC příznakem napříč komerčním i veřejným sektorem.
- Jak se dotazuje: Overpass API / Overpass Turbo. Nástřel QL pro Prahu:
```overpassql
[out:json][timeout:120];
area["name"="Praha"]["admin_level"="6"]->.praha;
(
  node["air_conditioning"="yes"](area.praha);
  way["air_conditioning"="yes"](area.praha);
  relation["air_conditioning"="yes"](area.praha);
);
out center tags;
```
- URL: `https://overpass-api.de/api/interpreter` (POST s dotazem); wiki `https://wiki.openstreetmap.org/wiki/Key:air_conditioning`
- AC: **přímo** v datech. **ZMĚŘENO 28. 6. 2026 (mirror kumi.systems, bbox Praha): jen 236 objektů** (189 nodes, 46 ways, 1 relation) → potvrzuje, že ručně tagovaná data sama nestačí; hlavní páka je heuristika (b).

#### (b) „Kategorie implikuje AC" heuristika

Celá kategorie se zařadí jako chladná bez ověřování jednotlivých objektů (model Paříž – názvy kategorií „klimatizovaná NEBO přirozeně chladná muzea/knihovny", „přirozeně chladné kostely"). **Klíčové: OSM nese tyto kategorie už se souřadnicemi** (`amenity=pharmacy`, `shop=supermarket`, `shop=mall`, `amenity=cinema`, `amenity=fast_food`, `leisure=fitness_centre`, `tourism=hotel`, `amenity=bank`, `shop=chemist`…) → žádný geocoding.

**SÚKL – Seznam lékáren (otevřená data)**
- Co umí: úplný registr lékáren, 19 polí (NAZEV, MESTO, ULICE, PSC, TYP_LEKARNY, POHOTOVOST, otevírací doba…). Měsíční aktualizace, CSV (win-1250, oddělovač `;`).
- Jak se dotazuje: stažení ZIP/CSV, filtr `MESTO ~ "Praha"`.
- URL: `https://opendata.sukl.cz/?q=katalog/seznam-lekaren` (snapshot `https://opendata.sukl.cz/soubory/SOD20260626/LEKARNY20260626.zip`)
- AC: **odvozeno z kategorie** (právní rámec teploty ≤25 °C, vyhláška 84/2008 Sb. § 21). **Chybí GPS** → nutný geocoding ~340 adres (ČÚZK RÚIAN / Nominatim / Mapy.cz). Pozn.: OSM `amenity=pharmacy` je rychlejší cesta (GPS uvnitř), SÚKL je autoritativní doplněk pro úplnost.

**ČSÚ – Kapacita ubytovacích zařízení (hotely)**
- Co umí: počty hotelů dle tříd v Praze (5★ 49, 4★ 262, 3★ 210).
- URL: `https://csu.gov.cz/pha/kapacita-a-rozmisteni-ubytovacich-zarizeni-v-hl-m-praze`
- AC: **odvozeno z kategorie** (4★/5★ standard). ČSÚ je agregát – konkrétní adresy/GPS z OSM `tourism=hotel` + `stars=4/5`.

**Wikipedia – seznam nákupních center / muzeí v Praze**
- Co umí: výčet OC (60+) a muzeí; orientační seznam, ne GPS.
- URL: `https://cs.wikipedia.org/wiki/Seznam_nákupních_center_v_Praze`
- AC: OC **odvozeno z kategorie** (HVAC standard). Muzea NE plošně – jen moderní budovy.

**BREEAM veřejný registr (kanceláře třídy A)**
- Co umí: veřejný výpis certifikovaných budov, filtr Country = Czechia, name + location, mapový pohled. Výhrada client confidentiality (část chybí).
- URL: `https://tools.breeam.com/projects/explore/buildings.jsp`; doplňkově `https://www.pragueoffices.com` (500+ budov)
- AC: **odvozeno z kategorie/certifikace** (BREEAM Hea 02 / LEED ePM1 50 %). Pozn.: certifikační čísla (>1 030) jsou za celou ČR – nutný geo-filtr na Prahu.

#### (c) Store-locatory řetězců

**mapaobchodu.cz – hlavní scrapovatelný agregátor**
- Co umí: jednotná per-Praha struktura pro 19+ řetězců (Albert, Billa, Kaufland, Lidl, Penny, Tesco, Globus, dm, Rossmann, Teta, Datart, O2, T-Mobile, Vodafone, banky). Seznam poboček s adresami.
- Jak se dotazuje: scraping URL schématu `/pobocky/{retezec}/mesto/praha/`.
- URL: `https://www.mapaobchodu.cz/mesto/praha/k/supermarkety-a-hobby-markety/`
- AC: **odvozeno z kategorie**. Pozn.: data třetí strany, nemusí být 100 % aktuální → křížově ověřit s oficiálními locatory.

**Oficiální store-locatory (autoritativní doplněk):** kaufland.cz, dm.cz/store, albert.cz/prodejny, lidl.cz/prodejny, alza.cz/seznam-prodejen-a-alzaboxu (rozlišuje prodejnu vs box – AlzaBoxy vyloučit), mcdonalds vyhledávač atd. Většina nabízí adresy, část i GPS.

**Vzor evropských měst (metodika, ne zdroj dat):** Paříž publikuje cool spaces jako open-data dataset synchronizovaný **denně** z existujících datasetů zařízení (opendata.paris.fr). Vídeň „Coole Zonen" jako vrstva v městské mapě pod CC-BY, kritérium „bez nutnosti konzumace". Barcelona „microrefugis" = opt-in program pro lékárny/obchody. **Přenositelný princip: negenerovat ručně, ale denně syncovat z hotových datasetů + OSM.**

---

### 3) Doporučený systematický pipeline

Navazuje na současnou architekturu Chládku: **GitHub Actions cron → stáhne data → commitne JSON snapshot → frontend čte snapshot**. Každý nový zdroj = jeden krok ve scheduled workflow, který zapíše svůj dílčí JSON; merge skript je sloučí do hlavního snapshotu s deduplikací (podle GPS + názvu).

**Obecný tok pro každý zdroj:** zdroj → filtr/heuristika (Praha + kategorie) → geocoding (pokud chybí GPS) → dedup → dílčí JSON → merge do snapshotu → commit → frontend.

#### Pořadí integrace (low-hanging fruit nejdřív)

| Krok | Zdroj | Filtr/heuristika | Odhad přidaných míst | Náročnost |
|---|---|---|---|---|
| 1 | OSM `air_conditioning=yes` (Overpass) | přímý tag, oblast Praha | 236 (změřeno; po deduplu méně) | nízká – GPS už v datech, žádný geocoding |
| 2 | OSM kategorie (pharmacy/supermarket/mall/cinema/fast_food/fitness/hotel/bank) | kategorie implikuje AC | stovky (GPS v datech) | nízká – GPS už v datech |
| 3 | Store-locatory + SÚKL (doplnění toho, co OSM nemá) | kategorie implikuje AC | ~300–450 | střední – scraping + geocoding adres |
| 4 | Wikipedia OC + ČSÚ hotely 4★/5★ (kurátorství) | kategorie standard | ~60 OC + ~310 hotelů | střední – geocoding, u OC ruční kontrola |
| 5 | Multiplexy + McDonald's + fitness (doplnění) | řetězcový standard | ~76 | nízká |
| 6 | Banky (ČS, ČSOB, Air Bank…) | kategorie | ~150–250 | střední – počty ověřit |
| 7 | BREEAM registr / pragueoffices (kanceláře třídy A) | certifikace, geo-filtr Praha | nízké/střední stovky (tier-B) | vysoká – geo-filtr, confidentiality mezery |

**Kumulativně po krocích 1–5:** řádově **1 200–1 300 nových míst** nad současných 969 (před deduplikací).

#### TIER doporučení

**Tier-A „Klimatizováno" (autoritativní, default zapnuto):**
OSM `air_conditioning=yes`; nákupní centra / galerie; supermarkety + hypermarkety (mimo Tesco Expres); drogerie dm + Rossmann; multiplexová kina; McDonald's (+ KFC/BK po zjištění pražských adres); hotely 4★/5★ (pozn. „klimatizované lobby/recepce"); lékárny (právní rámec ≤25 °C); Datart, operátoři, banky.

**Tier-B „Vnitřní útočiště" (nižší jistota, default vypnuto / samostatná vrstva s disclaimerem):**
Kanceláře třídy A (jen veřejné lobby/atrium, pracovní doba, řízený přístup); muzea/galerie v památkových budovách; Teta „TOP drogerie" / malé formáty; Tesco Expres; fitness (přístup za poplatek/členům).

---

### Mezery a nejistoty

- **OSM pokrytí kategorií (univerzum) neproměřeno:** přímý tag `air_conditioning=yes` = 236 (změřeno). Bulk count přes 10 kategorií 28. 6. nedoběhl (Overpass instance overpass-api.de timeout, mirror kumi.systems po pár dotazech rate-limit) → počty per kategorie doměřit při stavbě (off-peak, vlastní throttling, případně Geofabrik extrakt místo live API).
- **SÚKL 340 pražských lékáren (unverified):** vlastní výpočet z CSV. ÚZIS 323 je potvrzené – brát jako spodní hranici.
- **KFC a Burger King (jen ČR, ne Praha):** pražské počty nezjištěny (KFC ~105 ČR, BK 50 ČR). Dohledat z locatorů.
- **Banky – KB, Moneta, Raiffeisenbank (low):** pražské počty rozkolísané/nadhodnocené. Ověřit na oficiálních locatorech.
- **Kanceláře třídy A – počet budov (odhad):** reporty uvádějí jen m² (~2,9 mil. m²), ne počet objektů. Certifikační čísla za celou ČR – nutný geo-filtr na Prahu.
- **Muzea – přesný počet a AC stav jednotlivě (low):** AC jen u moderních budov, nutné individuální ověření.
- **Pražská městská open-data (IPR / opendata.praha.eu) nevytěžena:** research tento dílčí úhel vrátil tenký – nejpřímější cesta pro veřejnou (městskou) vrstvu mapy analogicky pařížskému dennímu syncu. Doporučena samostatná rešerše.
- **Geocoding ~700+ adres:** většina ne-OSM zdrojů (SÚKL, mapaobchodu, ČSÚ) nemá GPS. Nutný spolehlivý geocoder (ČÚZK RÚIAN doporučen pro CZ adresy) – ošetřit chybovost a ruční kontrolu nejednoznačných adres.

---

*Metodická pozn.: tento výstup vznikl tvrzení-po-tvrzení verifikovaným multi-agent rešeršem; čísla označená kurzívou jako neověřená brát jako orientační. Surová data (per-úhel findings + verifikace) v session transcriptu workflow `chladek-ac-research`.*
