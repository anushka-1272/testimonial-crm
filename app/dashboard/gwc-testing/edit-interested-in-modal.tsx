"use client";

import { useEffect, useState } from "react";

import {
  GWC_INTERESTED_IN_OPTIONS,
  gwcEntryDisplayName,
  interestedInLabel,
  type GwcInterestedIn,
  type GwcInterestedInPointers,
  type GwcTestingRow,
} from "@/lib/gwc-testing";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";

const fieldLabelClass =
  "text-xs font-medium uppercase tracking-widest text-[#aeaeb2]";
const pointerInputClass =
  "mt-1.5 w-full resize-y rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#3b82f6] focus:outline-none disabled:opacity-50";

type Props = {
  open: boolean;
  row: GwcTestingRow | null;
  canEdit: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (
    interestedIn: GwcInterestedIn[],
    pointers: GwcInterestedInPointers,
  ) => void | Promise<void>;
};

export function EditInterestedInModal({
  open,
  row,
  canEdit,
  saving,
  onClose,
  onSave,
}: Props) {
  const [selected, setSelected] = useState<GwcInterestedIn[]>([]);
  const [pointers, setPointers] = useState<GwcInterestedInPointers>({});

  useEffect(() => {
    if (!open || !row) return;
    setSelected([...row.interested_in]);
    setPointers({ ...row.interested_in_pointers });
  }, [open, row]);

  if (!open || !row) return null;

  const display = gwcEntryDisplayName(row);

  function toggle(value: GwcInterestedIn) {
    if (!canEdit || saving) return;
    setSelected((prev) => {
      if (prev.includes(value)) {
        setPointers((p) => {
          const next = { ...p };
          delete next[value];
          return next;
        });
        return prev.filter((v) => v !== value);
      }
      return [...prev, value];
    });
  }

  function setPointer(value: GwcInterestedIn, text: string) {
    setPointers((prev) => {
      const next = { ...prev };
      const trimmed = text.trim();
      if (trimmed) next[value] = text;
      else delete next[value];
      return next;
    });
  }

  return (
    <div className={modalOverlayClass}>
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`${modalPanelClass} !max-w-lg p-0`}
        role="dialog"
        aria-labelledby="gwc-interested-in-title"
      >
        <div className="border-b border-[#f0f0f0] px-6 py-4">
          <h2
            id="gwc-interested-in-title"
            className="text-lg font-semibold text-[#1d1d1f]"
          >
            Interested in
          </h2>
          <p className="mt-1 text-sm text-[#6e6e73]">{display}</p>
          <p className="mt-2 text-xs text-[#aeaeb2]">
            Select all channels that apply. Add POC pointers for each selected
            option.
          </p>
        </div>

        <div className="max-h-[min(60vh,480px)] space-y-4 overflow-y-auto px-6 py-4">
          <div>
            <p className={fieldLabelClass}>Channels</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {GWC_INTERESTED_IN_OPTIONS.map((opt) => {
                const isOn = selected.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
                      isOn
                        ? "border-[#1d1d1f] bg-[#fafafa]"
                        : "border-[#e5e5e5] bg-white hover:border-[#d1d5db]"
                    } ${!canEdit || saving ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-[#d1d5db] text-[#1d1d1f] focus:ring-[#3b82f6]"
                      checked={isOn}
                      disabled={!canEdit || saving}
                      onChange={() => toggle(opt.value)}
                    />
                    <span className="text-sm font-medium text-[#1d1d1f]">
                      {opt.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {selected.length > 0 ? (
            <div className="space-y-3 border-t border-[#f0f0f0] pt-4">
              <p className={fieldLabelClass}>POC pointers</p>
              {selected.map((value) => (
                <div key={value}>
                  <label
                    htmlFor={`pointer-${row.id}-${value}`}
                    className="text-sm font-medium text-[#1d1d1f]"
                  >
                    {interestedInLabel(value)}
                  </label>
                  <textarea
                    id={`pointer-${row.id}-${value}`}
                    rows={2}
                    disabled={!canEdit || saving}
                    className={pointerInputClass}
                    placeholder={`Notes / pointers for ${interestedInLabel(value)}…`}
                    value={pointers[value] ?? ""}
                    onChange={(e) => setPointer(value, e.target.value)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-[#f5f5f7] px-3 py-2 text-sm text-[#6e6e73]">
              Select at least one channel to add pointers.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#f0f0f0] px-6 py-4">
          <button
            type="button"
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-[#6e6e73] hover:bg-[#f5f5f5]"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canEdit || saving}
            className="rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2d2d2f] disabled:opacity-50"
            onClick={() => void onSave(selected, pointers)}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
