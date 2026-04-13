import { WebClient } from "@slack/web-api";

function slackClient(): WebClient | null {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token?.trim()) return null;
  return new WebClient(token);
}

export async function sendSlackDM(
  userEmail: string,
  message: string,
): Promise<{ success: boolean }> {
  const slack = slackClient();
  if (!slack) {
    console.error("Slack: SLACK_BOT_TOKEN not configured");
    return { success: false };
  }
  try {
    const userResult = await slack.users.lookupByEmail({
      email: userEmail.trim(),
    });
    if (!userResult.user?.id) {
      console.error("Slack user not found:", userEmail);
      return { success: false };
    }
    const dmResult = await slack.conversations.open({
      users: userResult.user.id,
    });
    if (!dmResult.channel?.id) return { success: false };
    await slack.chat.postMessage({
      channel: dmResult.channel.id,
      text: message,
    });
    console.log("Slack DM sent to:", userEmail);
    return { success: true };
  } catch (err) {
    console.error("Slack DM error:", err);
    return { success: false };
  }
}

export async function sendSlackChannel(
  channel: string,
  message: string,
): Promise<{ success: boolean }> {
  const slack = slackClient();
  if (!slack) {
    console.error("Slack: SLACK_BOT_TOKEN not configured");
    return { success: false };
  }
  try {
    await slack.chat.postMessage({ channel, text: message });
    return { success: true };
  } catch (err) {
    console.error("Slack channel error:", err);
    return { success: false };
  }
}
