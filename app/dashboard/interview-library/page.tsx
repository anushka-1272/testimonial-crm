import type { Metadata } from "next";

import { InterviewLibraryDashboard } from "./interview-library-dashboard";

export const metadata: Metadata = {
  title: "Interview Library | Testimonial CRM",
  description:
    "Eligible completed interviews with a YouTube link (testimonial and project).",
};

export default function InterviewLibraryPage() {
  return (
    <div className="min-h-0 flex-1">
      <InterviewLibraryDashboard />
    </div>
  );
}
