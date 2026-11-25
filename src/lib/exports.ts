import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type {
  CustomColumnConfig,
  LogbookEntry,
  PaymentTransactionRecord,
} from '../../shared/types.ts';

export function formatCurrency(amount: number | null | undefined, symbol = '$'): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  return `${symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function exportLogbookToExcel(
  entries: LogbookEntry[],
  customColumns: CustomColumnConfig[],
  currencySymbol: string,
  filenamePrefix = 'ola-continental-logbook',
): void {
  const visibleCustom = customColumns.filter((c) => c.isVisible);

  const rows = entries.map((e) => {
    const base: Record<string, string | number> = {
      'Serial No.': e.serialNumber,
      'Date of Transaction': e.transactionDate || '—',
      "Occupant's Full Name": e.fullName,
      'Property / Location': e.propertyName,
      'Room / Unit No.': e.roomNumber,
      'Amount Paid': e.amountPaid !== null ? `${currencySymbol}${e.amountPaid.toFixed(2)}` : '—',
      'Unpaid Balance': `${currencySymbol}${Number(e.unpaidBalance || 0).toFixed(2)}`,
      'Payment Duration': e.durationLabel || '—',
      'Commencement Date': e.commencementDate || '—',
      'Expiry Date': e.expiryDate || '—',
      'Months Used': e.monthsUsed,
      'Months Remaining': e.monthsRemaining,
      'Days Remaining': e.daysRemaining,
      'Payment Status': e.status,
      'Phone Number': e.phone,
      Remarks: e.remarks || '',
    };

    for (const col of visibleCustom) {
      base[col.label] = e.customFields?.[col.columnKey] ?? '';
    }

    return base;
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'OLA Continental Logbook');
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `${filenamePrefix}-${today}.xlsx`);
}

export function exportLogbookToPdf(
  entries: LogbookEntry[],
  customColumns: CustomColumnConfig[],
  currencySymbol: string,
  title = 'OLA Continental — Digital Logbook Payment Register',
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const visibleCustom = customColumns.filter((c) => c.isVisible);

  doc.setFontSize(14);
  doc.setTextColor(11, 25, 44);
  doc.text(title, 32, 32);

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${new Date().toLocaleString()}   |   Total Records: ${entries.length}`, 32, 48);

  const headers = [
    'S/N',
    'Tx Date',
    'Full Name',
    'Property',
    'Room',
    'Amount Paid',
    'Unpaid Bal.',
    'Duration',
    'Start Date',
    'Expiry Date',
    'Used',
    'Rem.',
    'Status',
    'Phone',
    'Remarks',
    ...visibleCustom.map((c) => c.label),
  ];

  const body = entries.map((e) => [
    String(e.serialNumber),
    e.transactionDate || '—',
    e.fullName,
    e.propertyName,
    e.roomNumber,
    e.amountPaid !== null ? `${currencySymbol}${e.amountPaid.toFixed(2)}` : '—',
    `${currencySymbol}${Number(e.unpaidBalance || 0).toFixed(2)}`,
    e.durationMonths ? `${e.durationMonths} mo` : '—',
    e.commencementDate || '—',
    e.expiryDate || '—',
    String(e.monthsUsed),
    String(e.monthsRemaining),
    e.status,
    e.phone,
    e.remarks || '',
    ...visibleCustom.map((c) => e.customFields?.[c.columnKey] ?? ''),
  ]);

  autoTable(doc, {
    head: [headers],
    body,
    startY: 58,
    margin: { left: 24, right: 24 },
    styles: {
      fontSize: 6.8,
      cellPadding: 3,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [11, 25, 44],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  doc.save(`ola-continental-logbook-${today}.pdf`);
}

export function exportTransactionsToExcel(
  transactions: PaymentTransactionRecord[],
  currencySymbol: string,
): void {
  const rows = transactions.map((t) => ({
    'Transaction Date': t.transactionDate,
    'Transaction Ref': t.transactionRef,
    'Occupant Name': t.occupantName || '',
    Property: t.propertyName || '',
    'Room / Unit': t.roomNumber || '',
    'Amount Received': `${currencySymbol}${t.amountReceived.toFixed(2)}`,
    'Duration Purchased': t.durationLabel,
    'Commencement Date': t.commencementDate,
    'Expiry Date': t.expiryDate,
    'Recorded By': t.recordedBy,
    Type: t.isCorrection ? 'Audited Correction' : 'Payment',
    Remarks: t.correctionNote || t.remarks || '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions');
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `payment-transactions-${today}.xlsx`);
}

export function exportTransactionsToPdf(
  transactions: PaymentTransactionRecord[],
  currencySymbol: string,
  summaryLabel: string,
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.setTextColor(11, 25, 44);
  doc.text('Digital Logbook — Financial & Payment Transaction Report', 32, 32);
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(summaryLabel, 32, 48);

  autoTable(doc, {
    head: [
      [
        'Tx Date',
        'Reference',
        'Occupant',
        'Property',
        'Room',
        'Amount',
        'Duration',
        'Start Date',
        'Expiry Date',
        'Recorded By',
        'Remarks',
      ],
    ],
    body: transactions.map((t) => [
      t.transactionDate,
      t.transactionRef,
      t.occupantName || '',
      t.propertyName || '',
      t.roomNumber || '',
      `${currencySymbol}${t.amountReceived.toFixed(2)}`,
      t.durationLabel,
      t.commencementDate,
      t.expiryDate,
      t.recordedBy,
      t.correctionNote || t.remarks || '',
    ]),
    startY: 58,
    margin: { left: 24, right: 24 },
    styles: { fontSize: 7.5, cellPadding: 3.5 },
    headStyles: { fillColor: [11, 25, 44], textColor: [255, 255, 255] },
  });

  const today = new Date().toISOString().slice(0, 10);
  doc.save(`payment-report-${today}.pdf`);
}
