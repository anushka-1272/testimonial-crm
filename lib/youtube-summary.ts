import Anthropic from "@anthropic-ai/sdk";

import { CLAUDE_MODEL } from "@/lib/claude";

function extractAssistantText(
  content: Anthropic.Messages.ContentBlock[],
): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * Short YouTube interview summary for CX / publishing (under 150 words).
 */
export async function generateYoutubeInterviewSummary(params: {
  learnerName: string;
  youtubeLink: string;
}): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not configured" };
  }

  const client = new Anthropic({ apiKey });

  const user = `Generate a YouTube video summary for the following interview. Focus on: the specific result achieved by the learner, how Be10x AI Career Accelerator program helped them achieve it, and key takeaways. Keep it under 150 words. Learner name: ${params.learnerName}. YouTube link: ${params.youtubeLink}`;

  try {
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      messages: [{ role: "user", content: user }],
    });
    const text = extractAssistantText(message.content);
    if (!text) {
      return { ok: false, error: "Model returned an empty summary" };
    }
    return { ok: true, summary: text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Summary generation failed";
    return { ok: false, error: msg };
  }
}
