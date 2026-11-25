import React, { useMemo, useState } from 'react';
import {
  FileSpreadsheet,
  FileText,
  Filter,
} from 'lucide-react';
import type {
  LogbookEntry,
  PaymentTransactionRecord,
  PropertyRecord,
  RoomRecord,
} from '../../shared/types.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import {
  exportTransactionsToExcel,
  exportTransactionsToPdf,
  formatCurrency,
} from '../lib/exports.ts';

interface ReportsViewProps {
  entries: LogbookEntry[];
  transactions: PaymentTransactionRecord[];
  properties: PropertyRecord[];
  rooms: RoomRecord[];
  currencySymbol: string;
  onSelectOccupant: (id: string) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  entries,
  transactions,
  properties,
  rooms,
  currencySymbol,
  onSelectOccupant,
}) => {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [activeTab, setActiveTab] = useState<'monthly' | 'transactions' | 'occupancy'>('monthly');

  const filteredRooms = propertyId ? rooms.filter((r) => r.propertyId === propertyId) : rooms;

  const report = useMemo(() => {
    const matchingOccupants = entries.filter((e) => {
      if (propertyId && e.propertyId !== propertyId) return false;
      if (roomId && e.roomId !== roomId) return false;
      return true;
    });
    const occIdSet = new Set(matchingOccupants.map((e) => e.id));

    const filteredTx = transactions.filter((tx) => {
      if ((propertyId || roomId) && !occIdSet.has(tx.occupantId)) return false;
      if (fromDate && tx.transactionDate < fromDate) return false;
      if (toDate && tx.transactionDate > toDate) return false;
      return true;
    });

    const monthlyMap = new Map<string, { month: string; totalAmount: number; transactionCount: number }>();
    let totalCollected = 0;

    for (const tx of filteredTx) {
      totalCollected += tx.amountReceived;
      const month = (tx.transactionDate || '').slice(0, 7) || 'Unknown';
      const existing = monthlyMap.get(month) || { month, totalAmount: 0, transactionCount: 0 };
      existing.totalAmount += tx.amountReceived;
      existing.transactionCount += 1;
      monthlyMap.set(month, existing);
    }

    const monthlyCollections = Array.from(monthlyMap.values()).sort((a, b) =>
      b.month.localeCompare(a.month),
    );

    const paidCount = matchingOccupants.filter((e) => e.status === 'PAID').length;
    const notPaidCount = matchingOccupants.filter((e) => e.status === 'NOT PAID').length;
    const expiringThisMonthCount = matchingOccupants.filter(
      (e) => e.status === 'PAID' && e.isExpiringThisMonth,
    ).length;

    return {
      totals: {
        totalCollected,
        paidCount,
        notPaidCount,
        expiringThisMonthCount,
        transactionCount: filteredTx.length,
      },
      monthlyCollections,
      occupancyRecords: matchingOccupants,
      transactions: filteredTx,
    };
  }, [entries, transactions, propertyId, roomId, fromDate, toDate]);

  const maxMonthly = Math.max(1, ...report.monthlyCollections.map((m) => m.totalAmount));

  return (
    <div className="space-y-6">
      {/* Filters & Export Bar */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-1">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500">From Date</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500">To Date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500">Property</label>
              <select
                value={propertyId}
                onChange={(e) => {
                  setPropertyId(e.target.value);
                  setRoomId('');
                }}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">All Properties</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500">Room / Unit</label>
              <select
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">All Rooms</option>
                {filteredRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.roomNumber} ({r.propertyName})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end">
            <button
              type="button"
              onClick={() => {
                setFromDate('');
                setToDate('');
                setPropertyId('');
                setRoomId('');
              }}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Filter className="h-3.5 w-3.5" />
              Reset
            </button>
            <button
              type="button"
              onClick={() =>
                exportTransactionsToPdf(
                  report.transactions,
                  currencySymbol,
                  `Total Collected: ${formatCurrency(report.totals.totalCollected, currencySymbol)} | Paid: ${report.totals.paidCount} | Not Paid: ${report.totals.notPaidCount}`,
                )
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <FileText className="h-3.5 w-3.5 text-red-600" />
              PDF
            </button>
            <button
              type="button"
              onClick={() => exportTransactionsToExcel(report.transactions, currencySymbol)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
              Excel
            </button>
          </div>
        </div>
      </section>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border border-slate-200 bg-[#0B192C] p-5 text-white">
          <div className="text-xs text-slate-300">Total Payments Collected</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            {formatCurrency(report.totals.totalCollected, currencySymbol)}
          </div>
          <div className="mt-1 text-xs text-slate-400 tabular-nums">
            {report.totals.transactionCount} recorded transactions
          </div>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-white p-5">
          <div className="text-xs font-semibold text-emerald-700">Paid Occupants</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {report.totals.paidCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">Active payment coverage</div>
        </div>

        <div className="rounded-lg border border-red-200 bg-white p-5">
          <div className="text-xs font-semibold text-red-700">Not-Paid Occupants</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-red-700 tabular-nums">
            {report.totals.notPaidCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">Expired or unrecorded</div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-white p-5">
          <div className="text-xs font-semibold text-amber-800">Expiring This Month</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {report.totals.expiringThisMonthCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">Renewal due this month</div>
        </div>
      </div>

      {/* Report Tabs */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-4 py-2">
          {[
            { id: 'monthly', label: 'Monthly Collection History' },
            { id: 'transactions', label: 'Payment Transaction History' },
            { id: 'occupancy', label: 'Occupancy Records' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === tab.id
                  ? 'bg-[#0B192C] text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'monthly' ? (
          <div className="p-6 space-y-6">
            {report.monthlyCollections.length === 0 ? (
              <div className="text-center text-sm text-slate-500 py-8">
                No payment transactions recorded within the selected filter criteria.
              </div>
            ) : (
              <div className="space-y-3">
                {report.monthlyCollections.map((m) => {
                  const widthPct = Math.max(4, Math.round((m.totalAmount / maxMonthly) * 100));
                  return (
                    <div key={m.month} className="grid grid-cols-12 items-center gap-3 text-xs">
                      <div className="col-span-3 sm:col-span-2 font-mono font-semibold text-slate-700">
                        {m.month}
                      </div>
                      <div className="col-span-5 sm:col-span-7">
                        <div className="h-5 w-full rounded bg-slate-100 overflow-hidden">
                          <div
                            className="h-full bg-[#0B192C] transition-all"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                      <div className="col-span-4 sm:col-span-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {formatCurrency(m.totalAmount, currencySymbol)}{' '}
                        <span className="text-slate-400 font-normal">({m.transactionCount})</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : activeTab === 'transactions' ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Tx Date</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Reference</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Occupant</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Property · Room</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Duration</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Period</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Recorded By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600">
                      {tx.transactionDate}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-700">{tx.transactionRef}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      <button
                        type="button"
                        onClick={() => onSelectOccupant(tx.occupantId)}
                        className="hover:underline"
                      >
                        {tx.occupantName}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {tx.propertyName} · {tx.roomNumber}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                      {formatCurrency(tx.amountReceived, currencySymbol)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{tx.durationLabel}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600">
                      {tx.commencementDate} → {tx.expiryDate}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{tx.recordedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">S/N</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Occupant</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Property</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Room</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Expiry Date</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Months Used / Rem</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.occupancyRecords.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600">
                      #{String(o.serialNumber).padStart(3, '0')}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      <button
                        type="button"
                        onClick={() => onSelectOccupant(o.id)}
                        className="hover:underline"
                      >
                        {o.fullName}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{o.propertyName}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-900">{o.roomNumber}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-700">
                      {o.expiryDate || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {o.monthsUsed} / {o.monthsRemaining}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge
                        status={o.status}
                        daysRemaining={o.daysRemaining}
                        isExpiringWithin7Days={o.isExpiringWithin7Days}
                        isExpiringThisMonth={o.isExpiringThisMonth}
                        isExpiringWithin30Days={o.isExpiringWithin30Days}
                        compact
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
