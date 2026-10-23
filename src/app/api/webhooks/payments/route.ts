import { getPaymentProvider, PaymentError } from "@/lib/services/payments";
import { logger } from "@/server/logger";
import { handlePaymentWebhook } from "@/server/payments";

const log = logger.child({ route: "webhooks/payments" });

/**
 * Payment provider webhooks (fake provider locally, Stripe when PAYMENTS_PROVIDER=stripe).
 * 1. Verify the signature over the raw body (400 if invalid).
 * 2. De-duplicate by provider event id (payment_webhook_events): duplicates get 200.
 * 3. Apply idempotently. Unexpected errors return 500 so the provider retries.
 */
export async function POST(request: Request) {
  const provider = getPaymentProvider();
  const rawBody = await request.text();
  const signature = request.headers.get(provider.signatureHeader);
  try {
    const outcome = await handlePaymentWebhook(rawBody, signature, provider);
    return Response.json({ received: true, ...outcome });
  } catch (err) {
    if (err instanceof PaymentError && err.code === "bad_signature") {
      log.warn("rejected webhook with invalid signature");
      return Response.json({ error: "invalid signature" }, { status: 400 });
    }
    if (err instanceof SyntaxError) return Response.json({ error: "invalid payload" }, { status: 400 });
    log.error("webhook processing failed", { err });
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
