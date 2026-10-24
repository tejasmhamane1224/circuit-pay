import type { BatchNotificationEvent, NotificationResult } from "./types";

export async function sendTelegramNotification(
  event: BatchNotificationEvent
): Promise<NotificationResult> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  let emoji = "ℹ️";
  let statusText = "Update";
  switch (event.event) {
    case "batch.completed":
      emoji = "✅";
      statusText = "Batch Completed & Settled";
      break;
    case "batch.failed":
      emoji = "🚨";
      statusText = "Batch Settlement Failed";
      break;
    case "batch.awaiting_approval":
      emoji = "⏳";
      statusText = "Multi-Approval Required";
      break;
  }

  const messageText = `
${emoji} *CircuitPay: ${statusText}*

• *Batch*: \`${event.title}\`
• *Amount*: \`${event.totalAmountFormatted} ${event.tokenSymbol}\`
• *Recipients*: \`${event.recipientCount}\`
• *Network*: \`${event.network}\`
• *ID*: \`${event.batchId}\`
${event.error ? `• *Error*: _${event.error}_\n` : ""}${
    event.approversNeeded
      ? `• *Approvals*: ${event.approversCount || 0}/${event.approversNeeded} collected\n`
      : ""
}• *Time*: \`${new Date(event.timestamp).toUTCString()}\`
`.trim();

  // If Telegram bot credentials are configured and not running in test mode, call Telegram API
  if (botToken && chatId && process.env.NODE_ENV !== "test") {
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: messageText,
          parse_mode: "Markdown",
        }),
      });

      const data = await response.json();
      return {
        channel: "telegram",
        success: response.ok,
        simulated: false,
        recipient: chatId,
        messageId: data?.result?.message_id?.toString(),
        error: response.ok ? undefined : JSON.stringify(data),
      };
    } catch (err: unknown) {
      return {
        channel: "telegram",
        success: false,
        simulated: false,
        recipient: chatId,
        error: err instanceof Error ? err.message : "Telegram delivery error",
      };
    }
  }

  // Simulated delivery for local dev and automated test suites
  return {
    channel: "telegram",
    success: true,
    simulated: true,
    recipient: chatId || "@circuitpay_alerts",
    messageId: `sim_tg_${Date.now()}`,
  };
}
