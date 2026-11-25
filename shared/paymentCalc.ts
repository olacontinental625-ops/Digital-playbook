export type PaymentStatus = 'PAID' | 'NOT PAID';
export type UrgencyLevel = 'nominal' | 'expiring_month' | 'expiring_week' | 'expired';

export interface PaymentMetrics {
  status: PaymentStatus;
  totalMonths: number;
  monthsUsed: number;
  monthsRemaining: number;
  daysRemaining: number;
  isExpired: boolean;
  isExpiringWithin7Days: boolean;
  isExpiringWithin30Days: boolean;
  isExpiringThisMonth: boolean;
  urgencyLevel: UrgencyLevel;
}

export function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseIsoDateParts(dateIso: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso.trim());
  if (!match) {
    throw new Error(`Invalid ISO date format: ${dateIso}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function daysInMonth(year: number, month1To12: number): number {
  return new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
}

export function formatIsoDateParts(year: number, month1To12: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month1To12).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Adds exact calendar months to an ISO date (YYYY-MM-DD), clamping the day
 * to the target month's length (e.g. Jan 31 + 1 month => Feb 28/29).
 * Jan 15, 2026 + 12 months => Jan 15, 2027.
 */
export function addCalendarMonths(dateIso: string, monthsToAdd: number): string {
  const { year, month, day } = parseIsoDateParts(dateIso);
  const totalMonths = year * 12 + (month - 1) + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const maxDay = daysInMonth(targetYear, targetMonth);
  const targetDay = Math.min(day, maxDay);
  return formatIsoDateParts(targetYear, targetMonth, targetDay);
}

export function calculateExpiryDate(commencementDateIso: string, durationMonths: number): string {
  if (!Number.isFinite(durationMonths) || durationMonths < 1) {
    return commencementDateIso;
  }
  return addCalendarMonths(commencementDateIso, Math.round(durationMonths));
}

export function diffCalendarDays(targetIso: string, baseIso: string): number {
  const t = parseIsoDateParts(targetIso);
  const b = parseIsoDateParts(baseIso);
  const utcTarget = Date.UTC(t.year, t.month - 1, t.day);
  const utcBase = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((utcTarget - utcBase) / 86400000);
}

export function formatDurationLabel(months: number): string {
  if (months === 1) return 'Monthly (1 Month)';
  return `${months} Months`;
}

/**
 * Computes calendar-accurate payment metrics.
 * Follows the exact rule:
 *   Commencement = Jan, Current = Apr, Total = 12 => Months Used = 4, Months Remaining = 8.
 *   When today >= expiryDate, payment has expired => NOT PAID, monthsUsed = totalMonths, monthsRemaining = 0, daysRemaining = 0.
 */
export function calculatePaymentMetrics(
  commencementDateIso: string | null | undefined,
  expiryDateIso: string | null | undefined,
  durationMonths: number | null | undefined,
  referenceDateIso: string = getTodayIso(),
): PaymentMetrics {
  if (!commencementDateIso || !expiryDateIso || !durationMonths || durationMonths <= 0) {
    return {
      status: 'NOT PAID',
      totalMonths: 0,
      monthsUsed: 0,
      monthsRemaining: 0,
      daysRemaining: 0,
      isExpired: true,
      isExpiringWithin7Days: false,
      isExpiringWithin30Days: false,
      isExpiringThisMonth: false,
      urgencyLevel: 'expired',
    };
  }

  const totalMonths = Math.max(1, Math.round(durationMonths));
  const daysRemainingRaw = diffCalendarDays(expiryDateIso, referenceDateIso);
  const isExpired = daysRemainingRaw <= 0;

  if (isExpired) {
    return {
      status: 'NOT PAID',
      totalMonths,
      monthsUsed: totalMonths,
      monthsRemaining: 0,
      daysRemaining: 0,
      isExpired: true,
      isExpiringWithin7Days: false,
      isExpiringWithin30Days: false,
      isExpiringThisMonth: false,
      urgencyLevel: 'expired',
    };
  }

  let monthsUsed = 0;
  if (referenceDateIso >= commencementDateIso) {
    for (let k = 0; k < totalMonths; k++) {
      const periodStart = addCalendarMonths(commencementDateIso, k);
      if (referenceDateIso >= periodStart) {
        monthsUsed = k + 1;
      } else {
        break;
      }
    }
  }

  const monthsRemaining = Math.max(0, totalMonths - monthsUsed);
  const refParts = parseIsoDateParts(referenceDateIso);
  const expParts = parseIsoDateParts(expiryDateIso);
  const isExpiringThisMonth =
    refParts.year === expParts.year && refParts.month === expParts.month && daysRemainingRaw > 0;
  const isExpiringWithin7Days = daysRemainingRaw > 0 && daysRemainingRaw <= 7;
  const isExpiringWithin30Days = daysRemainingRaw > 0 && daysRemainingRaw <= 30;

  let urgencyLevel: UrgencyLevel = 'nominal';
  if (isExpiringWithin7Days) {
    urgencyLevel = 'expiring_week';
  } else if (isExpiringWithin30Days || isExpiringThisMonth) {
    urgencyLevel = 'expiring_month';
  }

  return {
    status: 'PAID',
    totalMonths,
    monthsUsed,
    monthsRemaining,
    daysRemaining: daysRemainingRaw,
    isExpired: false,
    isExpiringWithin7Days,
    isExpiringWithin30Days,
    isExpiringThisMonth,
    urgencyLevel,
  };
}
