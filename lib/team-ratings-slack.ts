import { format, parseISO } from "date-fns";

export function teamRatingsSlackMessage(periodStart: string): string {
  const month = format(parseISO(periodStart), "MMMM");
  return `Rating of the ${month} month of the team is updated on the portal please check.`;
}
