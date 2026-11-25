import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import type {
  CustomColumnConfig,
  LogbookEntry,
  PropertyRecord,
  RoomRecord,
} from '../../shared/types.ts';
import {
  autoMapCsvHeaders,
  buildCsvExportOrTemplate,
  downloadCsvFile,
  parseCsvText,
  prepareCsvImportPreview,
  STANDARD_CSV_FIELD_OPTIONS,
  type CsvTargetField,
} from '../lib/csvImport.ts';
import { formatCurrency } from '../lib/exports.ts';
import { bulkImportOccupantsInFirestore } from '../lib/firestoreStore.ts';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => Promise<void> | void;
  adminUid: string;
  adminName: string;
  entries: LogbookEntry[];
  properties: PropertyRecord[];
  rooms: RoomRecord[];
  customColumns: CustomColumnConfig[];
  currencySymbol: string;
}

export const CsvImportModal: React.FC<CsvImportModalProps> = ({
  isOpen,
  onClose,
  onImported,
  adminUid,
  adminName,
  entries,
  properties,
  rooms,
  customColumns,
  currencySymbol,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, CsvTargetField>>({});
  const [updateExisting, setUpdateExisting] = useState(true);
  const [recordTransactions, setRecordTransactions] = useState(true);
  const [showMapping, setShowMapping] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [importResult, setImportResult] = useState<{
    createdCount: number;
    updatedCount: number;
    txCreatedCount: number;
  } | null>(null);

  const visibleCustomCols = useMemo(
    () => customColumns.filter((c) => c.isVisible),
    [customColumns],
  );

  const fieldOptions = useMemo(() => {
    const customOpts = visibleCustomCols.map((c) => ({
      value: `custom:${c.columnKey}` as CsvTargetField,
      label: `Custom: ${c.label}`,
    }));
    return [...STANDARD_CSV_FIELD_OPTIONS, ...customOpts];
  }, [visibleCustomCols]);

  const previewRows = useMemo(() => {
    if (rawRows.length === 0) return [];
    return prepareCsvImportPreview(rawRows, mapping, entries, updateExisting);
  }, [rawRows, mapping, entries, updateExisting]);

  const counts = useMemo(() => {
    let create = 0;
    let update = 0;
    let skip = 0;
    let invalid = 0;
    for (const r of previewRows) {
      if (r.action === 'create') create++;
      else if (r.action === 'update') update++;
      else if (r.action === 'skip') skip++;
      else invalid++;
    }
    return { create, update, skip, invalid, actionable: create + update };
  }, [previewRows]);

  if (!isOpen) return null;

  const resetState = () => {
    setFileName('');
    setHeaders([]);
    setRawRows([]);
    setMapping({});
    setShowMapping(false);
    setError('');
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    if (importing) return;
    resetState();
    onClose();
  };

  const processFile = async (file: File) => {
    setError('');
    setImportResult(null);
    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      setError('Please select a valid .csv file.');
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseCsvText(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setError('The CSV file appears empty or contains no data rows.');
        return;
      }
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRawRows(parsed.rows);
      setMapping(autoMapCsvHeaders(parsed.headers, customColumns));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to read CSV file.');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleImport = async () => {
    if (counts.actionable === 0 || importing) return;
    setError('');
    setImporting(true);
    try {
      const result = await bulkImportOccupantsInFirestore(
        adminUid,
        adminName,
        entries,
        properties,
        rooms,
        previewRows,
        recordTransactions,
      );
      setImportResult(result);
      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk CSV import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto">
      <div className="w-full max-w-5xl rounded-lg border border-slate-200 bg-white shadow-xl my-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B192C] px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white/10 text-[#D4AF37]">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold">
                Bulk Import &amp; Update Occupants (CSV)
              </h2>
              <p className="text-xs text-slate-300">
                Upload a CSV file to register new occupants or bulk-update existing records by Serial No., Property &amp; Room, or Name &amp; Phone.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={importing}
            aria-label="Close CSV import modal"
            className="rounded p-1.5 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[78vh] overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {importResult && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-700" />
                <div>
                  <div className="font-semibold">CSV Bulk Import Completed</div>
                  <div className="mt-0.5">
                    Created <strong>{importResult.createdCount}</strong> new record(s), updated{' '}
                    <strong>{importResult.updatedCount}</strong> existing record(s), and logged{' '}
                    <strong>{importResult.txCreatedCount}</strong> payment transaction(s).
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="rounded bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800 shrink-0"
              >
                Done
              </button>
            </div>
          )}

          {/* Template & Export Shortcuts */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-600">
              Need a starting sheet? Download a blank template or export your current register to edit in Excel and re-import.
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  downloadCsvFile(
                    buildCsvExportOrTemplate(customColumns),
                    'ola-continental-import-template.csv',
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                <Download className="h-3.5 w-3.5 text-[#0B192C]" />
                Blank CSV Template
              </button>
              {entries.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    downloadCsvFile(
                      buildCsvExportOrTemplate(customColumns, entries),
                      `ola-continental-register-${new Date().toISOString().slice(0, 10)}.csv`,
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-700" />
                  Export Current CSV ({entries.length})
                </button>
              )}
            </div>
          </div>

          {/* File Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
              dragging
                ? 'border-[#0B192C] bg-slate-100'
                : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50/70'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <Upload className="mx-auto h-7 w-7 text-slate-400" />
            <div className="mt-2 text-sm font-semibold text-slate-800">
              {fileName ? `Loaded: ${fileName}` : 'Click to upload CSV file or drag and drop'}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {rawRows.length > 0
                ? `${rawRows.length} data row(s) detected across ${headers.length} column(s)`
                : 'Supports standard comma-separated .csv files exported from Excel, Google Sheets, or OLA Continental'}
            </div>
          </div>

          {/* Mapping & Options once CSV is loaded */}
          {headers.length > 0 && (
            <>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <label className="inline-flex items-center gap-2 font-medium text-slate-800 cursor-pointer">
                      <input
                        type="radio"
                        name="csvUpdateMode"
                        checked={updateExisting}
                        onChange={() => setUpdateExisting(true)}
                        className="text-[#0B192C]"
                      />
                      Update matching records &amp; add new ones
                    </label>
                    <label className="inline-flex items-center gap-2 font-medium text-slate-600 cursor-pointer">
                      <input
                        type="radio"
                        name="csvUpdateMode"
                        checked={!updateExisting}
                        onChange={() => setUpdateExisting(false)}
                        className="text-[#0B192C]"
                      />
                      Add new records only (skip matches)
                    </label>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={recordTransactions}
                      onChange={(e) => setRecordTransactions(e.target.checked)}
                      className="rounded border-slate-300 text-[#0B192C]"
                    />
                    Log payment transactions when new or updated rows contain changed payment amounts/dates
                  </label>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowMapping((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 text-[#B4832C]" />
                    {showMapping ? 'Hide Column Mapping' : 'Adjust Column Mapping'}
                  </button>
                  <button
                    type="button"
                    onClick={resetState}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Clear File
                  </button>
                </div>
              </div>

              {showMapping && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold text-slate-800 mb-3">
                    CSV Column Mapping
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {headers.map((header, idx) => (
                      <div key={`${header}-${idx}`} className="rounded border border-slate-200 bg-white p-2.5">
                        <div className="text-[11px] font-semibold text-slate-700 truncate" title={header}>
                          {header}
                        </div>
                        <select
                          value={mapping[idx] || 'ignore'}
                          onChange={(e) =>
                            setMapping((prev) => ({
                              ...prev,
                              [idx]: e.target.value as CsvTargetField,
                            }))
                          }
                          className="mt-1.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
                        >
                          {fieldOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview Summary Counters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5">
                  <div className="text-[11px] font-medium text-emerald-800">New Records</div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-emerald-900">
                    {counts.create}
                  </div>
                </div>
                <div className="rounded-md border border-blue-200 bg-blue-50/70 px-3.5 py-2.5">
                  <div className="text-[11px] font-medium text-blue-800">Bulk Updates</div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-blue-900">
                    {counts.update}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                  <div className="text-[11px] font-medium text-slate-600">Skipped</div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-slate-800">
                    {counts.skip}
                  </div>
                </div>
                <div className="rounded-md border border-red-200 bg-red-50/70 px-3.5 py-2.5">
                  <div className="text-[11px] font-medium text-red-800">Validation Errors</div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-red-900">
                    {counts.invalid}
                  </div>
                </div>
              </div>

              {/* Preview Table */}
              <div className="rounded-md border border-slate-200 overflow-hidden">
                <div className="max-h-72 overflow-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-[#0B192C] text-slate-200 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Row</th>
                        <th className="px-3 py-2 text-left font-semibold">Action</th>
                        <th className="px-3 py-2 text-left font-semibold">Full Name</th>
                        <th className="px-3 py-2 text-left font-semibold">Phone</th>
                        <th className="px-3 py-2 text-left font-semibold">Property / Room</th>
                        <th className="px-3 py-2 text-right font-semibold">Paid</th>
                        <th className="px-3 py-2 text-right font-semibold">Unpaid Bal.</th>
                        <th className="px-3 py-2 text-left font-semibold">Period</th>
                        <th className="px-3 py-2 text-left font-semibold">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {previewRows.map((row) => (
                        <tr
                          key={row.rowIndex}
                          className={row.action === 'error' ? 'bg-red-50/50' : 'hover:bg-slate-50'}
                        >
                          <td className="px-3 py-2 font-mono text-slate-500">{row.rowIndex}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {row.action === 'create' && (
                              <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-800">
                                CREATE
                              </span>
                            )}
                            {row.action === 'update' && (
                              <span className="inline-block rounded bg-blue-100 px-2 py-0.5 font-mono text-[10px] font-bold text-blue-800">
                                UPDATE #{String(row.matchedEntry?.serialNumber || 0).padStart(3, '0')}
                              </span>
                            )}
                            {row.action === 'skip' && (
                              <span className="inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-600">
                                SKIP
                              </span>
                            )}
                            {row.action === 'error' && (
                              <span className="inline-block rounded bg-red-100 px-2 py-0.5 font-mono text-[10px] font-bold text-red-700">
                                ERROR
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-medium text-slate-900 whitespace-nowrap">
                            {row.payload.fullName || '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">
                            {row.payload.phone || '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                            {row.payload.propertyName || '—'} · {row.payload.roomNumber || '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                            {formatCurrency(row.payload.amountPaid, currencySymbol)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                            {formatCurrency(row.payload.unpaidBalance, currencySymbol)}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                            {row.payload.hasPaymentDetails
                              ? `${row.payload.durationMonths}mo (${row.payload.commencementDate} → ${row.payload.expiryDate})`
                              : 'Not Paid'}
                          </td>
                          <td className="px-3 py-2 text-[11px] whitespace-nowrap">
                            {row.errorMessage ? (
                              <span className="font-medium text-red-700">{row.errorMessage}</span>
                            ) : (
                              <span className="text-slate-500">{row.matchReason || 'New entry'}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <div className="text-xs text-slate-500">
            {counts.invalid > 0
              ? `${counts.invalid} row(s) with missing required fields will be skipped.`
              : 'All valid rows will be saved directly to Firestore.'}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleClose}
              disabled={importing}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || counts.actionable === 0 || Boolean(importResult)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132642] disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5 text-[#D4AF37]" />
              {importing
                ? 'Importing Records...'
                : `Import ${counts.actionable} Record${counts.actionable === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
