/**
 * Shared Tailwind fragments for dashboard modals: near–full width on small
 * screens with margin, capped width on lg+, scrollable body.
 */
export const modalOverlayClass =
  "fixed inset-0 z-[60] flex min-h-0 items-center justify-center bg-[#1d1d1f]/60 p-0 backdrop-blur-sm sm:p-4";

/** Same as {@link modalOverlayClass} with a higher z-index for stacked modals. */
export const modalOverlayZ75Class =
  "fixed inset-0 z-[75] flex min-h-0 items-center justify-center bg-[#1d1d1f]/60 p-0 backdrop-blur-sm sm:p-4";

export const modalOverlayZ80Class =
  "fixed inset-0 z-[80] flex min-h-0 items-center justify-center bg-[#1d1d1f]/60 p-0 backdrop-blur-sm sm:p-4";

export const modalOverlayZ70Class =
  "fixed inset-0 z-[70] flex min-h-0 items-center justify-center bg-[#1d1d1f]/60 p-0 backdrop-blur-sm sm:p-4";

export const modalPanelClass =
  "relative z-10 mx-4 max-h-[min(90vh,100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#f0f0f0] bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] sm:mx-auto";

export const modalPanelMdClass =
  "relative z-10 mx-4 max-h-[min(90vh,100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-[#f0f0f0] bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] sm:mx-auto";

export const modalPanelWideClass =
  "relative z-10 mx-4 max-h-[min(90vh,100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#f0f0f0] bg-white shadow-xl sm:mx-auto";

export const modalPanel3xlClass =
  "relative z-10 mx-4 max-h-[min(90vh,100dvh-2rem)] w-full max-w-3xl overflow-hidden rounded-2xl border border-[#f0f0f0] bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] sm:mx-auto";
