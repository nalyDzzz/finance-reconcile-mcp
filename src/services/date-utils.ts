import type { DateRange, DateRangeInput } from "../types.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDateOnly(value: string): boolean {
  if (!DATE_RE.test(value)) {
    return false;
  }

  const parsed = parseDateOnly(value);
  return formatDateOnly(parsed) === value;
}

export function assertIsoDateOnly(value: string, fieldName: string): void {
  if (!isIsoDateOnly(value)) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD date.`);
  }
}

export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatDateOnly(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayDateOnly(): string {
  const now = new Date();
  return formatDateOnly(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function addDays(date: string, days: number): string {
  const parsed = parseDateOnly(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return formatDateOnly(parsed);
}

export function diffDays(a: string, b: string): number {
  const aMs = parseDateOnly(a).getTime();
  const bMs = parseDateOnly(b).getTime();
  return Math.round((aMs - bMs) / 86_400_000);
}

export function toEpochSeconds(date: string): number {
  return Math.floor(parseDateOnly(date).getTime() / 1000);
}

export function epochSecondsToDate(value: number): string {
  return formatDateOnly(new Date(value * 1000));
}

export function coerceDateTimeToDate(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 10) {
    return undefined;
  }

  const candidate = value.slice(0, 10);
  return isIsoDateOnly(candidate) ? candidate : undefined;
}

export function resolveDateRange(input: DateRangeInput, defaultLookbackDays: number): DateRange {
  if (input.start_date) {
    assertIsoDateOnly(input.start_date, "start_date");
  }

  if (input.end_date) {
    assertIsoDateOnly(input.end_date, "end_date");
  }

  const days = input.days ?? defaultLookbackDays;
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("days must be an integer between 1 and 3650.");
  }

  const endDate = input.end_date ?? todayDateOnly();
  const startDate = input.start_date ?? addDays(endDate, -(days - 1));

  if (diffDays(endDate, startDate) < 0) {
    throw new Error("end_date must be on or after start_date.");
  }

  return {
    startDate,
    endDate,
    days: diffDays(endDate, startDate) + 1
  };
}

export function latestDate(dates: Array<string | undefined>): string | undefined {
  return dates.filter(Boolean).sort().at(-1);
}
