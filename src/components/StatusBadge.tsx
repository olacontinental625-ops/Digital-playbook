import React from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { PaymentStatus } from '../../shared/paymentCalc.ts';

interface StatusBadgeProps {
  status: PaymentStatus;
  daysRemaining?: number;
  isExpiringWithin7Days?: boolean;
  isExpiringThisMonth?: boolean;
  isExpiringWithin30Days?: boolean;
  compact?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  daysRemaining = 0,
  isExpiringWithin7Days = false,
  isExpiringThisMonth = false,
  isExpiringWithin30Days = false,
  compact = false,
}) => {
  if (status === 'NOT PAID') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 whitespace-nowrap">
        <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />
        <span>NOT PAID</span>
      </span>
    );
  }

  const expiringSoon = isExpiringWithin7Days || isExpiringThisMonth || isExpiringWithin30Days;

  return (
    <div className={`inline-flex ${compact ? 'flex-row items-center gap-1.5' : 'flex-col items-start gap-1'}`}>
      <span className="inline-flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
        <span>PAID</span>
      </span>
      {expiringSoon && (
        <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 whitespace-nowrap tabular-nums">
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
          <span>{daysRemaining}d left</span>
        </span>
      )}
    </div>
  );
};
