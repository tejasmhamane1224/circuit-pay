import type { BatchNotificationEvent, NotificationResult } from "./types";

export async function sendEmailNotification(
  event: BatchNotificationEvent
): Promise<NotificationResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.NOTIFICATION_EMAIL || "treasury-alerts@circuitpay.io";

  let subject = "";
  switch (event.event) {
    case "batch.completed":
      subject = `✅ [CircuitPay] Batch Settled: ${event.title} (${event.totalAmountFormatted} ${event.tokenSymbol})`;
      break;
    case "batch.failed":
      subject = `❌ [CircuitPay Alert] Batch Execution Failed: ${event.title}`;
      break;
    case "batch.awaiting_approval":
      subject = `⏳ [CircuitPay Action Required] Multi-Approval Needed: ${event.title}`;
      break;
  }

  // If Resend API key is present and not running in unit test mode, invoke the API
  if (apiKey && process.env.NODE_ENV !== "test") {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "CircuitPay Treasury <alerts@circuitpay.io>",
          to: [toEmail],
          subject,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #09090b; color: #f4f4f5; padding: 24px; border-radius: 8px;">
              <h2 style="color: #6366f1; margin-top: 0;">CircuitPay Notification</h2>
              <p><strong>Event:</strong> <code>${event.event}</code></p>
              <p><strong>Batch:</strong> ${event.title} (<code>${event.batchId}</code>)</p>
              <p><strong>Total Value:</strong> ${event.totalAmountFormatted} ${event.tokenSymbol}</p>
              <p><strong>Recipients:</strong> ${event.recipientCount}</p>
              <p><strong>Network:</strong> ${event.network}</p>
              ${event.error ? `<p style="color: #ef4444;"><strong>Error:</strong> ${event.error}</p>` : ""}
              ${
                event.approversNeeded
                  ? `<p style="color: #eab308;"><strong>Approval Status:</strong> ${event.approversCount || 0} of ${event.approversNeeded} approvals recorded.</p>`
                  : ""
              }
              <hr style="border: 1px solid #27272a; margin: 20px 0;" />
              <p style="font-size: 12px; color: #a1a1aa;">Sent automatically by CircuitPay Non-Custodial Multi-Hop Engine.</p>
            </div>
          `,
        }),
      });

      const data = await response.json();
      return {
        channel: "email",
        success: response.ok,
        simulated: false,
        recipient: toEmail,
        messageId: data.id,
        error: response.ok ? undefined : JSON.stringify(data),
      };
    } catch (err: unknown) {
      return {
        channel: "email",
        success: false,
        simulated: false,
        recipient: toEmail,
        error: err instanceof Error ? err.message : "Email delivery network error",
      };
    }
  }

  // Simulated delivery for development and automated test suites
  return {
    channel: "email",
    success: true,
    simulated: true,
    recipient: toEmail,
    messageId: `sim_email_${Date.now()}`,
  };
}
