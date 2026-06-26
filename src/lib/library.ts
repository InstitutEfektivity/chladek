import type { LibraryOpeningRow } from "./types.ts";

// Výpočet „Otevřeno teď" pro knihovny z pole opening_hours.
// Pravidlo: pro dnešní den (a aktuální čas) vyber řádek, jehož valid_from/valid_through
// pokrývá dnešek; jinak is_default řádek pro daný day_of_week. Otevřeno, pokud je teď
// mezi opens–closes. Když nic nesedí na dnešek, najdi nejbližší budoucí otevření.

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// České názvy dní (3. pád pro „otevře v …" → použijeme nominativ pro stručnost).
const DAY_CS: Record<string, string> = {
  Monday: "pondělí",
  Tuesday: "úterý",
  Wednesday: "středa",
  Thursday: "čtvrtek",
  Friday: "pátek",
  Saturday: "sobota",
  Sunday: "neděle",
};

// "HH:MM" → minuty od půlnoci. Nevalidní → null.
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

// Pokrývá daný řádek dnešní datum? (valid_from/valid_through jsou ISO nebo null).
function coversToday(row: LibraryOpeningRow, now: Date): boolean {
  const from = row.valid_from ? new Date(row.valid_from) : null;
  const to = row.valid_through ? new Date(row.valid_through) : null;
  if (from && Number.isNaN(from.getTime())) return false;
  if (to && Number.isNaN(to.getTime())) return false;
  if (from && now < from) return false;
  if (to && now > to) return false;
  return true;
}

// Vyber nejvhodnější řádek pro daný den: přednost má časově platný (valid_from/through
// pokrývá dnešek a NENÍ default), jinak is_default řádek.
function rowForDay(
  rows: LibraryOpeningRow[],
  dayName: string,
  now: Date
): LibraryOpeningRow | null {
  const sameDay = rows.filter((r) => r.day_of_week === dayName);
  if (sameDay.length === 0) return null;
  // 1) výjimkový řádek pokrývající dnešek (valid_from/through nastaveno + pokrývá)
  const exception = sameDay.find(
    (r) => !r.is_default && (r.valid_from || r.valid_through) && coversToday(r, now)
  );
  if (exception) return exception;
  // 2) default řádek
  const def = sameDay.find((r) => r.is_default);
  return def ?? sameDay[0] ?? null;
}

export interface OpenNowResult {
  state: "open" | "closed";
  // Lidsky čitelný štítek: „Otevřeno teď · do 17:00" / „Zavřeno · otevře středa 15:00".
  label: string;
}

// Spočítá stav otevřeno/zavřeno pro aktuální lokální čas.
export function computeOpenNow(
  rows: LibraryOpeningRow[],
  now: Date = new Date()
): OpenNowResult {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { state: "closed", label: "Otevírací doba neuvedena" };
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayName = DAY_NAMES[now.getDay()] ?? "Monday";
  const todayRow = rowForDay(rows, todayName, now);

  if (todayRow) {
    const o = toMinutes(todayRow.opens);
    const c = toMinutes(todayRow.closes);
    if (o !== null && c !== null && nowMin >= o && nowMin < c) {
      return { state: "open", label: `Otevřeno teď · do ${todayRow.closes}` };
    }
  }

  // Zavřeno → najdi nejbližší budoucí otevření (dnes později, jinak příští dny).
  for (let offset = 0; offset < 7; offset++) {
    const probe = new Date(now.getTime() + offset * 86400000);
    const dayName = DAY_NAMES[probe.getDay()] ?? "Monday";
    const row = rowForDay(rows, dayName, probe);
    if (!row) continue;
    const o = toMinutes(row.opens);
    if (o === null) continue;
    if (offset === 0 && o <= nowMin) continue; // dnešní otvírák už proběhl
    const dayCs = offset === 0 ? "dnes" : DAY_CS[dayName] ?? dayName;
    return { state: "closed", label: `Zavřeno · otevře ${dayCs} ${row.opens}` };
  }

  return { state: "closed", label: "Zavřeno" };
}
