"use client";

import { useEffect, useMemo, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";

type Props = {
  open: boolean;
  onClose: () => void;
  interviewId: string;
  table: "interviews" | "project_interviews";
  existingZoomLink?: string | null;
  existingZoomAccount?: string | null;
  onSuccess: (saved: { zoomLink: string; zoomAccount: string }) => void;
};

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function ZoomDetailsModal({
  open,
  onClose,
  interviewId,
  table,
  existingZoomLink,
  existingZoomAccount,
  onSuccess,
}: Props) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [zoomLink, setZoomLink] = useState("");
  const [zoomAccount, setZoomAccount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setZoomLink(existingZoomLink?.trim() ?? "");
    setZoomAccount(existingZoomAccount?.trim() ?? "");
    setError(null);
  }, [open, existingZoomLink, existingZoomAccount, interviewId]);

  if (!open) return null;

  const hasExistingZoom =
    Boolean(existingZoomLink?.trim()) || Boolean(existingZoomAccount?.trim());
  const title = hasExistingZoom ? "Edit Zoom Details" : "Add Zoom Details";

  const handleSave = async () => {
    const link = zoomLink.trim();
    const account = zoomAccount.trim();

    if (!link) {
      setError("Zoom link is required.");
      return;
    }
    if (!isValidHttpUrl(link)) {
      setError("Zoom link must be a valid URL.");
      return;
    }
    if (!account) {
      setError("Zoom account email is required.");
      return;
    }
    if (!isValidEmail(account)) {
      setError("Zoom account must be a valid email.");
      return;
    }

    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase
      .from(table)
      .update({
        zoom_link: link,
        zoom_account: account,
      })
      .eq("id", interviewId);
    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    onSuccess({ zoomLink: link, zoomAccount: account });
    onClose();
  };

  return (
    <div className={modalOverlayClass}>
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`${modalPanelClass} p-6 shadow-[0_4px_16px_rgba(0,0,0,0.08)]`}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-[#1d1d1f]">{title}</h2>
          <button
            type="button"
            className="rounded-xl p-2 text-[#aeaeb2] transition-all hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 text-sm">
          {error ? (
            <p className="rounded-xl border border-[#f0f0f0] bg-[#f5f5f7] px-3 py-2 text-sm text-[#1d1d1f]">
              {error}
            </p>
          ) : null}

          <label className="block text-sm">
            <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
              Zoom Link
            </span>
            <input
              type="url"
              required
              className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0"
              placeholder="https://zoom.us/j/..."
              value={zoomLink}
              onChange={(e) => setZoomLink(e.target.value)}
              autoComplete="off"
            />
          </label>

          <label className="block text-sm">
            <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
              Zoom Account Email
            </span>
            <input
              type="email"
              required
              className="mt-1 w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0"
              placeholder="host@example.com"
              value={zoomAccount}
              onChange={(e) => setZoomAccount(e.target.value)}
              autoComplete="off"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-xl border border-[#f0f0f0] bg-white px-4 py-2 text-sm font-medium text-[#1d1d1f] transition-all hover:bg-[#fafafa]"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              className="rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#2d2d2f] disabled:opacity-50"
              onClick={() => void handleSave()}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
