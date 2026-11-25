import React, { useMemo } from 'react';
import {
  AlertCircle,
  Building2,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import type {
  DashboardSummary,
  LogbookEntry,
  UserProfile,
} from '../../shared/types.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { PWAInstallButton } from '../hooks/usePWAInstall.tsx';
import { OLA_LOGO_PATH } from '../lib/firebase.ts';
import { formatCurrency } from '../lib/exports.ts';

interface UserPortalViewProps {
  userProfile: UserProfile | null;
  userEmail: string;
  userDisplayName: string;
  isAdmin: boolean;
  summary: DashboardSummary;
  personalRecords: LogbookEntry[];
  loading: boolean;
  onSignOut: () => Promise<void>;
  onOpenAdminDashboard: () => void;
}

export const UserPortalView: React.FC<UserPortalViewProps> = ({
  userProfile,
  userEmail,
  userDisplayName,
  isAdmin,
  summary,
  personalRecords,
  loading,
  onSignOut,
  onOpenAdminDashboard,
}) => {
  const personalUnpaidTotal = useMemo(
    () => personalRecords.reduce((sum, r) => sum + Math.max(0, Number(r.unpaidBalance || 0)), 0),
    [personalRecords],
  );

  const displayName = userProfile?.fullName || userDisplayName || 'OLA Continental Member';
  const displayEmail = userProfile?.email || userEmail;
  const displayPhone = userProfile?.phone || 'Not provided';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top OLA Continental Header */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={OLA_LOGO_PATH}
              alt="OLA Continental logo"
              className="h-10 w-10 rounded-md border border-[#C59B38]/50 object-cover bg-white shrink-0"
            />
            <div className="min-w-0">
              <div className="font-display text-base font-bold tracking-tight text-[#0B192C] truncate">
                OLA CONTINENTAL
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                Properties &amp; Associate · User Account &amp; Balance Portal
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton />
            {isAdmin && (
              <button
                type="button"
                onClick={onOpenAdminDashboard}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#132642] whitespace-nowrap"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-[#D4AF37]" />
                <span>Admin Dashboard</span>
              </button>
            )}
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6 space-y-6">
        {/* Welcome / Profile Strip */}
        <section className="rounded-lg border border-slate-200 bg-[#0B192C] p-6 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img
              src={OLA_LOGO_PATH}
              alt="OLA Continental"
              className="hidden sm:block h-16 w-16 rounded-md border border-[#C59B38]/60 object-cover bg-white shrink-0"
            />
            <div>
              <div className="text-xs font-semibold tracking-wider text-[#D4AF37] uppercase">
                Signed-In Member Profile
              </div>
              <h1 className="mt-1 font-display text-2xl font-semibold text-white">
                Welcome, {displayName}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-300">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-[#D4AF37]" />
                  {displayEmail}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-[#D4AF37]" />
                  {displayPhone}
                </span>
              </div>
            </div>
          </div>

          {!isAdmin && (
            <a
              href="/?portal=admin"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 self-start md:self-center rounded-md border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-white/15 whitespace-nowrap"
            >
              <span>Administrator Login</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </section>

        {/* Required Overview Cards: Amount of People Recorded on Database & Unpaid Balance Section */}
        <section aria-label="Database and Unpaid Balance Summary">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900">
              OLA Continental Database &amp; Unpaid Balance Summary
            </h2>
            <span className="text-xs text-slate-500">Live Firestore records</span>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="h-28 rounded-lg border border-slate-200 bg-white animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Total People Recorded on Database */}
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>People Recorded on Database</span>
                  <Users className="h-4 w-4 text-[#0B192C]" />
                </div>
                <div className="mt-2.5 font-mono text-3xl font-semibold text-slate-900 tabular-nums">
                  {summary.totalOccupants}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Across {summary.totalRooms} managed rooms / units
                </div>
              </div>

              {/* Unpaid Balance Section Card */}
              <div className="rounded-lg border border-red-200 bg-red-50/40 p-5">
                <div className="flex items-center justify-between text-xs font-semibold text-red-800">
                  <span>Total Unpaid Balance</span>
                  <Wallet className="h-4 w-4 text-red-600" />
                </div>
                <div className="mt-2.5 font-mono text-3xl font-semibold text-red-700 tabular-nums">
                  {formatCurrency(summary.totalUnpaidBalance, summary.currencySymbol)}
                </div>
                <div className="mt-1 text-xs text-red-700/80">
                  Database-wide outstanding balance ({summary.currencyCode})
                </div>
              </div>

              {/* Unpaid / Not Paid Accounts */}
              <div className="rounded-lg border border-red-200 bg-white p-5">
                <div className="flex items-center justify-between text-xs font-semibold text-red-700">
                  <span>Unpaid Occupant Accounts</span>
                  <AlertCircle className="h-4 w-4 text-red-600" />
                </div>
                <div className="mt-2.5 font-mono text-3xl font-semibold text-red-700 tabular-nums">
                  {summary.notPaidOccupants}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Accounts currently flagged NOT PAID
                </div>
              </div>

              {/* Paid Accounts */}
              <div className="rounded-lg border border-emerald-200 bg-white p-5">
                <div className="flex items-center justify-between text-xs font-semibold text-emerald-700">
                  <span>Active Paid Accounts</span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="mt-2.5 font-mono text-3xl font-semibold text-emerald-700 tabular-nums">
                  {summary.paidOccupants}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {summary.expiringThisMonth} expiring this month
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Dedicated Unpaid Balance Section (Personal Linked Records + Database Balance Context) */}
        <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 bg-slate-50">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Unpaid Balance &amp; Linked Unit Status
              </h2>
              <p className="text-xs text-slate-500">
                Displays your personal OLA Continental occupant balance and unit payment status when
                linked to your verified account email.
              </p>
            </div>
            <div className="rounded-md border border-red-200 bg-white px-4 py-2 text-right">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Your Account Unpaid Balance
              </div>
              <div className="font-mono text-lg font-bold text-red-700 tabular-nums">
                {formatCurrency(personalUnpaidTotal, summary.currencySymbol)}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="p-6 text-xs text-slate-500">Checking linked occupant records...</div>
          ) : personalRecords.length === 0 ? (
            <div className="p-8 text-center">
              <Building2 className="mx-auto h-8 w-8 text-slate-300" />
              <div className="mt-2 text-sm font-semibold text-slate-800">
                No Personal Unit Assigned to {displayEmail}
              </div>
              <p className="mt-1 mx-auto max-w-lg text-xs text-slate-500 leading-relaxed">
                Currently <strong>{summary.totalOccupants}</strong> occupant
                {summary.totalOccupants === 1 ? ' is' : 's are'} recorded in the OLA Continental
                database with a combined unpaid balance of{' '}
                <strong className="font-mono text-red-700">
                  {formatCurrency(summary.totalUnpaidBalance, summary.currencySymbol)}
                </strong>
                . If you are a registered occupant, ask the administrator to attach your verified
                email address to your room record.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">S/N</th>
                    <th className="px-4 py-3 text-left font-semibold">Property / Location</th>
                    <th className="px-4 py-3 text-left font-semibold">Room / Unit</th>
                    <th className="px-4 py-3 text-right font-semibold">Last Paid</th>
                    <th className="px-4 py-3 text-right font-semibold">Unpaid Balance</th>
                    <th className="px-4 py-3 text-left font-semibold">Expiry Date</th>
                    <th className="px-4 py-3 text-right font-semibold">Months Rem.</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {personalRecords.map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-700">
                        #{String(rec.serialNumber).padStart(3, '0')}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{rec.propertyName}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">{rec.roomNumber}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                        {formatCurrency(rec.amountPaid, summary.currencySymbol)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-red-700">
                        {formatCurrency(rec.unpaidBalance, summary.currencySymbol)}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-700">
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
                          {rec.expiryDate || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {rec.monthsRemaining} mo
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={rec.status}
                          daysRemaining={rec.daysRemaining}
                          isExpiringWithin7Days={rec.isExpiringWithin7Days}
                          isExpiringThisMonth={rec.isExpiringThisMonth}
                          isExpiringWithin30Days={rec.isExpiringWithin30Days}
                          compact
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
