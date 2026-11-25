import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  Database,
  Plus,
  Search,
  Trash2,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import type {
  DashboardSummary,
  LogbookEntry,
  PaymentTransactionRecord,
} from '../../shared/types.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { formatCurrency } from '../lib/exports.ts';

interface DashboardViewProps {
  summary: DashboardSummary;
  entries: LogbookEntry[];
  recentTransactions: PaymentTransactionRecord[];
  loading: boolean;
  onAddOccupant: () => void;
  onSelectOccupant: (id: string) => void;
  onRecordPayment: (entry: LogbookEntry) => void;
  onNavigateLogbook: (presetFilter?: string) => void;
  onSeedSampleData: () => Promise<void>;
  onClearSampleData: () => Promise<void>;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  summary,
  entries,
  recentTransactions,
  loading,
  onAddOccupant,
  onSelectOccupant,
  onRecordPayment,
  onNavigateLogbook,
  onSeedSampleData,
  onClearSampleData,
}) => {
  const [quickQuery, setQuickQuery] = useState('');
  const [sampleBusy, setSampleBusy] = useState(false);

  const searchResults = useMemo(() => {
    const q = quickQuery.trim().toLowerCase();
    if (!q) return [];
    return entries
      .filter(
        (e) =>
          e.fullName.toLowerCase().includes(q) ||
          e.phone.toLowerCase().includes(q) ||
          e.roomNumber.toLowerCase().includes(q) ||
          e.propertyName.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [entries, quickQuery]);

  const urgentEntries = useMemo(() => {
    return entries
      .filter((e) => e.status === 'NOT PAID' || e.isExpiringWithin30Days || e.isExpiringThisMonth)
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'NOT PAID' ? -1 : 1;
        return a.daysRemaining - b.daysRemaining;
      })
      .slice(0, 10);
  }, [entries]);

  const handleSeedSample = async () => {
    setSampleBusy(true);
    try {
      await onSeedSampleData();
    } finally {
      setSampleBusy(false);
    }
  };

  const handleClearSample = async () => {
    setSampleBusy(true);
    try {
      await onClearSampleData();
    } finally {
      setSampleBusy(false);
    }
  };

  if (loading && entries.length === 0) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 7 }).map((_, idx) => (
            <div key={idx} className="h-28 rounded-lg border border-slate-200 bg-white p-5 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sample Data Notice or Onboarding Banner */}
      {summary.hasSampleData ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-5 py-3.5 text-sm">
          <div className="flex items-center gap-2.5 text-amber-950">
            <Database className="h-4 w-4 shrink-0 text-amber-700" />
            <span>
              <strong>Sample Demonstration Data Active:</strong> Records marked{' '}
              <span className="font-mono text-xs">(Sample)</span> are for demonstration only.
            </span>
          </div>
          <button
            type="button"
            disabled={sampleBusy}
            onClick={handleClearSample}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {sampleBusy ? 'Clearing...' : 'Clear Sample Data'}
          </button>
        </div>
      ) : summary.totalOccupants === 0 ? (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-6">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Your Digital Logbook is Ready
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Start recording your real occupants and payments, or load clearly labeled sample
              demonstration records to preview expiry alerts, duration calculations, and exports.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              disabled={sampleBusy}
              onClick={handleSeedSample}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Database className="h-4 w-4 text-[#B4832C]" />
              {sampleBusy ? 'Loading...' : 'Load Sample Data'}
            </button>
            <button
              type="button"
              onClick={onAddOccupant}
              className="inline-flex items-center gap-2 rounded-md bg-[#0B192C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#132642]"
            >
              <Plus className="h-4 w-4 text-[#D4AF37]" />
              Add First Occupant
            </button>
          </div>
        </div>
      ) : null}

      {/* 7 Required Summary Cards */}
      <section aria-label="Dashboard Summary Metrics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigateLogbook('all')}
          className="text-left rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-300 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Registered Occupants</span>
            <Users className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-2.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {summary.totalOccupants}
          </div>
          <div className="mt-1 text-xs text-slate-500">Active register entries</div>
        </button>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Rooms / Units</span>
            <Building2 className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-2.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {summary.totalRooms}
          </div>
          <div className="mt-1 text-xs text-slate-500">Managed property units</div>
        </div>

        <button
          type="button"
          onClick={() => onNavigateLogbook('paid')}
          className="text-left rounded-lg border border-emerald-200 bg-white p-5 hover:border-emerald-300 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-emerald-700">
            <span>Currently Paid Occupants</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2.5 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {summary.paidOccupants}
          </div>
          <div className="mt-1 text-xs text-emerald-700/80">Status: PAID · Active coverage</div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateLogbook('not_paid')}
          className="text-left rounded-lg border border-red-200 bg-white p-5 hover:border-red-300 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-red-700">
            <span>Not-Paid Occupants</span>
            <XCircle className="h-4 w-4 text-red-600" />
          </div>
          <div className="mt-2.5 font-mono text-2xl font-semibold text-red-700 tabular-nums">
            {summary.notPaidOccupants}
          </div>
          <div className="mt-1 text-xs text-red-700/80">Status: NOT PAID · Expired or unrecorded</div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateLogbook('expiring_month')}
          className="text-left rounded-lg border border-amber-200 bg-white p-5 hover:border-amber-300 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-amber-800">
            <span>Expiring This Month</span>
            <CalendarClock className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2.5 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {summary.expiringThisMonth}
          </div>
          <div className="mt-1 text-xs text-amber-700/80">Status: EXPIRING SOON · Calendar month</div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateLogbook('expiring_week')}
          className="text-left rounded-lg border border-amber-200 bg-white p-5 hover:border-amber-300 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-amber-800">
            <span>Expiring Within 7 Days</span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2.5 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {summary.expiringWithin7Days}
          </div>
          <div className="mt-1 text-xs text-amber-700/80">Status: EXPIRING SOON · Immediate</div>
        </button>

        <div className="rounded-lg border border-red-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-red-700">
            <span>Total Unpaid Balance</span>
            <Wallet className="h-4 w-4 text-red-600" />
          </div>
          <div className="mt-2.5 font-mono text-2xl font-semibold text-red-700 tabular-nums">
            {formatCurrency(summary.totalUnpaidBalance, summary.currencySymbol)}
          </div>
          <div className="mt-1 text-xs text-red-700/80">
            Outstanding balance across register ({summary.currencyCode})
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-[#0B192C] p-5 text-white">
          <div className="flex items-center justify-between text-xs font-medium text-slate-300">
            <span>Total Amount Collected</span>
            <Wallet className="h-4 w-4 text-[#D4AF37]" />
          </div>
          <div className="mt-2.5 font-mono text-2xl font-semibold text-white tabular-nums">
            {formatCurrency(summary.totalAmountCollected, summary.currencySymbol)}
          </div>
          <div className="mt-1 text-xs text-slate-300">
            Cumulative verified receipts ({summary.currencyCode})
          </div>
        </div>
      </section>

      {/* Fast Occupant Search Bar */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Fast Occupant Lookup
            </h2>
            <p className="text-xs text-slate-500">
              Search by occupant name, phone number, room number, or property location.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateLogbook('all')}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#0B192C] hover:underline whitespace-nowrap"
          >
            <span>Open Full Digital Logbook</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={quickQuery}
            onChange={(e) => setQuickQuery(e.target.value)}
            placeholder="Type occupant name, phone number, room (e.g. Room 05), or property..."
            className="w-full rounded-md border border-slate-300 py-2.5 pl-10 pr-4 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none focus:ring-1 focus:ring-[#0B192C]"
          />
        </div>

        {quickQuery.trim() && (
          <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
            {searchResults.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">
                No matching occupants found for &ldquo;{quickQuery}&rdquo;.
              </div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Occupant</th>
                    <th className="px-3 py-2 text-left font-semibold">Property · Room</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 text-left font-semibold">Duration</th>
                    <th className="px-3 py-2 text-left font-semibold">Expiry Date</th>
                    <th className="px-3 py-2 text-right font-semibold">Months Rem.</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {searchResults.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-medium text-slate-900">
                        <button
                          type="button"
                          onClick={() => onSelectOccupant(e.id)}
                          className="text-left hover:underline"
                        >
                          {e.fullName}
                        </button>
                        <div className="font-mono text-[11px] text-slate-500">{e.phone}</div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {e.propertyName} · <span className="font-semibold">{e.roomNumber}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-900">
                        {formatCurrency(e.amountPaid, summary.currencySymbol)}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{e.durationLabel || '—'}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-slate-700">
                        {e.expiryDate || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-900">
                        {e.monthsRemaining}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge
                          status={e.status}
                          daysRemaining={e.daysRemaining}
                          isExpiringWithin7Days={e.isExpiringWithin7Days}
                          isExpiringThisMonth={e.isExpiringThisMonth}
                          isExpiringWithin30Days={e.isExpiringWithin30Days}
                          compact
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onRecordPayment(e)}
                          className="text-xs font-semibold text-[#0B192C] hover:underline"
                        >
                          Renew
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {/* Two-Column Action Watchlist & Recent Transactions */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Expiring & Not Paid Watchlist */}
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Action Required: Not Paid &amp; Expiring Soon
              </h2>
              <p className="text-xs text-slate-500">
                Occupants requiring renewal follow-up within 30 days or already expired.
              </p>
            </div>
            <span className="font-mono text-xs font-semibold text-slate-600 tabular-nums">
              {urgentEntries.length} listed
            </span>
          </div>

          {urgentEntries.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              All registered occupants currently have active payment coverage beyond 30 days.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">Occupant</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Unit</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Expiry</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {urgentEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        <button
                          type="button"
                          onClick={() => onSelectOccupant(entry.id)}
                          className="text-left hover:underline"
                        >
                          {entry.fullName}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {entry.roomNumber} · {entry.propertyName}
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {entry.expiryDate || 'None'}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge
                          status={entry.status}
                          daysRemaining={entry.daysRemaining}
                          isExpiringWithin7Days={entry.isExpiringWithin7Days}
                          isExpiringThisMonth={entry.isExpiringThisMonth}
                          isExpiringWithin30Days={entry.isExpiringWithin30Days}
                          compact
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onRecordPayment(entry)}
                          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
                        >
                          Record Payment
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Recent Transactions */}
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Recent Payment Transactions
              </h2>
              <p className="text-xs text-slate-500">
                Latest entries recorded in the permanent financial ledger.
              </p>
            </div>
          </div>

          {recentTransactions.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No transactions recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Occupant</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Duration</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {tx.transactionDate}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        <button
                          type="button"
                          onClick={() => onSelectOccupant(tx.occupantId)}
                          className="text-left hover:underline"
                        >
                          {tx.occupantName}
                        </button>
                        <div className="text-[11px] text-slate-500">
                          {tx.propertyName} · {tx.roomNumber}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">
                        {tx.durationLabel}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-emerald-700 whitespace-nowrap">
                        {formatCurrency(tx.amountReceived, summary.currencySymbol)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">
                        {tx.transactionRef}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
