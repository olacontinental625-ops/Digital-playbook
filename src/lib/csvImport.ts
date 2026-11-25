import {
  calculateExpiryDate,
  formatDurationLabel,
  getTodayIso,
} from '../../shared/paymentCalc.ts';
import type { CustomColumnConfig, LogbookEntry } from '../../shared/types.ts';

export type CsvTargetField =
  | 'ignore'
  | 'serialNumber'
  | 'transactionDate'
  | 'fullName'
  | 'phone'
  | 'email'
  | 'propertyName'
  | 'roomNumber'
  | 'amountPaid'
  | 'unpaidBalance'
  | 'durationMonths'
  | 'commencementDate'
  | 'expiryDate'
  | 'notes'
  | 'transactionRef'
  | `custom:${string}`;

export const STANDARD_CSV_FIELD_OPTIONS: Array<{ value: CsvTargetField; label: string }> = [
  { value: 'ignore', label: '— Ignore Column —' },
  { value: 'serialNumber', label: 'Serial No. (S/N)' },
  { value: 'fullName', label: "Occupant's Full Name *" },
  { value: 'phone', label: 'Phone Number *' },
  { value: 'email', label: 'Email Address' },
  { value: 'propertyName', label: 'Property / Location *' },
  { value: 'roomNumber', label: 'Room / Unit No. *' },
  { value: 'transactionDate', label: 'Date of Transaction' },
  { value: 'amountPaid', label: 'Amount Paid' },
  { value: 'unpaidBalance', label: 'Unpaid Balance' },
  { value: 'durationMonths', label: 'Payment Duration (Months)' },
  { value: 'commencementDate', label: 'Commencement / Start Date' },
  { value: 'expiryDate', label: 'Expiry Date' },
  { value: 'transactionRef', label: 'Transaction Ref' },
  { value: 'notes', label: 'Remarks / Notes' },
];

export interface ParsedCsvData {
  headers: string[];
  rows: string[][];
}

export function parseCsvText(rawText: string): ParsedCsvData {
  const text = rawText.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if (ch === '\r' && next === '\n') {
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c !== '')) {
        records.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c !== '')) {
        records.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  currentRow.push(currentCell.trim());
  if (currentRow.some((c) => c !== '')) {
    records.push(currentRow);
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = records[0].map((h, idx) => h || `Column ${idx + 1}`);
  const rows = records.slice(1).map((row) => {
    const padded = [...row];
    while (padded.length < headers.length) padded.push('');
    return padded.slice(0, headers.length);
  });

  return { headers, rows };
}

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function autoMapCsvHeaders(
  headers: string[],
  customColumns: CustomColumnConfig[],
): Record<number, CsvTargetField> {
  const mapping: Record<number, CsvTargetField> = {};
  const usedTargets = new Set<string>();

  headers.forEach((rawHeader, index) => {
    const norm = normalizeHeader(rawHeader);
    let matched: CsvTargetField = 'ignore';

    if (['s n', 'sn', 'serial', 'serial no', 'serial number'].includes(norm)) {
      matched = 'serialNumber';
    } else if (
      ['full name', 'occupant s full name', 'occupants full name', 'occupant full name', 'occupant name', 'name', 'tenant', 'tenant name'].includes(norm)
    ) {
      matched = 'fullName';
    } else if (['phone', 'phone number', 'mobile', 'tel', 'telephone', 'contact'].includes(norm)) {
      matched = 'phone';
    } else if (['email', 'email address', 'e mail'].includes(norm)) {
      matched = 'email';
    } else if (['property', 'property location', 'property name', 'location', 'building', 'estate'].includes(norm)) {
      matched = 'propertyName';
    } else if (['room', 'room unit', 'room unit no', 'room number', 'room no', 'unit', 'unit no', 'flat', 'apartment', 'suite'].includes(norm)) {
      matched = 'roomNumber';
    } else if (['date of transaction', 'date of tx', 'transaction date', 'tx date', 'payment date'].includes(norm)) {
      matched = 'transactionDate';
    } else if (['amount paid', 'amount', 'paid', 'rent paid', 'amount received'].includes(norm)) {
      matched = 'amountPaid';
    } else if (['unpaid balance', 'unpaid bal', 'balance', 'arrears', 'outstanding', 'unpaid'].includes(norm)) {
      matched = 'unpaidBalance';
    } else if (['payment duration', 'duration', 'duration months', 'duration month', 'months'].includes(norm)) {
      matched = 'durationMonths';
    } else if (['commencement date', 'start date', 'commencement', 'from date'].includes(norm)) {
      matched = 'commencementDate';
    } else if (['expiry date', 'end date', 'due date', 'expiration date'].includes(norm)) {
      matched = 'expiryDate';
    } else if (['transaction ref', 'tx ref', 'reference', 'ref', 'receipt no'].includes(norm)) {
      matched = 'transactionRef';
    } else if (['remarks', 'notes', 'note', 'comment', 'comments'].includes(norm)) {
      matched = 'notes';
    } else {
      const customMatch = customColumns.find(
        (c) => normalizeHeader(c.label) === norm || normalizeHeader(c.columnKey) === norm,
      );
      if (customMatch) {
        matched = `custom:${customMatch.columnKey}`;
      }
    }

    if (matched !== 'ignore' && usedTargets.has(matched)) {
      matched = 'ignore';
    }
    if (matched !== 'ignore') {
      usedTargets.add(matched);
    }
    mapping[index] = matched;
  });

  return mapping;
}

export function parseSerialNumber(raw: string): number | null {
  const cleaned = raw.replace(/[#,\s]/g, '').trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num);
}

export function parseMoneyValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') return null;
  const cleaned = trimmed.replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100) / 100;
}

export function parseDurationMonths(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === '—' || trimmed === '-' || trimmed === 'not paid') return null;
  if (trimmed.includes('year') || trimmed.includes('yr')) {
    const yrs = Number(trimmed.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(yrs) && yrs > 0) {
      return Math.min(120, Math.max(1, Math.round(yrs * 12)));
    }
  }
  const num = Number(trimmed.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.min(120, Math.max(1, Math.round(num)));
}

export function parseDateToIso(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') return null;

  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (isValidCalendarDate(y, m, d)) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null;
  }

  const slashMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(trimmed);
  if (slashMatch) {
    const p1 = Number(slashMatch[1]);
    const p2 = Number(slashMatch[2]);
    const y = Number(slashMatch[3]);
    // Prefer DD/MM/YYYY when p1 > 12 or default DD/MM/YYYY for Nigeria/international registers,
    // falling back to MM/DD/YYYY if p2 > 12.
    let day = p1;
    let month = p2;
    if (p2 > 12 && p1 <= 12) {
      month = p1;
      day = p2;
    }
    if (isValidCalendarDate(y, month, day)) {
      return `${String(y).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export interface CsvImportNormalizedPayload {
  serialNumber: number | null;
  fullName: string;
  phone: string;
  email: string;
  propertyName: string;
  roomNumber: string;
  hasPaymentDetails: boolean;
  transactionDate: string;
  amountPaid: number;
  unpaidBalance: number;
  durationMonths: number;
  commencementDate: string;
  expiryDate: string;
  transactionRef: string;
  notes: string;
  customFields: Record<string, string>;
}

export interface CsvImportPreviewRow {
  rowIndex: number; // 1-based data row index
  action: 'create' | 'update' | 'skip' | 'error';
  matchedEntry: LogbookEntry | null;
  matchReason: string;
  errorMessage: string;
  payload: CsvImportNormalizedPayload;
}

export function prepareCsvImportPreview(
  rows: string[][],
  mapping: Record<number, CsvTargetField>,
  existingEntries: LogbookEntry[],
  updateExisting: boolean,
): CsvImportPreviewRow[] {
  const today = getTodayIso();

  const bySerial = new Map<number, LogbookEntry>();
  const byPropRoom = new Map<string, LogbookEntry>();
  const byNamePhone = new Map<string, LogbookEntry>();

  for (const e of existingEntries) {
    bySerial.set(e.serialNumber, e);
    const prKey = `${e.propertyName.trim().toLowerCase()}::${e.roomNumber.trim().toLowerCase()}`;
    if (!byPropRoom.has(prKey)) byPropRoom.set(prKey, e);
    const npKey = `${e.fullName.trim().toLowerCase()}::${e.phone.replace(/\s+/g, '').toLowerCase()}`;
    if (!byNamePhone.has(npKey)) byNamePhone.set(npKey, e);
  }

  return rows.map((cells, idx) => {
    const raw: Record<string, string> = {};
    const customRaw: Record<string, string> = {};

    cells.forEach((cellVal, colIdx) => {
      const target = mapping[colIdx] || 'ignore';
      if (target === 'ignore') return;
      if (target.startsWith('custom:')) {
        const key = target.slice('custom:'.length);
        if (cellVal !== '') customRaw[key] = cellVal;
      } else {
        raw[target] = cellVal;
      }
    });

    const sn = raw.serialNumber ? parseSerialNumber(raw.serialNumber) : null;
    const rawFullName = (raw.fullName || '').trim().slice(0, 140);
    const rawPhone = (raw.phone || '').trim().slice(0, 40);
    const rawEmail = (raw.email || '').trim().toLowerCase().slice(0, 160);
    const rawProp = (raw.propertyName || '').trim().slice(0, 120);
    const rawRoom = (raw.roomNumber || '').trim().slice(0, 60);

    // Attempt to match existing occupant for bulk update
    let matchedEntry: LogbookEntry | null = null;
    let matchReason = '';

    if (sn && bySerial.has(sn)) {
      matchedEntry = bySerial.get(sn)!;
      matchReason = `Matched S/N #${String(sn).padStart(3, '0')}`;
    } else if (rawProp && rawRoom) {
      const prKey = `${rawProp.toLowerCase()}::${rawRoom.toLowerCase()}`;
      if (byPropRoom.has(prKey)) {
        matchedEntry = byPropRoom.get(prKey)!;
        matchReason = `Matched ${rawProp} · ${rawRoom}`;
      }
    }
    if (!matchedEntry && rawFullName && rawPhone) {
      const npKey = `${rawFullName.toLowerCase()}::${rawPhone.replace(/\s+/g, '').toLowerCase()}`;
      if (byNamePhone.has(npKey)) {
        matchedEntry = byNamePhone.get(npKey)!;
        matchReason = 'Matched Name & Phone';
      }
    }

    // Merge fields with matchedEntry when updating (allows partial-column CSV bulk updates)
    const fullName = rawFullName || matchedEntry?.fullName || '';
    const phone = rawPhone || matchedEntry?.phone || '';
    const email = rawEmail || matchedEntry?.email || '';
    const propertyName = rawProp || matchedEntry?.propertyName || '';
    const roomNumber = rawRoom || matchedEntry?.roomNumber || '';
    const notes =
      raw.notes !== undefined ? raw.notes.trim().slice(0, 500) : matchedEntry?.notes || '';

    const parsedAmount =
      raw.amountPaid !== undefined ? parseMoneyValue(raw.amountPaid) : null;
    const parsedBalance =
      raw.unpaidBalance !== undefined ? parseMoneyValue(raw.unpaidBalance) : null;
    const parsedDuration =
      raw.durationMonths !== undefined ? parseDurationMonths(raw.durationMonths) : null;
    const parsedTxDate =
      raw.transactionDate !== undefined ? parseDateToIso(raw.transactionDate) : null;
    const parsedStart =
      raw.commencementDate !== undefined ? parseDateToIso(raw.commencementDate) : null;
    const parsedExpiry =
      raw.expiryDate !== undefined ? parseDateToIso(raw.expiryDate) : null;

    // Validate explicit invalid dates/numbers when provided
    const validationErrors: string[] = [];
    if (!fullName) validationErrors.push('Missing Full Name');
    if (!phone) validationErrors.push('Missing Phone Number');
    if (!propertyName) validationErrors.push('Missing Property');
    if (!roomNumber) validationErrors.push('Missing Room / Unit');
    if (raw.transactionDate && raw.transactionDate !== '—' && !parsedTxDate) {
      validationErrors.push('Invalid Tx Date');
    }
    if (raw.commencementDate && raw.commencementDate !== '—' && !parsedStart) {
      validationErrors.push('Invalid Start Date');
    }
    if (raw.expiryDate && raw.expiryDate !== '—' && !parsedExpiry) {
      validationErrors.push('Invalid Expiry Date');
    }

    const unpaidBalance =
      parsedBalance !== null
        ? parsedBalance
        : matchedEntry
          ? Math.max(0, Number(matchedEntry.unpaidBalance || 0))
          : 0;

    // Resolve payment fields
    let amountPaid =
      parsedAmount !== null
        ? parsedAmount
        : matchedEntry
          ? Math.max(0, Number(matchedEntry.amountPaid || 0))
          : 0;
    let durationMonths =
      parsedDuration !== null
        ? parsedDuration
        : matchedEntry
          ? Math.max(0, Number(matchedEntry.durationMonths || 0))
          : 0;
    let commencementDate = parsedStart || matchedEntry?.commencementDate || '';
    let transactionDate = parsedTxDate || matchedEntry?.transactionDate || '';
    let expiryDate = parsedExpiry || matchedEntry?.expiryDate || '';

    const importedPaymentProvided =
      (parsedAmount !== null && parsedAmount > 0) ||
      parsedDuration !== null ||
      Boolean(parsedStart) ||
      Boolean(parsedExpiry);

    if (importedPaymentProvided) {
      if (!commencementDate) commencementDate = transactionDate || today;
      if (!transactionDate) transactionDate = commencementDate || today;
      if (!durationMonths || durationMonths < 1) durationMonths = 12;
      if (!expiryDate || (parsedStart && !parsedExpiry) || (parsedDuration && !parsedExpiry)) {
        expiryDate = calculateExpiryDate(commencementDate, durationMonths);
      }
    }

    const hasPaymentDetails =
      amountPaid > 0 || (durationMonths >= 1 && Boolean(commencementDate) && Boolean(expiryDate));

    if (!hasPaymentDetails) {
      amountPaid = 0;
      durationMonths = 0;
      commencementDate = '';
      expiryDate = '';
      transactionDate = '';
    }

    const mergedCustomFields: Record<string, string> = {
      ...(matchedEntry?.customFields || {}),
      ...customRaw,
    };

    const payload: CsvImportNormalizedPayload = {
      serialNumber: matchedEntry ? matchedEntry.serialNumber : sn,
      fullName,
      phone,
      email,
      propertyName,
      roomNumber,
      hasPaymentDetails,
      transactionDate,
      amountPaid,
      unpaidBalance,
      durationMonths,
      commencementDate,
      expiryDate,
      transactionRef: (raw.transactionRef || '').trim().slice(0, 80),
      notes,
      customFields: mergedCustomFields,
    };

    if (matchedEntry && !updateExisting) {
      return {
        rowIndex: idx + 1,
        action: 'skip',
        matchedEntry,
        matchReason: `${matchReason} (Updates disabled)`,
        errorMessage: '',
        payload,
      };
    }

    if (validationErrors.length > 0) {
      return {
        rowIndex: idx + 1,
        action: 'error',
        matchedEntry,
        matchReason,
        errorMessage: validationErrors.join(', '),
        payload,
      };
    }

    return {
      rowIndex: idx + 1,
      action: matchedEntry ? 'update' : 'create',
      matchedEntry,
      matchReason,
      errorMessage: '',
      payload,
    };
  });
}

function escapeCsvCell(val: string | number | null | undefined): string {
  const str = val === null || val === undefined ? '' : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvExportOrTemplate(
  customColumns: CustomColumnConfig[],
  entries?: LogbookEntry[],
): string {
  const visibleCustom = customColumns.filter((c) => c.isVisible);
  const headers = [
    'Serial No.',
    "Occupant's Full Name",
    'Phone Number',
    'Email Address',
    'Property / Location',
    'Room / Unit No.',
    'Date of Transaction',
    'Amount Paid',
    'Unpaid Balance',
    'Payment Duration',
    'Commencement Date',
    'Expiry Date',
    'Remarks',
    ...visibleCustom.map((c) => c.label),
  ];

  const lines = [headers.map(escapeCsvCell).join(',')];

  if (entries && entries.length > 0) {
    for (const e of entries) {
      const row = [
        e.serialNumber,
        e.fullName,
        e.phone,
        e.email || '',
        e.propertyName,
        e.roomNumber,
        e.transactionDate || '',
        e.amountPaid ?? 0,
        e.unpaidBalance ?? 0,
        e.durationMonths ? formatDurationLabel(e.durationMonths) : '',
        e.commencementDate || '',
        e.expiryDate || '',
        e.remarks || '',
        ...visibleCustom.map((c) => e.customFields?.[c.columnKey] ?? ''),
      ];
      lines.push(row.map(escapeCsvCell).join(','));
    }
  } else {
    const today = getTodayIso();
    const exampleExpiry = calculateExpiryDate(today, 12);
    const sampleRow = [
      '',
      'Adebayo Kunle',
      '0803-555-0199',
      'adebayo@example.com',
      'OLA Continental Court A',
      'Room 01',
      today,
      250000,
      0,
      12,
      today,
      exampleExpiry,
      'Annual rent payment',
      ...visibleCustom.map(() => ''),
    ];
    lines.push(sampleRow.map(escapeCsvCell).join(','));
  }

  return lines.join('\r\n');
}

export function downloadCsvFile(content: string, filename: string): void {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
