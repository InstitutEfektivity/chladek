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
    loading: "Načítám teplotu…",
    failed: "Teplota nedostupná",
  },
  locate: {
    button: "Najdi 3 nejbližší chládky",
    denied: "Polohu se nepodařilo zjistit",
  },
  popup: {
    coolingLabel: "Typ ochlazení",
    openingLabel: "Otevírací doba",
    freeYes: "Vstup zdarma",
    freeNo: "Vstupné",
    navigate: "Navigovat",
  },
  attribution:
    "Data: © OpenStreetMap přispěvatelé (ODbL), Golemio, Open-Meteo, ČHMÚ",
  footer: {
    byline: "Projekt Institutu efektivity",
    note: "Ukázka toho, co umí otevřená data, když je někdo poskládá do užitečné služby.",
    links: {
      ie: "institutefektivity.cz",
      source: "Zdrojový kód na GitHubu",
    },
  },
  heatWarning:
    "Dnes platí výstraha ČHMÚ před vysokými teplotami. Hlídejte pitný režim a vyhledejte chládek.",
};

export interface AboutSection {
  id: string;
  heading: string;
  paragraphs: string[];
}

export const aboutHero = {
  title: "O projektu Chládek",
  subtitle:
    "Praktická mapa, kam se v horku schovat – a zároveň ukázka, co všechno dnes umožňují otevřená data města.",
};

export const aboutSections: AboutSection[] = [
  {
    id: "proc-vznikl",
    heading: "Proč Chládek vznikl",
    paragraphs: [
      "Když v Praze udeří vedro, většina lidí ví, že někam zaleze – do obchoďáku, do knihovny, do kostela, k pítku nebo do stínu parku. Málokdo ale ví, kde přesně je nejbližší takové místo. Chládek to dává na jednu mapu: klimatizovaná a přirozeně chladná veřejná místa v Praze, doplněná o živou venkovní teplotu a výstrahu před horkem. Otevřete ho v mobilu, zmáčknete „najdi nejbližší chládky“ a víte, kam jít.",
      "Chládek ale není jen praktická pomůcka. Postavili jsme ho v Institutu efektivity záměrně jako ukázku – chtěli jsme na konkrétním, hmatatelném příkladu předvést, co se dá vytvořit z dat, která už dnes veřejně existují, aniž by to stálo město jedinou korunu navíc. Užitečná veřejná služba tu nevznikla z nového rozpočtu ani z nové databáze, ale z chytrého poskládání toho, co je už volně k dispozici.",
    ],
  },
  {
    id: "vize-open-data",
    heading: "Proč se vyplatí stavět nad otevřenými daty",
    paragraphs: [
      "Otevřená data jsou informace, které úřad nebo organizace zveřejní ve strojově čitelné podobě tak, aby je kdokoli mohl volně použít – analyzovat je, propojit s jinými daty nebo nad nimi postavit aplikaci. Není to PDF schované na webu úřadu, ale data v podobě, se kterou umí pracovat počítač i vývojář. Rozdíl je zásadní: ze zveřejněného PDF nikdo službu nepostaví, z otevřeného datasetu ano.",
      "Smysl otevřených dat je jednoduchý. Město data jednou sebere a zveřejní, a pak nad nimi může stavět kdokoli – úřad, firma, student, nezisková organizace nebo think-tank. Místo aby každý sbíral stejné informace znovu a draze, sdílí se jednou a používají se mnohokrát. Vznikají tak služby, na které by samo město nikdy nemělo kapacitu ani je nenapadly. Chládek je přesně takový případ: město nemuselo udělat nic nového, a přesto díky jeho datům vznikla užitečná věc.",
      "Pro veřejnou správu z toho plyne jasné doporučení. Data, která stejně vznikají při běžném provozu města – polohy veřejných budov, jejich otevírací doby, umístění pítek, měření ze senzorů – mají defaultně směřovat ven jako otevřená data, ne zůstávat zamčená v interních systémech. Náklad je jednorázový, užitek opakovaný a nepředvídatelný. Efektivní stát nedělá všechno sám; vytváří podmínky, aby užitečné věci mohli dělat i ostatní. Otevřená data jsou jedním z nejlevnějších nástrojů, jak toho dosáhnout.",
    ],
  },
  {
    id: "z-jakych-dat",
    heading: "Z jakých dat mapa vzniká",
    paragraphs: [
      "Páteří mapy je OpenStreetMap – komunitní, otevřená mapa světa, ze které čerpáme přes rozhraní Overpass. Z pražských dat jsme získali přibližně 223 míst přímo označených tagem klimatizace, 248 pítek, 100 knihoven, 35 obchodních center, 31 kin, 298 kostelů a 134 bazénů a koupališť. To je solidní základ, ale ne celý příběh – viz limity níže.",
      "OpenStreetMap doplňujeme ruční kurátorskou vrstvou. Procházíme místa, kde je klimatizace prakticky jistá – velké obchoďáky, muzea, plavecké haly, hlavní pobočky knihoven – a přidáváme je ověřeně, i když je v datech nikdo neoznačil. Tahle ruční práce je to, co odlišuje použitelnou mapu od náhodného výpisu. Doplňkově sáhneme po datech z Golemia (Pražská datová platforma) tam, kde dávají přesnější polohy a otevírací doby.",
      "Živou venkovní teplotu bere Chládek z Open-Meteo – meteorologické služby, která data poskytuje zdarma a bez registrace. Díky tomu vidíte aktuální kontrast: venku je třeba 33 °C, zatímco vybraná místa nabízejí chládek. Když ČHMÚ vydá výstrahu před vysokými teplotami, zobrazí se nahoře varovný banner.",
      "Všechna data používáme v souladu s jejich licencemi a uvádíme je: © OpenStreetMap přispěvatelé (licence ODbL), Golemio / Pražská datová platforma, Open-Meteo a ČHMÚ. Otevřenost dat je pro nás závazek i v praxi – proto je i samotný Chládek otevřený a jeho zdrojový kód k nahlédnutí.",
    ],
  },
  {
    id: "jaka-data-chceme",
    heading: "Jaká data bychom po Praze chtěli",
    paragraphs: [
      "Chládek šlo postavit i s dnešními daty – ale mohl být výrazně lepší, kdyby Praha sdílela víc. Nejvíc by pomohly tři věci. Za prvé: ověřené polohy a aktuální otevírací doby veřejných budov s klimatizací, dnes roztroušené v desítkách neslučitelných systémů. Za druhé: kompletní a udržovaná evidence pítek a mlžítek, která jako ucelený otevřený dataset prakticky chybí, přestože v horku jde o klíčovou infrastrukturu. Za třetí: reálné teploty z městských senzorů v otevřené, snadno použitelné podobě, aby mapa mohla ukazovat, kde je ve městě právě teď nejchladněji.",
      "Výzva ale nemíří jen na město. Velkou část dat o chladu drží soukromé subjekty – obchodní centra znají teplotu ve svých prostorách, dopravní podnik měří klima ve stanicích metra. Kdyby tato data, byť anonymizovaně a agregovaně, sdíleli do pražských datových platforem (jako je Golemio), vznikla by služba, na kterou dnes nikdo nedosáhne. Sdílení dat není ztráta konkurenční výhody; je to příspěvek k městu, ve kterém se v horku lépe žije – a často i dobrá vizitka.",
      "Že to jde, ukazují jiná evropská města. Vídeň provozuje program Cooles Wien a v městské mapě má jako otevřená data zanesené stovky pítek a mlžicích sprch. Barcelona zveřejnila síť „klimatických útočišť“ (refugis climàtics) jako stažitelný otevřený dataset – přes 500 míst s cílem, aby každý obyvatel měl jedno do deseti minut chůze. Paříž buduje „ostrovy chladu“ (îlots de fraîcheur) a stovky „klimatických oáz“ dostupných během veder. Ve všech těchto případech je mapa ochlazení oficiální službou města postavenou nad otevřenými daty. Praha zatím takovou mapu nemá – Chládek ukazuje, že na ni má podklady, jen je potřeba je otevřít a propojit.",
    ],
  },
  {
    id: "limity",
    heading: "Jak funguje současné řešení a kde jsou limity",
    paragraphs: [
      "Buďme upřímní v jedné věci, na které stojí důvěryhodnost celé mapy: Chládek nezná reálnou vnitřní teplotu jednotlivých míst. Žádný pražský obchoďák ani knihovna teplotu ve svých prostorách veřejně nezveřejňuje – řídicí systémy budov jsou neveřejné a taková data prostě neexistují. Proto u žádného místa nenajdete vymyšlené „uvnitř 21 °C“. Místo toho ukazujeme to, co je ověřitelné: živou venkovní teplotu a štítek typu ochlazení – klimatizace, přirozený chlad, voda, nebo stín.",
      "Druhý limit je v tom, jak nahodile jsou data o klimatizaci v OpenStreetMap. Tag klimatizace má jen zlomek míst, která jsou ve skutečnosti klimatizovaná – mezi knihovnami ho má sotva každá stá, přestože klimatizované jsou téměř všechny. Kdybychom mapu postavili jen na surovém výpisu z dat, vyšlo by z toho absurdní zkreslení, kde fast food má klimatizaci uvedenou a velká knihovna ne. Právě proto přidáváme ruční kurátorskou vrstvu – a právě proto je tahle vrstva nejnáročnější částí projektu.",
      "Tyto limity nejsou ostuda, kterou bychom schovávali – jsou samy o sobě sdělením o stavu otevřených dat. To, že nejde spolehlivě zjistit, kde se v horku schladit, není problém technologie. Je to důsledek toho, že potřebná data zatím nikdo nesdílí v použitelné podobě. Chládek tím nepřímo měří, jak daleko (a jak blízko) je Praha k tomu mít opravdu dobrou službu pro horké dny.",
      "Kam dál: až bude k dispozici živá vrstva městských senzorů z Golemia, zapojíme reálné teploty z měst po Praze, aby mapa ukázala, kde je právě teď nejchladněji. Ve druhé fázi zvažujeme i crowdsourcing – možnost, aby lidé sami reportovali, jak je kde chladno. A pokud Chládek poslouží jako argument, proč má smysl tato data otevřít a sdílet, splní svůj hlavní účel bez ohledu na to, kolik lidí si v něm nakonec najde cestu k pítku.",
    ],
  },
];
