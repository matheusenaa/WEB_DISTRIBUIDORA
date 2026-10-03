import { cn } from '@/lib/cn';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  className?: string;
}

function Skeleton({ variant = 'text', width, height, className, ...props }: SkeletonProps) {
  const baseStyles = 'animate-pulse bg-muted rounded';
  
  let variantStyles = '';
  let defaultWidth = width;
  let defaultHeight = height;

  switch (variant) {
    case 'circular':
      variantStyles = 'rounded-full';
      defaultWidth = width ?? '1rem';
      defaultHeight = height ?? '1rem';
      break;
    case 'rectangular':
      variantStyles = 'rounded-md';
      defaultWidth = width ?? '100%';
      defaultHeight = height ?? '1rem';
      break;
    case 'text':
    default:
      variantStyles = 'rounded';
      defaultWidth = width ?? '100%';
      defaultHeight = height ?? '0.875rem';
      break;
  }

  return (
    <div
      className={cn(baseStyles, variantStyles, className)}
      style={{ width: defaultWidth, height: defaultHeight }}
      {...props}
    />
  );
}

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  showHeader?: boolean;
}

function TableSkeleton({ rows = 5, columns = 4, showHeader = true }: TableSkeletonProps) {
  return (
    <div className="space-y-3">
      {showHeader && (
        <div className="flex gap-4">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} variant="text" width={`${100 / columns}%`} height="0.75rem" className="flex-1" />
          ))}
        </div>
      )}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton
              key={colIndex}
              variant="text"
              width={`${100 / columns}%`}
              height="1rem"
              className="flex-1"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

interface CardSkeletonProps {
  title?: boolean;
  description?: boolean;
  content?: boolean;
  actions?: boolean;
  className?: string;
}

function CardSkeleton({ title = true, description = true, content = true, actions = false, className }: CardSkeletonProps) {
  return (
    <div className={cn('space-y-4 p-4 border border-border rounded-lg bg-card', className)}>
      {title && <Skeleton variant="text" width="40%" height="1.25rem" />}
      {description && <Skeleton variant="text" width="60%" height="0.875rem" />}
      {content && (
        <div className="space-y-3">
          <Skeleton variant="rectangular" width="100%" height="60px" />
          <Skeleton variant="rectangular" width="100%" height="60px" />
          <Skeleton variant="rectangular" width="100%" height="60px" />
        </div>
      )}
      {actions && (
        <div className="flex gap-2 justify-end pt-4">
          <Skeleton variant="rectangular" width="80px" height="36px" />
          <Skeleton variant="rectangular" width="100px" height="36px" />
        </div>
      )}
    </div>
  );
}

interface ListSkeletonProps {
  items?: number;
  hasAvatar?: boolean;
  lines?: number;
}

function ListSkeleton({ items = 5, hasAvatar = true, lines = 2 }: ListSkeletonProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex gap-3 items-start">
          {hasAvatar && <Skeleton variant="circular" width="40px" height="40px" className="shrink-0 mt-1" />}
          <div className="flex-1 min-w-0 space-y-1">
            <Skeleton variant="text" width="40%" height="1rem" />
            {Array.from({ length: lines - 1 }).map((_, j) => (
              <Skeleton key={j} variant="text" width="60%" height="0.75rem" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <Skeleton variant="text" width="30%" height="0.75rem" />
      <Skeleton variant="text" width="50%" height="1.5rem" className="text-2xl font-bold" />
      <Skeleton variant="text" width="40%" height="0.75rem" />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <CardSkeleton title description content className="lg:col-span-2" />
        <CardSkeleton title content />
      </div>

      {/* Tables */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton title description content />
        <CardSkeleton title description content />
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        <CardSkeleton title content />
        <CardSkeleton title content />
        <CardSkeleton title content />
      </div>
    </div>
  );
}

export { Skeleton, TableSkeleton, CardSkeleton, ListSkeleton, StatCardSkeleton, DashboardSkeleton };