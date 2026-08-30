const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

type WallClock = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
};

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  });
}

function wallClockAt(timestamp: number, timeZone: string): WallClock {
  const values = new Map(
    formatter(timeZone)
      .formatToParts(new Date(timestamp))
      .map((part) => [part.type, part.value]),
  );
  return {
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    month: Number(values.get("month")),
    year: Number(values.get("year")),
  };
}

function wallClockTimestamp(value: WallClock): number {
  return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute);
}

function sameWallClock(left: WallClock, right: WallClock): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function zonedDateTimeLocalValue(
  value: string | null,
  timeZone: string,
): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "";
  try {
    const local = wallClockAt(timestamp, timeZone);
    return `${local.year}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}`;
  } catch {
    return "";
  }
}

/** Converts a datetime-local wall clock in an IANA zone to an exact instant. */
export function zonedDateTimeLocalToIso(
  value: string | null,
  timeZone: string,
): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  const match = LOCAL_DATE_TIME.exec(normalized);
  if (!match) throw new Error("Enter a valid local date and time.");
  const desired: WallClock = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const desiredWallTimestamp = wallClockTimestamp(desired);
  if (
    new Date(desiredWallTimestamp).getUTCFullYear() !== desired.year
    || new Date(desiredWallTimestamp).getUTCMonth() + 1 !== desired.month
    || new Date(desiredWallTimestamp).getUTCDate() !== desired.day
    || desired.hour > 23
    || desired.minute > 59
  ) {
    throw new Error("Enter a valid local date and time.");
  }

  let candidate = desiredWallTimestamp;
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const observed = wallClockAt(candidate, timeZone);
      const correction = desiredWallTimestamp - wallClockTimestamp(observed);
      if (correction === 0) break;
      candidate += correction;
    }
    if (!sameWallClock(wallClockAt(candidate, timeZone), desired)) {
      throw new Error("That local time does not exist in the selected timezone.");
    }
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error("Choose a valid IANA timezone, such as America/Denver.");
    }
    throw error;
  }
  return new Date(candidate).toISOString();
}
