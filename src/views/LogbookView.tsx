import React, { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  CreditCard,
  Edit3,
  Eye,
  FileSpreadsheet,
  FileText,
  Plus,
  Printer,
  Search,
  Upload,
} from 'lucide-react';
import type {
  CustomColumnConfig,
  LogbookEntry,
  PropertyRecord,
} from '../../shared/types.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import {
  exportLogbookToExcel,
  exportLogbookToPdf,
  formatCurrency,
} from '../lib/exports.ts';

interface LogbookViewProps {
  entries: LogbookEntry[];
  properties: PropertyRecord[];
  customColumns: CustomColumnConfig[];
  currencySymbol: string;
  initialFilter?: string;
  onAddOccupant: () => void;
  onImportCsv: () => void;
  onEditOccupant: (entry: LogbookEntry) => void;
  onRecordPayment: (entry: LogbookEntry) => void;
  onSelectOccupant: (id: string) => void;
}

type SortKey =
  | 'serialNumber'
  | 'transactionDate'
  | 'fullName'
  | 'propertyName'
  | 'roomNumber'
  | 'amountPaid'
  | 'unpaidBalance'
  | 'commencementDate'
  | 'expiryDate'
  | 'monthsUsed'
  | 'monthsRemaining'
  | 'status';

export const LogbookView: React.FC<LogbookViewProps> = ({
  entries,
  properties,
  customColumns,
  currencySymbol,
  initialFilter = 'all',
  onAddOccupant,
  onImportCsv,
  onEditOccupant,
  onRecordPayment,
  onSelectOccupant,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialFilter);
  const [propertyFilter, setPropertyFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('serialNumber');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const visibleCustomCols = useMemo(
    () => customColumns.filter((c) => c.isVisible),
    [customColumns],
  );

  const uniqueRooms = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (!propertyFilter || e.propertyId === propertyFilter) {
        set.add(e.roomNumber);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [entries, propertyFilter]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return entries
      .filter((e) => {
        if (statusFilter === 'paid' && e.status !== 'PAID') return false;
        if (statusFilter === 'not_paid' && e.status !== 'NOT PAID') return false;
        if (statusFilter === 'expiring_week' && !(e.status === 'PAID' && e.isExpiringWithin7Days))
          return false;
        if (statusFilter === 'expiring_month' && !(e.status === 'PAID' && e.isExpiringThisMonth))
          return false;
        if (statusFilter === 'expired' && !e.isExpired) return false;

        if (propertyFilter && e.propertyId !== propertyFilter) return false;
        if (roomFilter && e.roomNumber !== roomFilter) return false;
        if (dateFrom && (!e.transactionDate || e.transactionDate < dateFrom)) return false;
        if (dateTo && (!e.transactionDate || e.transactionDate > dateTo)) return false;

        if (q) {
          const customMatch = Object.values(e.customFields || {}).some((v) =>
            String(v).toLowerCase().includes(q),
          );
          const match =
            e.fullName.toLowerCase().includes(q) ||
            e.phone.toLowerCase().includes(q) ||
            e.roomNumber.toLowerCase().includes(q) ||
            e.propertyName.toLowerCase().includes(q) ||
            e.remarks.toLowerCase().includes(q) ||
            String(e.serialNumber).includes(q) ||
            customMatch;
          if (!match) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const factor = sortDir === 'asc' ? 1 : -1;
        const valA = a[sortKey];
        const valB = b[sortKey];
        if (typeof valA === 'number' && typeof valB === 'number') {
          return (valA - valB) * factor;
        }
        return String(valA ?? '').localeCompare(String(valB ?? '')) * factor;
      });
  }, [
    entries,
    searchQuery,
    statusFilter,
    propertyFilter,
    roomFilter,
    dateFrom,
    dateTo,
    sortKey,
    sortDir,
  ]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const renderSortHeader = (label: string, key: SortKey, alignRight = false) => (
    <th className={`px-3 py-3 text-xs font-semibold whitespace-nowrap ${alignRight ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={`inline-flex items-center gap-1 hover:text-white transition-colors ${
          alignRight ? 'flex-row-reverse' : ''
        }`}
      >
        <span>{label}</span>
        <ArrowUpDown className="h-3 w-3 opacity-70" />
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="no-print rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Status / Urgency Segmented Filters */}
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
            {[
              { id: 'all', label: 'All' },
              { id: 'paid', label: 'Paid' },
              { id: 'not_paid', label: 'Not Paid' },
              { id: 'expiring_week', label: 'Expiring This Week' },
              { id: 'expiring_month', label: 'Expiring This Month' },
              { id: 'expired', label: 'Expired' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  statusFilter === tab.id
                    ? 'bg-[#0B192C] text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Export & Print Controls */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => exportLogbookToPdf(filteredEntries, customColumns, currencySymbol)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <FileText className="h-3.5 w-3.5 text-red-600" />
              Export PDF
            </button>
            <button
              type="button"
              onClick={() => exportLogbookToExcel(filteredEntries, customColumns, currencySymbol)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
              Export Excel
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Printer className="h-3.5 w-3.5 text-slate-600" />
              Print Register
            </button>
            <button
              type="button"
              onClick={onImportCsv}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5 text-[#B4832C]" />
              Import CSV
            </button>
            <button
              type="button"
              onClick={onAddOccupant}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#132642] whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5 text-[#D4AF37]" />
              Add Occupant
            </button>
          </div>
        </div>

        {/* Search & Secondary Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, phone, room, property, remarks..."
              className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-[#0B192C] focus:outline-none"
            />
          </div>

          <select
            value={propertyFilter}
            onChange={(e) => {
              setPropertyFilter(e.target.value);
              setRoomFilter('');
            }}
            aria-label="Filter by property"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0B192C] focus:outline-none"
          >
            <option value="">All Properties / Locations</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            value={roomFilter}
            onChange={(e) => setRoomFilter(e.target.value)}
            aria-label="Filter by room"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0B192C] focus:outline-none"
          >
            <option value="">All Rooms / Units</option>
            {uniqueRooms.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="Payment date from"
              title="Payment date from"
              className="w-full rounded-md border border-slate-300 px-2 py-2 font-mono text-[11px] text-slate-900 focus:border-[#0B192C] focus:outline-none"
            />
            <span className="text-xs text-slate-400">–</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="Payment date to"
              title="Payment date to"
              className="w-full rounded-md border border-slate-300 px-2 py-2 font-mono text-[11px] text-slate-900 focus:border-[#0B192C] focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Main 14-Column Logbook Register Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 text-xs text-slate-500">
          <span>
            Showing <strong className="font-mono text-slate-900">{filteredEntries.length}</strong> of{' '}
            <strong className="font-mono text-slate-900">{entries.length}</strong> logbook entries
          </span>
          <span className="hidden sm:inline">
            Preserving all 14 standard register columns
            {visibleCustomCols.length > 0 ? ` + ${visibleCustomCols.length} custom` : ''}
          </span>
        </div>

        {filteredEntries.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-slate-600">No logbook entries match your current filters.</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setPropertyFilter('');
                setRoomFilter('');
                setDateFrom('');
                setDateTo('');
              }}
              className="mt-3 rounded-md border border-slate-300 px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-[#0B192C] text-slate-200">
                <tr>
                  {renderSortHeader('S/N', 'serialNumber')}
                  {renderSortHeader('Date of Tx', 'transactionDate')}
                  {renderSortHeader("Occupant's Full Name", 'fullName')}
                  {renderSortHeader('Property / Location', 'propertyName')}
                  {renderSortHeader('Room / Unit', 'roomNumber')}
                  {renderSortHeader('Amount Paid', 'amountPaid', true)}
                  {renderSortHeader('Unpaid Bal.', 'unpaidBalance', true)}
                  <th className="px-3 py-3 text-left text-xs font-semibold whitespace-nowrap">
                    Payment Duration
                  </th>
                  {renderSortHeader('Start Date', 'commencementDate')}
                  {renderSortHeader('Expiry Date', 'expiryDate')}
                  {renderSortHeader('Months Used', 'monthsUsed', true)}
                  {renderSortHeader('Months Rem.', 'monthsRemaining', true)}
                  {renderSortHeader('Payment Status', 'status')}
                  <th className="px-3 py-3 text-left text-xs font-semibold whitespace-nowrap">
                    Phone Number
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-semibold whitespace-nowrap">
                    Remarks
                  </th>
                  {visibleCustomCols.map((col) => (
                    <th key={col.id} className="px-3 py-3 text-left text-xs font-semibold whitespace-nowrap">
                      {col.label}
                    </th>
                  ))}
                  <th className="no-print px-3 py-3 text-right text-xs font-semibold whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-3 py-2.5 font-mono font-semibold tabular-nums text-slate-700 whitespace-nowrap">
                      #{String(entry.serialNumber).padStart(3, '0')}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {entry.transactionDate || '—'}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-900 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onSelectOccupant(entry.id)}
                        className="text-left hover:text-[#0B192C] hover:underline"
                      >
                        {entry.fullName}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">
                      {entry.propertyName}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                      {entry.roomNumber}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                      {formatCurrency(entry.amountPaid, currencySymbol)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                        entry.unpaidBalance > 0 ? 'text-red-700' : 'text-slate-400'
                      }`}
                    >
                      {formatCurrency(entry.unpaidBalance, currencySymbol)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">
                      {entry.durationLabel || '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {entry.commencementDate || '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-slate-900 whitespace-nowrap">
                      {entry.expiryDate || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                      {entry.monthsUsed}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                      {entry.monthsRemaining}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <StatusBadge
                        status={entry.status}
                        daysRemaining={entry.daysRemaining}
                        isExpiringWithin7Days={entry.isExpiringWithin7Days}
                        isExpiringThisMonth={entry.isExpiringThisMonth}
                        isExpiringWithin30Days={entry.isExpiringWithin30Days}
                      />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap">
                      {entry.phone}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[220px] truncate" title={entry.remarks}>
                      {entry.remarks || '—'}
                    </td>
                    {visibleCustomCols.map((col) => (
                      <td key={col.id} className="px-3 py-2.5 text-slate-700 whitespace-nowrap">
                        {entry.customFields?.[col.columnKey] || '—'}
                      </td>
                    ))}
                    <td className="no-print px-3 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onSelectOccupant(entry.id)}
                          title="View Profile & History"
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#0B192C]"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditOccupant(entry)}
                          title="Edit Occupant"
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#0B192C]"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRecordPayment(entry)}
                          title="Record Payment / Renewal"
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-emerald-700"
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                        </button>
                      </div>
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
