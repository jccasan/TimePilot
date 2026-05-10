export async function sendAlert(message: string, context?: Record<string, unknown>): Promise<void> {
  try {
    if (process.env.ALERT_ENV !== "production") return;
    const webhookUrl = process.env.SLACK_ALERT_WEBHOOK;
    if (!webhookUrl) return;

    const text = context ? `${message}\n\`\`\`${JSON.stringify(context, null, 2)}\`\`\`` : message;

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {}
}
