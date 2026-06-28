// Veškerý textový obsah webu Chládek na jednom místě.
// Čeština, IE think-tank hlas, povinná česká typografie (en dash s mezerami " – ").
// Frontend spoléhá na názvy a typy exportů níže – neměň je, jen obsah.

export const site = {
  name: "Chládek",
  tagline: "Kam se v Praze schovat před horkem",
  metaDescription:
    "Mapa klimatizovaných a přirozeně chladných veřejných míst v Praze – obchoďáky, knihovny, kostely, bazény, pítka i parky. S živou venkovní teplotou a výstrahou před vedrem.",
  url: "https://chladek.institutefektivity.cz",
};

export const ui = {
  nav: { map: "Mapa", about: "O projektu" },
  filters: {
    ac: "Klimatizace",
    natural: "Přirozeně chladno",
    water: "Voda",
    shade: "Stín a parky",
  },
  liveTemp: {
    label: "Teplota v Praze",
    outsideNow: "Venku teď",
    measuredNow: "Naměřeno teď",
    loading: "Načítám teplotu…",
    failed: "Teplota nedostupná",
  },
  airQuality: {
    uvLabel: "UV index",
    aqiLabel: "Ovzduší",
  },
  airStations: {
    toggle: "Ovzduší (stanice)",
    updatedAt: "Aktualizováno",
    popupTitle: "Kvalita ovzduší",
  },
  // Živá naměřená teplota – DOM Markery (ČHMÚ stanice + pouliční čidla).
  temps: {
    toggle: "Teploty (živě)",
    stationTitle: "Naměřená teplota – ČHMÚ",
    sensorTitle: "Naměřená teplota – pouliční čidlo",
    measuredAtLabel: "Naměřeno v",
    sensorNote:
      "Pouliční čidlo – na přímém slunci může ukazovat víc než skutečná teplota vzduchu.",
  },
  // Overlay mlžítka (IPR Praha – Oázy chladu).
  mlzitka: {
    toggle: "Mlžítka",
    popupTitle: "Mlžítko",
  },
  // Overlay metro (PID / ROPID) – chládek pod zemí.
  metro: {
    toggle: "Metro (chládek pod zemí)",
    popupTitle: "Stanice metra",
    lineLabel: "Linka",
    refugeNote: "Pod zemí bývá v parnu chladněji.",
  },
  // Overlay klimatizované veřejné budovy (polikliniky + komunitní/kulturní centra) –
  // vnitřní útočiště volně přístupná v provozních hodinách.
  civic: {
    toggle: "Klimatizované veřejné budovy",
    popupNote: "Veřejně přístupné klimatizované místo – otevřené v provozních hodinách",
  },
  // Overlay značkové kavárny + rychlé občerstvení (tier-B mikro-útočiště) –
  // klimatizované provozovny pro rychlé osvěžení v otevírací době.
  cafe: {
    toggle: "Kavárny a občerstvení",
    popupNote: "Klimatizovaná provozovna – rychlé osvěžení v otevírací době",
  },
  locate: {
    button: "Najdi 3 nejbližší chládky",
    denied: "Polohu se nepodařilo zjistit",
  },
  // Edukační panel „Co dělat v horku" – spouštěč v chrome mapy + modal.
  heatGuide: {
    button: "Co dělat v horku",
    open: "Otevřít rady, co dělat v horku",
    title: "Co dělat v horku",
    intro:
      "Pár jednoduchých zásad, díky kterým vedro zvládnete bez újmy na zdraví. Když je nejhůř, najděte si nejbližší chládek na mapě.",
    close: "Zavřít",
    closeAria: "Zavřít rady, co dělat v horku",
    mapCta: "Najít nejbližší chládek na mapě",
    sourceNote:
      "Rady vycházejí z obecně uznávaných doporučení pro horké dny (SZÚ, WHO). Nenahrazují lékařskou pomoc – v nouzi volejte 155.",
  },
  popup: {
    coolingLabel: "Typ ochlazení",
    openingLabel: "Otevírací doba",
    freeYes: "Vstup zdarma",
    freeNo: "Vstupné",
    navigate: "Navigovat",
    sourceLabel: "Zdroj",
    // AC tier badge (autorita klimatizace).
    acTierA: "Klimatizováno",
    acTierB: "Vnitřní útočiště",
    // AC budovy (ac-areas).
    acAreaNote: "Klimatizovaná budova – volně přístupná v otevírací době",
    kindLabel: "Typ",
    // Prodejny.
    brandLabel: "Značka",
    // Bezbariérovost (kultura).
    bezbar: "Bezbariérový přístup",
  },
  // USP headline (viral hook) – počet se dopočítá z dat za běhu.
  usp: {
    headlineSuffix: "klimatizovaných veřejných míst v Praze",
    subtitle: "Jediná mapa, která ti ukáže, kam zdarma do klimatizace.",
  },
  attribution:
    "Data: © OpenStreetMap přispěvatelé (ODbL) · IPR Praha „Oázy chladu“ – pítka i mlžítka (CC BY) · IPR Praha – kulturní zařízení (ÚAP) · Městská knihovna v Praze / Golemio · Open-Meteo · ČHMÚ – výstrahy i naměřené teploty · Golemio (Operátor ICT) – stanice ovzduší i pouliční teplotní čidla · PID / ROPID – stanice metra · podklad © CARTO",
  footer: {
    byline: "Projekt Institutu efektivity",
    // One-line IE mission claim – co IE dělá a proč Chládek existuje.
    note: "Děláme práci, kterou má dělat stát – a děláme ji z dat. Chládek je důkaz, že z otevřených dat jde levně postavit veřejně užitečnou službu.",
    links: {
      ie: "institutefektivity.cz",
      source: "Zdrojový kód na GitHubu",
    },
  },
  // Banner při odvozené výstraze (oba JSON zdroje selhaly, fallback z teploty).
  heatWarning:
    "V Praze je teď horko (pocitově přes 31 °C). Hlídejte pitný režim a vyhledejte chládek.",
  // Banner při živé výstraze ČHMÚ (SIVS).
  heatWarningPrefix: "Výstraha ČHMÚ:",
  heatWarningSource: "Zdroj: ČHMÚ",
};

// ---------- Edukační obsah „Co dělat v horku" ----------
// Konkrétní, akční rady vycházející z obecně uznávaných doporučení pro horké dny
// (SZÚ / WHO). Žádné vymyšlené statistiky. Zobrazuje se v modálním panelu nad mapou.

export interface HeatTipGroup {
  icon: string; // jednoduchý emoji glyph (dekorativní, aria-hidden v UI)
  heading: string;
  tips: string[];
}

export interface HeatGuideContent {
  groups: HeatTipGroup[];
  // Zvýrazněný blok první pomoci – příznaky přehřátí + co dělat.
  emergency: {
    heading: string;
    intro: string;
    symptoms: string[];
    firstAid: string[];
    callLine: string;
  };
}

export const heatGuide: HeatGuideContent = {
  groups: [
    {
      icon: "💧",
      heading: "Pitný režim",
      tips: [
        "Pijte průběžně po celý den, i když nemáte žízeň – pocit žízně se v horku dostavuje pozdě.",
        "Nejlepší je voda nebo neslazený čaj. Vyhněte se alkoholu, kávě ve velkém a hodně slazeným nápojům – tělo odvodňují.",
        "Při velkém pocení doplňujte i minerály (minerálka, polévka, ovoce a zelenina s vysokým obsahem vody).",
        "Ledové nápoje pijte po menších doušcích – velké množství ledového naráz zatěžuje žaludek.",
      ],
    },
    {
      icon: "☀",
      heading: "Vyhněte se přímému slunci",
      tips: [
        "Náročnější aktivity a pobyt venku plánujte na ráno nebo večer. V nejteplejších hodinách (cca 11–17 h) zůstaňte ve stínu nebo uvnitř.",
        "Noste lehké, vzdušné a světlé oblečení z přírodních materiálů a pokrývku hlavy.",
        "Používejte opalovací krém s vysokým faktorem a sluneční brýle.",
        "Omezte fyzickou zátěž a sport na poledne – přesuňte je do chladnější části dne.",
      ],
    },
    {
      icon: "❄",
      heading: "Kam se schovat",
      tips: [
        "Vyhledejte klimatizované veřejné prostory – obchodní centra, knihovny, muzea nebo kostely. Mnoho z nich je zdarma.",
        "Pomůže i stín parku, blízkost vody, pítko nebo mlžítko. V parnu bývá chladněji i pod zemí, ve stanicích metra.",
        "Nejbližší chládek si najdete přímo na této mapě – stačí zapnout polohu.",
      ],
    },
    {
      icon: "🏠",
      heading: "Doma",
      tips: [
        "Přes den zatáhněte žaluzie a závěsy na osluněné straně a okna držte zavřená, aby horko nepřišlo dovnitř.",
        "Vyvětrejte naplno až večer a v noci, kdy venku teplota klesne.",
        "Osvěžte se vlažnou (ne ledovou) sprchou nebo studeným obkladem na zápěstí, krk a čelo.",
        "Místnost ochladí i ventilátor, ale při teplotách nad 35 °C samotný proud horkého vzduchu už nestačí – kombinujte ho se stínem a vodou.",
      ],
    },
    {
      icon: "🧒",
      heading: "Ohrožené skupiny",
      tips: [
        "Zvýšenou pozornost potřebují senioři, malé děti, těhotné, chronicky nemocní a lidé bez domova.",
        "Aktivně kontrolujte starší příbuzné a sousedy, kteří žijí sami – často si horko ani dehydrataci sami nepřipustí.",
        "Pozor na léky: některé zvyšují riziko přehřátí. Při pochybnostech se poraďte s lékařem nebo lékárníkem.",
      ],
    },
    {
      icon: "🚗",
      heading: "Nikdy v autě",
      tips: [
        "Nikdy nenechávejte děti ani zvířata v zaparkovaném autě – ani na chvilku a ani s pootevřeným oknem. Teplota uvnitř stoupá k životu nebezpečným hodnotám během pár minut.",
        "Pamatujte na zvířata i venku: zajistěte jim stín a dostatek vody, vycházky se psem plánujte na chladnější část dne.",
      ],
    },
  ],
  emergency: {
    heading: "Úžeh a úpal – poznejte je a zasáhněte",
    intro:
      "Přehřátí organismu je vážný stav, který může skončit i smrtí. Čím dřív zareagujete, tím líp.",
    symptoms: [
      "Bolest hlavy, závrať, slabost a malátnost",
      "Nevolnost nebo zvracení, rychlý tep",
      "Horká, zarudlá kůže; pocení může chybět",
      "Zmatenost, dezorientace až bezvědomí",
    ],
    firstAid: [
      "Přeneste postiženého do stínu nebo do chladu a uvolněte mu oblečení.",
      "Ochlazujte tělo – vlažnou vodou, studenými obklady na krk, podpaží a třísla, ovíváním.",
      "Je-li při vědomí, dejte mu pomalu pít vodu po menších doušcích.",
      "Při zmatenosti, bezvědomí nebo zvracení neváhejte a volejte záchrannou službu.",
    ],
    callLine: "V nouzi volejte 155 (záchranná služba) nebo 112.",
  },
};

export interface AboutSection {
  id: string;
  heading: string;
  // Volitelná úvodní „lead" věta sekce – větší, vystihuje pointu (skimmable).
  lead?: string;
  paragraphs: string[];
  // Volitelný pull-quote – úderná samostatná věta vhodná pro sdílení / marketing.
  pullquote?: string;
}

export const aboutHero = {
  title: "Jedna mapa. {{acCount}} míst, kam se schovat.",
  subtitle:
    "Chládek ukazuje klimatizovaná a chladná veřejná místa v Praze – a vznikl celý z otevřených dat, aniž by to město stálo jedinou korunu navíc. Praktická pomůcka pro horké dny a zároveň důkaz, co všechno už dnes z dat jde.",
  // Tlačítko zpět na mapu (CTA pod hero).
  cta: "Otevřít mapu",
};

export const aboutSections: AboutSection[] = [
  {
    id: "hook",
    heading: "Jedna mapa, kterou nemá nikdo jiný",
    lead:
      "Chládek ukazuje {{acCount}} veřejně přístupných klimatizovaných míst v Praze – plus vodu, stín a metro. Postavili jsme ho čistě z otevřených dat, aniž by to město stálo jedinou korunu navíc.",
    paragraphs: [
      "Když v Praze udeří vedro, většina lidí ví, že někam zaleze – do obchoďáku, do knihovny, do kostela, k pítku nebo do stínu parku. Málokdo ale ví, kde přesně je to nejbližší. Chládek to dává na jednu mapu: klimatizovaná a přirozeně chladná veřejná místa, živou venkovní teplotu, naměřené teploty z města i výstrahu před horkem. Otevřete ho v mobilu, zmáčknete „najdi nejbližší chládky“ a víte, kam jít.",
      "Takovou mapu pro Prahu nikdo jiný nemá. A nevznikla z nového rozpočtu ani z nové databáze – jen z chytrého poskládání dat, která už dnes volně existují. To je celý vtip: město nemuselo udělat nic nového, a přesto z jeho dat vznikla užitečná veřejná služba.",
    ],
    pullquote:
      "{{acCount}} klimatizovaných míst na jedné mapě. Žádná nová data, žádný nový rozpočet – jen otevřená data poskládaná dohromady.",
  },
  {
    id: "kdo-jsme",
    heading: "Kdo to postavil a proč",
    lead:
      "Chládek dělá Institut efektivity. Děláme práci, kterou má dělat stát – a děláme ji z dat.",
    paragraphs: [
      "Institut efektivity je think-tank zaměřený na efektivnější veřejnou správu. Ukazujeme, kde a jak může stát fungovat líp, levněji a víc pro lidi – a často to nejlepší doporučení je rovnou předvést na fungujícím příkladu, ne ho jen popsat ve studii.",
      "Chládek je přesně takový příklad. Je to živý důkaz, že z otevřených dat jde levně postavit veřejně užitečnou službu – za pár dní práce, bez veřejné zakázky, bez nového úřadu. Když to dokáže think-tank o pár lidech, dokáže to i město. Otázka není „jestli to jde“, ale „proč to ještě není“.",
    ],
    pullquote:
      "Když užitečnou mapu chladných míst zvládne think-tank o pár lidech za pár dní, není důvod, aby ji neměla Praha.",
  },
  {
    id: "vyzva",
    heading: "Výzva státu a Praze: otevřete data pořádně",
    lead:
      "Otevřená data fungují jen tehdy, když jsou kvalitní, reálná a živá. Chládek ukazuje, kde k tomu má Praha blízko – a kde ještě ne.",
    paragraphs: [
      "Otevřená data jsou informace zveřejněné ve strojově čitelné podobě, aby je kdokoli mohl volně použít – analyzovat, propojit nebo nad nimi postavit aplikaci. Rozdíl proti PDF na webu úřadu je zásadní: ze zveřejněného PDF nikdo službu nepostaví, z otevřeného datasetu ano. Město data jednou sebere a zveřejní – a pak nad nimi staví kdokoli: úřad, firma, student i think-tank. Sdílí se jednou, používá mnohokrát.",
      "Aby to ale fungovalo, nestačí data jen formálně „vyvěsit“. Musí být kvalitní, úplná, reálná a hlavně udržovaná v chodu. Datová sada, která se přestane aktualizovat, je k ničemu – a přesně na to jsme u Chládku narazili (viz níže). Naše výzva státu i Praze je proto konkrétní: zveřejňujte open data pořádně, ne na oko. Polohy a otevírací doby veřejných budov, pítka a mlžítka, měření ze senzorů – to všechno stejně vzniká při běžném provozu města a má defaultně směřovat ven jako živá otevřená data, ne zůstávat zamčené v interních systémech.",
      "A výzva nemíří jen na město. Velkou část dat o chladu drží soukromé subjekty – obchodní centra znají teplotu ve svých prostorách, dopravní podnik měří klima ve stanicích metra. Kdyby tato data, byť anonymizovaně a agregovaně, vtáhli do pražských datových platforem (jako je Golemio), vznikla by služba, na kterou dnes nikdo nedosáhne. Sdílení dat není ztráta konkurenční výhody – je to příspěvek k městu, ve kterém se v horku lépe žije, a často i dobrá vizitka.",
    ],
    pullquote:
      "Otevřená data nestačí jednou vyvěsit. Musí být kvalitní, reálná a živá – jinak je to jen PDF v jiném kabátě.",
  },
  {
    id: "evropa",
    heading: "Vídeň, Barcelona a Paříž to už mají",
    lead:
      "Mapa ochlazení jako oficiální městská služba nad otevřenými daty není sci-fi. Jinde v Evropě je standardem.",
    paragraphs: [
      "Vídeň provozuje program Cooles Wien a má v otevřených datech stovky pítek a mlžicích sprch. Barcelona zveřejnila síť „klimatických útočišť“ (refugis climàtics) jako stažitelný dataset – přes 500 míst s cílem, aby každý obyvatel měl jedno do deseti minut chůze, a vědomě do ní řadí i mikro-úkryty: obchody, knihovny, provozovny. Paříž s urbanistickým atelierem APUR zmapovala přes 1 400 „ostrovů chladu“ (îlots de fraîcheur), kde bývá o 2 – 4 °C chladněji než v okolních ulicích.",
      "A když se podíváme, co tato města do svých map řadí, je to skoro přesně to, co ukazuje Chládek. Paříž eviduje parky a zeleň, knihovny, muzea, klimatizované veřejné prostory, kostely, fontány, mlžítka a pítka – tedy stejné kategorie jako my. Barcelona pro vnitřní útočiště doporučuje klimatizaci nastavenou na 26 °C, volný přístup, místo k sezení a vodu zdarma. Chládek jsme proto postavili vědomě podle téže metodiky – a navíc u každého místa rozlišujeme spolehlivost: autoritativně klimatizováno vs. vnitřní útočiště.",
      "Ve všech těchto městech je mapa ochlazení oficiální službou postavenou nad otevřenými daty. Praha takovou mapu zatím nemá. Chládek ukazuje, že na ni má podklady – jen je potřeba je otevřít, propojit a udržovat živé.",
    ],
    pullquote:
      "Praha má na mapu chladných míst data. Vídeň, Barcelona i Paříž ji dávno mají jako oficiální službu – Praha zatím ne.",
  },
  {
    id: "z-jakych-dat",
    heading: "Z jakých dat mapa vzniká",
    lead:
      "Žádná magie – jen veřejné zdroje, ruční kurace a poctivé přiznání, čemu se dá věřit víc a čemu míň.",
    paragraphs: [
      "Páteří mapy je OpenStreetMap – komunitní, otevřená mapa světa, ze které čerpáme přes rozhraní Overpass. Doplňujeme ji autoritativními pražskými zdroji: kulturní zařízení z dat IPR Praha (muzea, kina, galerie, divadla – spolehlivá vnitřní útočiště s klimatizací), knihovny Městské knihovny v Praze přes Golemio (s živou otevírací dobou, takže mapa pozná „otevřeno teď“) a velké klimatizované budovy – obchodní centra, hypermarkety, obchodní domy – zakreslené jako celé plochy, ne jen tečky.",
      "Dataset systematicky rozšiřujeme po celých kategoriích, u kterých klimatizace plyne z podstaty provozu. Lékárny bereme z autoritativního registru SÚKL – léky se ze zákona uchovávají „do 25 °C“ (vyhláška 84/2008 Sb. + Český lékopis), takže v létě jsou prakticky vždy chlazené. Z OpenStreetMap přidáváme běžné supermarkety, bankovní pobočky, hotely i fitness. Tomu říkáme „kategorie implikuje klimatizaci“ – stejný princip, na kterém staví Paříž i Barcelona, a díky kterému roste počet míst do tisíců, ne stovek.",
      "Tahle skladba je důvod, proč Chládek ukazuje {{acCount}} spolehlivých klimatizovaných míst místo pár stovek náhodně otagovaných bodů. Místa navíc rozlišujeme do úrovní spolehlivosti: tam, kde je klimatizace autoritativně doložená, ukazujeme štítek „Klimatizováno“; tam, kde jde o ověřené vnitřní útočiště, štítek „Vnitřní útočiště“. Spoléháme tedy na kategorii a značku, ne jen na řídký a nahodilý tag v datech.",
      "Vodu doplňujeme z datasetu IPR Praha „Oázy chladu“ (licence CC BY) – pítka, kašny, fontány, místa ke koupání i mlžítka. Živou venkovní teplotu, UV index a kvalitu ovzduší bere Chládek z Open-Meteo (zdarma, bez registrace). Výstrahu před horkem tahá přímo z výstražné služby ČHMÚ (SIVS) – když platí, naskočí nahoře živý banner.",
      "Všechna data používáme v souladu s jejich licencemi a uvádíme je: © OpenStreetMap přispěvatelé (ODbL), IPR Praha „Oázy chladu“ a kulturní zařízení (CC BY / ÚAP), Městská knihovna v Praze / Golemio, SÚKL (Seznam lékáren), Open-Meteo, ČHMÚ, Golemio (Operátor ICT) a mapový podklad © CARTO. Otevřenost je pro nás závazek i v praxi – proto je i samotný Chládek otevřený a jeho zdrojový kód volně k nahlédnutí.",
    ],
  },
  {
    id: "namerena-teplota",
    heading: "Naměřená teplota – ne odhad, ale realita z města",
    lead:
      "Chládek neukazuje jen předpověď. Ukazuje skutečně naměřené teploty z pražských stanic – a s nimi i to, jak se Praha v parnu sama přehřívá.",
    paragraphs: [
      "Vedle živé předpovědi tahá Chládek reálně naměřenou teplotu vzduchu z oficiálních stanic ČHMÚ rozmístěných po Praze – bez klíče, jako otevřená data. Díky tomu na mapě uvidíte vnitroměstský rozdíl: zatímco okraje města zůstávají snesitelné, betonové centrum se peče výrazně víc. To je tepelný ostrov města, naměřený, ne odhadnutý.",
      "Doplňujeme ho o pouliční teplotní čidla z Golemia (cyklosčítače). Ta na přímém slunci ukazují víc než skutečná teplota vzduchu – a my to u nich poctivě označujeme, místo abychom dělali, že měříme přesněji, než ve skutečnosti jde. I to patří k tomu dělat data poctivě.",
    ],
    pullquote:
      "Mezi okrajem Prahy a rozpáleným centrem bývá i několik stupňů. Chládek ten rozdíl nehádá – měří ho.",
  },
  {
    id: "limity",
    heading: "Kde jsou limity – a proč o nich mluvíme nahlas",
    lead:
      "Limity Chládku nejsou ostuda, kterou bychom schovávali. Jsou samy o sobě sdělením o stavu otevřených dat v Praze.",
    paragraphs: [
      "Buďme upřímní v jedné věci, na které stojí důvěryhodnost celé mapy: Chládek nezná reálnou vnitřní teplotu jednotlivých míst. Žádný pražský obchoďák ani knihovna teplotu ve svých prostorách veřejně nezveřejňuje – řídicí systémy budov jsou neveřejné a taková data prostě neexistují. Proto u žádného místa nenajdete vymyšlené „uvnitř 21 °C“. Ukazujeme jen to, co je ověřitelné: naměřenou venkovní teplotu a štítek typu ochlazení.",
      "Druhý limit je v tom, jak nahodile jsou data o klimatizaci v OpenStreetMap. Tag klimatizace má jen zlomek míst, která jsou ve skutečnosti klimatizovaná – kdybychom mapu postavili jen na surovém výpisu, vyšlo by z toho absurdní zkreslení, kde fast food má klimatizaci uvedenou a velká knihovna ne. Právě proto stavíme na autoritativních kategoriích a značkách a doplňujeme ruční kurátorskou vrstvu – a právě ta je nejnáročnější částí projektu.",
      "A do třetice konkrétní limit, který sedí přesně do příběhu této mapy: s Golemiem jsme udělali první krok a umíme zapnout živé stanice kvality ovzduší. Chtěli jsme odtud tahat i pražskou síť mikroklimatických senzorů (teplota po městě). Jenže ta aktuálně nereportuje – poslední data jsou z dubna 2026. „Živou teplotu po městě“ tedy zatím postavit nejde, ne kvůli technologii, ale protože data prostě netečou. To je přesně ten případ, proč nestačí data jednou otevřít, ale je potřeba je udržovat živá. Jakmile senzory začnou znovu reportovat, vrstvu přidáme.",
      "Pokud Chládek poslouží jako argument, proč má smysl tato data otevřít, sdílet a hlavně udržovat v chodu, splní svůj hlavní účel – bez ohledu na to, kolik lidí si v něm nakonec najde cestu k pítku.",
    ],
    pullquote:
      "To, že v Praze nejde spolehlivě zjistit, kde se schladit, není problém technologie. Je to problém dat, která nikdo nesdílí pořádně.",
  },
];
