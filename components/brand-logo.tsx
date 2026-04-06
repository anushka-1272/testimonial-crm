/** House of Ed-Tech mark — use on dark UI as-is, or wrapped on light backgrounds. */

export function LogoOnDark({
  className = "h-8 w-8 rounded-lg",
}: {
  className?: string;
}) {
  return (
    <img
      src="/logo.svg"
      alt="House of Ed-Tech"
      className={`object-contain ${className}`}
    />
  );
}

export function LogoOnLight({
  className = "h-9 w-9",
}: {
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center rounded-xl bg-[#0f1729] p-1.5 ${className}`}
    >
      <img
        src="/logo.svg"
        alt="House of Ed-Tech"
        className="h-full w-full object-contain"
      />
    </div>
  );
}
