/**
 * time.ts -- runtime-relative instants for scenarios that need a value in the
 * near future: a ReserveNow expiry, an UpdateFirmware retrieveDate. Relative
 * so specs never go stale the way a hardcoded absolute date would.
 *
 * These return `Date`. FORMATTING IS A DRIVER CONCERN. A CSMS whose API takes
 * a minute-resolution local string formats it itself, and must round UP to the
 * next whole minute so that any positive offset -- however small -- lands
 * strictly in the future.
 *
 * The previous design pushed that concern into the specs: the retrieveDate
 * helper defaulted to +90 seconds specifically because truncating to the
 * minute could land in the already-past current minute. That made one CSMS's
 * form resolution a property of the OCPP scenario, which is exactly the kind
 * of leak this file exists to remove.
 */
export declare function inMinutes(minutes: number, now?: Date): Date;
export declare function inSeconds(seconds: number, now?: Date): Date;
