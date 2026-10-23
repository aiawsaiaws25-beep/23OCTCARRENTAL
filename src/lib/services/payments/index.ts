import { getEnv } from "@/lib/env";
import { FakePaymentProvider } from "./fake";
import type { PaymentProvider } from "./types";

export * from "./types";

let provider: PaymentProvider | undefined;

// Chosen by PAYMENTS_PROVIDER. Add the real provider here when cloud keys arrive.
export function getPaymentProvider(): PaymentProvider {
  if (provider) return provider;
  const env = getEnv();
  switch (env.PAYMENTS_PROVIDER) {
    case "fake":
      provider = new FakePaymentProvider({
        stateFile: env.FAKE_PAYMENTS_STATE_FILE,
        webhookUrl: env.PAYMENTS_WEBHOOK_URL,
        webhookSecret: env.PAYMENTS_WEBHOOK_SECRET,
        duplicateWebhooks: env.FAKE_PAYMENTS_DUPLICATE_WEBHOOKS,
      });
      return provider;
    case "stripe":
      throw new Error("PAYMENTS_PROVIDER=stripe is not implemented yet");
  }
}
