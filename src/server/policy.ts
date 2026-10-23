// Business rules in one place. All money in fils (1 AED = 100 fils), rates in basis points.

export const CURRENCY = "AED";
/** UAE VAT 5 %. Applied to rental, extras, one-way fee and post-rental charges; not to the deposit. */
export const VAT_RATE_BPS = 500;

/** A PENDING reservation holds the vehicle for this long while the customer pays. */
export const HOLD_MINUTES = 15;
/** Earliest pick-up: this many minutes from now. */
export const MIN_LEAD_MINUTES = 60;
export const MAX_RENTAL_DAYS = 90;
export const MIN_DRIVER_AGE = 21;
/** Licence and voucher uploads. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_LICENCE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const ALLOWED_DAMAGE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** A day is any started 24 h block after pick-up (minimum 1). */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Deposit authorisations are kept until this long after the planned return (provider expiry). */
export const DEPOSIT_HOLD_DAYS_AFTER_RETURN = 7;

/**
 * Late return: up to 59 minutes after the planned return is free. After that each
 * started hour costs 25 % of the daily rate, capped at one daily rate per 24 h late.
 * Late charges are subject to VAT.
 */
export const LATE_GRACE_MINUTES = 59;
export const LATE_HOURLY_BP = 2500;

/** Refuelling charge per missing eighth of a tank compared with pick-up (AED 60). */
export const FUEL_FILS_PER_EIGHTH = 6000;

/**
 * Cancellation policy (customer-initiated):
 *  - PENDING (not paid yet): free; the hold is released.
 *  - CONFIRMED, 48 h or more before pick-up: full refund.
 *  - CONFIRMED, 24-48 h before pick-up: refund minus one day's rental (incl. VAT).
 *  - CONFIRMED, less than 24 h before pick-up: 50 % refund.
 *  - After the pick-up time, PICKED_UP or finished reservations: cannot be cancelled online.
 * The deposit authorisation is always released in full on cancellation.
 * The same windows apply to date changes: changes are allowed until the pick-up time;
 * a price increase is charged, a decrease is refunded only when the change is made
 * 48 h or more before the original pick-up.
 */
export const CANCELLATION_POLICY = {
  freeHours: 48,
  oneDayFeeHours: 24,
  lateCancelRefundBp: 5000,
  summary:
    "Free cancellation up to 48 hours before pick-up. Between 48 and 24 hours before pick-up, one day's rental (incl. VAT) is charged. Less than 24 hours before pick-up, 50% of the total is refunded. No online cancellation after the pick-up time. Your deposit hold is always released.",
} as const;
