"use client";

import { useEffect, useState } from "react";

import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
import {
  PHYSICAL_INTERVIEW_CITY_OPTIONS,
  type PhysicalInterviewCity,
} from "@/lib/physical-interview-track";

type Props = {
  open: boolean;
  candidateLabel: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (city: PhysicalInterviewCity) => void;
};

export function PhysicalInterviewCityModal({
  open,
  candidateLabel,
  busy = false,
  onClose,
  onConfirm,
}: Props) {
  const [city, setCity] = useState<PhysicalInterviewCity | "">("");

  useEffect(() => {
    if (open) setCity("");
  }, [open, candidateLabel]);

  if (!open) return null;

  return (
    <div className={modalOverlayClass}>
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close"
        onClick={busy ? undefined : onClose}
      />
      <div
        className={`${modalPanelClass} p-6 shadow-card`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="physical-interview-city-title"
      >
        <h2
          id="physical-interview-city-title"
          className="text-lg font-semibold text-foreground"
        >
          Physical interview city
        </h2>
        <p className="mt-2 text-sm text-muted">
          Select the city for{" "}
          <span className="font-medium text-foreground">{candidateLabel}</span>
          . They will move to the physical interview track and be removed from
          Zoom scheduling.
        </p>

        <fieldset className="mt-5 space-y-2">
          <legend className="text-xs font-medium uppercase tracking-widest text-muted/80">
            City
          </legend>
          {PHYSICAL_INTERVIEW_CITY_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                city === opt.value
                  ? "border-[#7c3aed] bg-[#faf5ff]"
                  : "border-border bg-elevated hover:bg-background"
              } ${busy ? "pointer-events-none opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="physical-interview-city"
                value={opt.value}
                checked={city === opt.value}
                disabled={busy}
                className="text-[#7c3aed] focus:ring-[#7c3aed]"
                onChange={() => setCity(opt.value)}
              />
              <span className="text-sm font-medium text-foreground">
                {opt.label}
              </span>
            </label>
          ))}
        </fieldset>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded-xl border border-border bg-elevated px-4 py-2 text-sm font-medium text-foreground hover:bg-background disabled:opacity-50"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !city}
            className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              if (city) onConfirm(city);
            }}
          >
            {busy ? "Moving…" : "Move to physical interview"}
          </button>
        </div>
      </div>
    </div>
  );
}
