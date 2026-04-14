import type { Metadata } from "next";

import { AnalyticsDashboard } from "./analytics-dashboard";

export const metadata: Metadata = {
  title: "Analytics | Testimonial CRM",
  description: "Testimonial CRM performance overview.",
};

export default function AnalyticsPage() {
  return (
    <div className="px-4 pb-10 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
      <div className="mx-auto max-w-[1400px]">
        <AnalyticsDashboard />
      </div>
    </div>
  );
}
