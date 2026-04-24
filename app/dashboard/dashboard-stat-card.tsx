"use client";

const cardChrome =
  "shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-[#f0f0f0]";

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
      className={`flex h-full min-h-[140px] flex-col rounded-2xl bg-white p-5 ${cardChrome}`}
    >
      <p className="text-xs font-medium text-[#6e6e73]">{title}</p>
      <p className="mt-3 text-3xl font-bold tracking-tight text-[#1d1d1f] tabular-nums sm:text-4xl">
        {loading ? "—" : value}
      </p>
      {subtext ? (
        <p className="mt-2 line-clamp-2 text-xs text-[#6e6e73]">{subtext}</p>
      ) : (
        <span className="mt-2 block min-h-[1.25rem]" aria-hidden />
      )}
      <div className="mt-auto pt-4">
        <div className="h-0.5 w-8 rounded-full bg-[#3b82f6]" />
      </div>
    </div>
  );
}
