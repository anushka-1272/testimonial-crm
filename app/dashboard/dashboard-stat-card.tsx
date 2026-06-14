"use client";

const cardChrome = "shadow-card border border-border-subtle";

type Props = {
  title: string;
  value: number | string;
  loading?: boolean;
  /** Single short line only */
  subtext?: string;
  /** Native tooltip for extra context */
  titleAttr?: string;
};

export function DashboardStatCard({
  title,
  value,
  loading = false,
  subtext,
  titleAttr,
}: Props) {
  return (
    <div
      title={titleAttr}
      className={`flex h-full min-h-[140px] flex-col rounded-2xl bg-elevated p-5 ${cardChrome}`}
    >
      <p className="text-xs font-medium text-muted">{title}</p>
      <p className="mt-3 text-3xl font-bold tracking-tight text-foreground tabular-nums sm:text-4xl">
        {loading ? "—" : value}
      </p>
      {subtext ? (
        <p className="mt-2 line-clamp-2 text-xs text-muted">{subtext}</p>
      ) : (
        <span className="mt-2 block min-h-[1.25rem]" aria-hidden />
      )}
      <div className="mt-auto pt-4">
        <div className="h-0.5 w-8 rounded-full bg-[#3b82f6]" />
      </div>
    </div>
  );
}
