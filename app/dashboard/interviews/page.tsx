import type { Metadata } from "next";

import { InterviewsBoard } from "./interviews-board";

export const metadata: Metadata = {
  title: "Testimonial Interviews | Testimonial CRM",
  description: "Schedule and track testimonial interviews.",
};

export default function InterviewsPage() {
  return <InterviewsBoard />;
}
