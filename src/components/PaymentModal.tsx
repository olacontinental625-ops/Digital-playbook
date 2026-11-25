import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Upload, X } from 'lucide-react';
import {
  calculateExpiryDate,
  calculatePaymentMetrics,
  getTodayIso,
} from '../../shared/paymentCalc.ts';
import type { LogbookEntry } from '../../shared/types.ts';
import { recordPaymentInFirestore } from '../lib/firestoreStore.ts';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  adminUid: string;
  adminName: string;
  occupant: LogbookEntry | null;
  currencySymbol: string;
}

const DURATION_OPTIONS = [
  { label: 'Monthly (1 Month)', value: 1 },
  { label: '3 Months', value: 3 },
  { label: '6 Months', value: 6 },
  { label: '9 Months', value: 9 },
  { label: '12 Months', value: 12 },
  { label: '18 Months', value: 18 },
  { label: '24 Months', value: 24 },
];

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  adminUid,
  adminName,
  occupant,
  currencySymbol,
}) => {
  const today = getTodayIso();
  const [transactionDate, setTransactionDate] = useState(today);
  const [amountReceived, setAmountReceived] = useState('');
  const [unpaidBalanceAfter, setUnpaidBalanceAfter] = useState('0');
  const [durationPreset, setDurationPreset] = useState('12');
  const [customMonths, setCustomMonths] = useState('4');
  const [commencementDate, setCommencementDate] = useState(today);
  const [expiryOverride, setExpiryOverride] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [remarks, setRemarks] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !occupant) return;
    setError('');
    setTransactionDate(today);
    setAmountReceived(occupant.amountPaid ? String(occupant.amountPaid) : '');
    setUnpaidBalanceAfter(String(occupant.unpaidBalance ?? 0));
    const defaultMonths = occupant.durationMonths ?? 12;
    const presetMatch = DURATION_OPTIONS.find((d) => d.value === defaultMonths);
    if (presetMatch) {
      setDurationPreset(String(defaultMonths));
    } else {
      setDurationPreset('custom');
      setCustomMonths(String(defaultMonths));
    }

    if (occupant.expiryDate && occupant.status === 'PAID') {
      setCommencementDate(occupant.expiryDate);
    } else {
      setCommencementDate(today);
    }
    setExpiryOverride('');
    setTransactionRef('');
    setRemarks('');
    setReceiptFile(null);
  }, [isOpen, occupant, today]);

  const effectiveMonths = useMemo(() => {
    if (durationPreset === 'custom') {
      const m = Math.round(Number(customMonths));
      return Number.isFinite(m) && m >= 1 ? m : 1;
    }
    return Number(durationPreset);
  }, [durationPreset, customMonths]);

  const autoExpiry = useMemo(() => {
    if (!commencementDate || !/^\d{4}-\d{2}-\d{2}$/.test(commencementDate)) return '';
    return calculateExpiryDate(commencementDate, effectiveMonths);
  }, [commencementDate, effectiveMonths]);

  const finalExpiry = expiryOverride || autoExpiry;

  const previewMetrics = useMemo(() => {
    if (!commencementDate || !finalExpiry) return null;
    return calculatePaymentMetrics(commencementDate, finalExpiry, effectiveMonths, today);
  }, [commencementDate, finalExpiry, effectiveMonths, today]);

  if (!isOpen || !occupant) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await recordPaymentInFirestore(adminUid, adminName, occupant, {
        transactionDate,
        amountReceived: Number(amountReceived) || 0,
        unpaidBalanceAfter: Math.max(0, Number(unpaidBalanceAfter) || 0),
        durationMonths: effectiveMonths,
        commencementDate,
        expiryDate: finalExpiry,
        transactionRef,
        remarks,
        receiptFile,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto">
      <div className="my-8 w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Record Payment / Renewal
            </h2>
            <p className="text-xs text-slate-500">
              #{String(occupant.serialNumber).padStart(3, '0')} · {occupant.fullName} ·{' '}
              {occupant.propertyName} ({occupant.roomNumber})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Amount Received ({currencySymbol}) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amountReceived}
                onChange={(e) => {
                  const val = e.target.value;
                  setAmountReceived(val);
                  if (occupant.unpaidBalance > 0) {
                    const nextBal = Math.max(0, occupant.unpaidBalance - (Number(val) || 0));
                    setUnpaidBalanceAfter(String(nextBal));
                  }
                }}
                placeholder="0.00"
                className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums text-slate-900 focus:border-[#0B192C] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Remaining Unpaid Balance ({currencySymbol})
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={unpaidBalanceAfter}
                onChange={(e) => setUnpaidBalanceAfter(e.target.value)}
                placeholder="0.00"
                className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums text-slate-900 focus:border-[#0B192C] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Transaction Date *
              </label>
              <input
                type="date"
                required
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Payment Duration *
              </label>
              <select
                value={durationPreset}
                onChange={(e) => {
                  setDurationPreset(e.target.value);
                  setExpiryOverride('');
                }}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
              >
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </option>
                ))}
                <option value="custom">Custom Duration (Months)</option>
              </select>
            </div>

            {durationPreset === 'custom' ? (
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Custom Duration (Months) *
                </label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  required
                  value={customMonths}
                  onChange={(e) => {
                    setCustomMonths(e.target.value);
                    setExpiryOverride('');
                  }}
                  className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums text-slate-900 focus:border-[#0B192C] focus:outline-none"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Transaction Reference
                </label>
                <input
                  type="text"
                  value={transactionRef}
                  onChange={(e) => setTransactionRef(e.target.value)}
                  placeholder="Auto-generated if blank"
                  className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Commencement Date *
              </label>
              <input
                type="date"
                required
                value={commencementDate}
                onChange={(e) => {
                  setCommencementDate(e.target.value);
                  setExpiryOverride('');
                }}
                className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Expiry Date (Calculated)
              </label>
              <input
                type="date"
                required
                value={finalExpiry}
                onChange={(e) => setExpiryOverride(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Upload Receipt (Optional, Firebase Storage)
              </label>
              <label className="mt-1.5 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
                <Upload className="h-3.5 w-3.5 text-[#B4832C] shrink-0" />
                <span className="truncate">
                  {receiptFile ? receiptFile.name : 'Choose receipt image or PDF'}
                </span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          </div>

          {previewMetrics && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5 text-xs">
              <div className="flex items-center gap-2 font-semibold text-[#0B192C]">
                <CalendarClock className="h-4 w-4 text-[#B4832C]" />
                <span>Calculated New Period</span>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2 tabular-nums">
                <div>
                  <span className="text-slate-500">Total:</span>{' '}
                  <span className="font-mono font-semibold">{previewMetrics.totalMonths} mo</span>
                </div>
                <div>
                  <span className="text-slate-500">Used:</span>{' '}
                  <span className="font-mono font-semibold">{previewMetrics.monthsUsed} mo</span>
                </div>
                <div>
                  <span className="text-slate-500">Rem:</span>{' '}
                  <span className="font-mono font-semibold">{previewMetrics.monthsRemaining} mo</span>
                </div>
                <div>
                  <span className="text-slate-500">Days Left:</span>{' '}
                  <span className="font-mono font-semibold">{previewMetrics.daysRemaining} d</span>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700">Remarks</label>
            <input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Annual renewal bank transfer"
              className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
            />
          </div>

          <p className="text-[11px] text-slate-500">
            Previous payment transactions are preserved permanently in the occupant&apos;s ledger.
          </p>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-[#0B192C] px-5 py-2 text-sm font-semibold text-white hover:bg-[#132642] disabled:opacity-60"
            >
              {saving ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
