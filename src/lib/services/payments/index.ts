import "server-only";
import { getEnv } from "@/lib/env";
import { FakePaymentProvider } from "./fake";
import { StripePaymentProvider } from "./stripe";
import type { PaymentProvider } from "./types";

export * from "./types";

let provider: PaymentProvider | undefined;

// Chosen by PAYMENTS_PROVIDER: "fake" (local default) or "stripe" (test mode).
export function getPaymentProvider(): PaymentProvider {
  if (provider) return provider;
  const env = getEnv();
  switch (env.PAYMENTS_PROVIDER) {
    case "fake":
      provider = new FakePaymentProvider({
        stateFile: env.FAKE_PAYMENTS_STATE_FILE,
        webhookUrl: env.PAYMENTS_WEBHOOK_URL,
        webhookSecret: env.PAYMENTS_WEBHOOK_SECRET!,
        duplicateWebhooks: env.FAKE_PAYMENTS_DUPLICATE_WEBHOOKS,
      });
      return provider;
    case "stripe":
      provider = new StripePaymentProvider({ secretKey: env.STRIPE_SECRET_KEY!, webhookSecret: env.STRIPE_WEBHOOK_SECRET! });
      return provider;
  }
}

/** Tests: replace the provider (e.g. a FakePaymentProvider with a custom fetch). Pass undefined to reset. */
export function setPaymentProvider(p: PaymentProvider | undefined): void {
  provider = p;
}
