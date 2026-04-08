import type { Metadata } from "next";

import { PostProductionDashboard } from "./post-production-dashboard";

export const metadata: Metadata = {
  title: "Post Production | Testimonial CRM",
  description: "Video editing and YouTube publishing pipeline.",
};

export default function PostProductionPage() {
  return <PostProductionDashboard />;
}
