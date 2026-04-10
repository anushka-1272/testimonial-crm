import type { Metadata } from "next";

import { ProjectInterviewsPage } from "./project-interviews-page";

export const metadata: Metadata = {
  title: "Project Interviews | Testimonial CRM",
  description: "Manage project interview pipeline.",
};

export default function Page() {
  return <ProjectInterviewsPage />;
}
