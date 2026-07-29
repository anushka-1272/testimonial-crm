import {
  physicalInterviewStatusLabel,
  type PhysicalInterviewStatus,
} from "@/lib/physical-interview-track";

export function PhysicalInterviewPipelineBadge({
  status,
}: {
  status: PhysicalInterviewStatus | null | undefined;
}) {
  if (!status) return <span className="text-muted">—</span>;
  switch (status) {
    case "pending":
      return (
        <span className="inline-flex rounded-full bg-[#f3e8ff] px-2.5 py-1 text-xs font-medium text-[#7c3aed]">
          {physicalInterviewStatusLabel(status)}
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex rounded-full bg-[#dbeafe] px-2.5 py-1 text-xs font-medium text-[#1d4ed8]">
          {physicalInterviewStatusLabel(status)}
        </span>
      );
    case "eligible":
      return (
        <span className="inline-flex rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#16a34a]">
          {physicalInterviewStatusLabel(status)}
        </span>
      );
    case "not_eligible":
      return (
        <span className="inline-flex rounded-full bg-[#fef2f2] px-2.5 py-1 text-xs font-medium text-[#dc2626]">
          {physicalInterviewStatusLabel(status)}
        </span>
      );
    default:
      return <span className="text-muted">—</span>;
  }
}

export function PhysicalInterviewSourceBadge({
  source,
}: {
  source: "testimonial" | "project";
}) {
  if (source === "project") {
    return (
      <span className="inline-flex rounded-full bg-[#eff6ff] px-2.5 py-1 text-xs font-medium text-[#2563eb]">
        Project
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#16a34a]">
      Testimonial
    </span>
  );
}
