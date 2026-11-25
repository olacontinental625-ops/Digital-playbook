import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  CreditCard,
  Edit3,
  ExternalLink,
  FileWarning,
  Mail,
  Phone,
  X,
} from 'lucide-react';
import type {
  CustomColumnConfig,
  LogbookEntry,
  PaymentTransactionRecord,
} from '../../shared/types.ts';
import { formatCurrency } from '../lib/exports.ts';
import { recordCorrectionInFirestore } from '../lib/firestoreStore.ts';
import { StatusBadge } from './StatusBadge.tsx';

interface OccupantProfileDrawerProps {
  occupantId: string | null;
  adminUid: string;
  adminName: string;
  entries: LogbookEntry[];
  transactions: PaymentTransactionRecord[];
  onClose: () => void;
  onRecordPayment: (entry: LogbookEntry) => void;
  onEditOccupant: (entry: LogbookEntry) => void;
  onUpdated: () => Promise<void> | void;
  customColumns: CustomColumnConfig[];
  currencySymbol: string;
}

export const OccupantProfileDrawer: React.FC<OccupantProfileDrawerProps> = ({
  occupantId,
  adminUid,
  adminName,
  entries,
  transactions: allTransactions,
  onClose,
  onRecordPayment,
  onEditOccupant,
  onUpdated,
  customColumns,
  currencySymbol,
}) => {
  const [correctingTx, setCorrectingTx] = useState<PaymentTransactionRecord | null>(null);
  const [adjustedAmount, setAdjustedAmount] = useState('');
  const [adjustedExpiryDate, setAdjustedExpiryDate] = useState('');
  const [correctionNote, setCorrectionNote] = useState('');
  const [correctionError, setCorrectionError] = useState('');
  const [submittingCorrection, setSubmittingCorrection] = useState(false);

  const occupant = useMemo(
    () => (occupantId ? entries.find((e) => e.id === occupantId) ?? null : null),
    [occupantId, entries],
  );

  const transactions = useMemo(
    () =>
      occupantId
        ? allTransactions.filter((tx) => tx.occupantId === occupantId)
        : [],
    [occupantId, allTransactions],
  );

  if (!occupantId) return null;

  const progressPct =
    occupant && occupant.durationMonths
      ? Math.min(100, Math.round((occupant.monthsUsed / occupant.durationMonths) * 100))
      : 0;

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctingTx || !occupant) return;
    setCorrectionError('');
    setSubmittingCorrection(true);
    try {
      await recordCorrectionInFirestore(adminUid, adminName, occupant, correctingTx, {
        adjustedAmount: Number(adjustedAmount),
        adjustedExpiryDate,
        correctionNote,
      });
      setCorrectingTx(null);
      await onUpdated();
    } catch (err) {
      setCorrectionError(
        err instanceof Error ? err.message : 'Unable to save audited correction.',
      );
    } finally {
      setSubmittingCorrection(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/50">
      <div className="relative flex h-full w-full max-w-3xl flex-col bg-white border-l border-slate-200 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4 bg-[#0B192C] text-white">
          <div>
            {occupant ? (
              <>
                <div className="text-xs font-mono text-[#D4AF37]">
                  S/N #{String(occupant.serialNumber).padStart(3, '0')} · {occupant.propertyName} ·{' '}
                  {occupant.roomNumber}
                </div>
                <h2 className="mt-1 font-display text-xl font-semibold text-white">
                  {occupant.fullName}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-300">
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" />
                    {occupant.phone}
                  </span>
                  {occupant.email && (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3.5 w-3.5" />
                      {occupant.email}
                    </span>
                  )}
                  {occupant.isSample && (
                    <span className="text-[#D4AF37] font-medium">Sample Demonstration Record</span>
                  )}
                </div>
              </>
            ) : (
              <h2 className="font-display text-lg font-semibold">Occupant Profile</h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile drawer"
            className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!occupant ? (
            <div className="rounded-md border border-slate-200 p-6 text-sm text-slate-500">
              Occupant record not found.
            </div>
          ) : (
            <>
              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <StatusBadge
                    status={occupant.status}
                    daysRemaining={occupant.daysRemaining}
                    isExpiringWithin7Days={occupant.isExpiringWithin7Days}
                    isExpiringThisMonth={occupant.isExpiringThisMonth}
                    isExpiringWithin30Days={occupant.isExpiringWithin30Days}
                    compact
                  />
                  <span className="text-xs font-mono font-semibold text-red-700">
                    Unpaid Balance: {formatCurrency(occupant.unpaidBalance, currencySymbol)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onEditOccupant(occupant)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit Record
                  </button>
                  <button
                    type="button"
                    onClick={() => onRecordPayment(occupant)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#132642]"
                  >
                    <CreditCard className="h-3.5 w-3.5 text-[#D4AF37]" />
                    Record Payment / Renewal
                  </button>
                </div>
              </div>

              {/* Automatic Payment Duration Calculator Breakdown */}
              <section className="rounded-md border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <CalendarClock className="h-4 w-4 text-[#B4832C]" />
                    <span>Automatic Payment Duration Calculator</span>
                  </div>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {occupant.commencementDate || '—'} to {occupant.expiryDate || '—'}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-4">
                  <div>
                    <div className="text-xs text-slate-500">Total Months</div>
                    <div className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">
                      {occupant.durationMonths ?? 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Months Used</div>
                    <div className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">
                      {occupant.monthsUsed}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Months Remaining</div>
                    <div className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">
                      {occupant.monthsRemaining}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Days Remaining</div>
                    <div
                      className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
                        occupant.status === 'NOT PAID'
                          ? 'text-red-700'
                          : occupant.daysRemaining <= 30
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                      }`}
                    >
                      {occupant.daysRemaining}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Expiry Date</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums pt-0.5">
                      {occupant.expiryDate || 'None'}
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full transition-all ${
                        occupant.status === 'NOT PAID'
                          ? 'bg-red-600'
                          : occupant.daysRemaining <= 30
                            ? 'bg-amber-500'
                            : 'bg-emerald-600'
                      }`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              </section>

              {/* Notes & Custom Columns */}
              {(occupant.notes || customColumns.length > 0) && (
                <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-md border border-slate-200 bg-white p-4 text-sm">
                  {occupant.notes && (
                    <div className="sm:col-span-2">
                      <div className="text-xs font-semibold text-slate-500">Remarks / Notes</div>
                      <div className="mt-1 text-slate-800">{occupant.notes}</div>
                    </div>
                  )}
                  {customColumns.map((col) => (
                    <div key={col.id}>
                      <div className="text-xs font-semibold text-slate-500">{col.label}</div>
                      <div className="mt-0.5 text-slate-900">
                        {occupant.customFields?.[col.columnKey] || '—'}
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {/* Audited Correction Inline Form */}
              {correctingTx && (
                <form
                  onSubmit={handleSubmitCorrection}
                  className="rounded-md border border-amber-300 bg-amber-50 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                      <FileWarning className="h-4 w-4 text-amber-700" />
                      <span>Audited Correction for {correctingTx.transactionRef}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCorrectingTx(null)}
                      className="text-xs text-amber-900 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="text-xs text-amber-900">
                    Original transactions are never deleted. Submitting creates a permanent audited
                    adjustment entry in the ledger.
                  </p>
                  {correctionError && (
                    <div className="rounded bg-red-100 px-3 py-1.5 text-xs text-red-800">
                      {correctionError}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-amber-950">
                        Corrected Amount ({currencySymbol})
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        value={adjustedAmount}
                        onChange={(e) => setAdjustedAmount(e.target.value)}
                        className="mt-1 w-full rounded border border-amber-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-amber-950">
                        Corrected Expiry Date
                      </label>
                      <input
                        type="date"
                        required
                        value={adjustedExpiryDate}
                        onChange={(e) => setAdjustedExpiryDate(e.target.value)}
                        className="mt-1 w-full rounded border border-amber-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-amber-950">
                      Audit Reason *
                    </label>
                    <input
                      type="text"
                      required
                      minLength={5}
                      value={correctionNote}
                      onChange={(e) => setCorrectionNote(e.target.value)}
                      placeholder="Explain reason for audited correction..."
                      className="mt-1 w-full rounded border border-amber-300 bg-white px-2.5 py-1.5 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submittingCorrection}
                    className="rounded-md bg-amber-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-900"
                  >
                    {submittingCorrection ? 'Recording...' : 'Save Audited Correction'}
                  </button>
                </form>
              )}

              {/* Permanent Payment History */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    Permanent Payment History ({transactions.length})
                  </h3>
                  <span className="text-xs text-slate-500">Immutable transaction ledger</span>
                </div>

                {transactions.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    No payment transactions recorded for this occupant yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2.5 text-left font-semibold">Tx Date</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
                          <th className="px-3 py-2.5 text-left font-semibold">Duration</th>
                          <th className="px-3 py-2.5 text-left font-semibold">Start — Expiry</th>
                          <th className="px-3 py-2.5 text-left font-semibold">Reference</th>
                          <th className="px-3 py-2.5 text-left font-semibold">Recorded By</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Audit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {transactions.map((tx) => (
                          <tr
                            key={tx.id}
                            className={tx.isCorrection ? 'bg-amber-50/40' : 'hover:bg-slate-50'}
                          >
                            <td className="px-3 py-2.5 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                              {tx.transactionDate}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                              {tx.isCorrection && tx.amountReceived >= 0 ? '+' : ''}
                              {formatCurrency(tx.amountReceived, currencySymbol)}
                            </td>
                            <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">
                              {tx.durationLabel}
                            </td>
                            <td className="px-3 py-2.5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                              {tx.commencementDate} → {tx.expiryDate}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">
                              <div>{tx.transactionRef}</div>
                              {tx.receiptUrl && (
                                <a
                                  href={tx.receiptUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] font-sans font-medium text-[#0B192C] hover:underline"
                                >
                                  Receipt <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                              {tx.recordedBy}
                              {tx.correctionNote && (
                                <div className="text-[11px] text-amber-800">{tx.correctionNote}</div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right whitespace-nowrap">
                              {!tx.isCorrection && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCorrectingTx(tx);
                                    setAdjustedAmount(String(tx.amountReceived));
                                    setAdjustedExpiryDate(tx.expiryDate);
                                    setCorrectionNote('');
                                    setCorrectionError('');
                                  }}
                                  className="text-xs font-medium text-slate-500 hover:text-[#0B192C] hover:underline"
                                >
                                  Correct
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
