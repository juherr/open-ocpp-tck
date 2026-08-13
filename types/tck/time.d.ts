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
 *
 * WHICH CLOCK RESOLVES AN INSTANT IS A DRIVER CONCERN TOO, which is why the
 * provisioning policy below is an OFFSET IN MINUTES rather than a `Date`: an
 * instant computed here would carry this process's clock into a system that
 * has its own. Handed the offset, a driver applies it however its CSMS is
 * addressed.
 */
export declare function inMinutes(minutes: number, now?: Date): Date;
export declare function inSeconds(seconds: number, now?: Date): Date;
/**
 * How far before the provisioning instant a fixture that must ALREADY BE
 * EXPIRED is dated -- CERT023-EXP, the tag TC_023.2 needs the CSMS to answer
 * `Expired` for.
 *
 * The policy, which is the part worth sharing: such a fixture is dated from the
 * run itself, never from a fabricated historical date. A row that claims to
 * have expired years before the activity recorded against it is a lie the
 * scenarios do not need, and one that no CSMS should have to accept in order to
 * be measured.
 *
 * Why an offset rather than the instant itself: "expired" is read back through
 * a strictly-ordered comparison, and the clock that answers it may be coarser
 * than whatever stores it -- so a fixture stamped at exactly "now" can read as
 * not-yet-expired for the rest of that second, which a provisioner that
 * verifies itself hits immediately. A minute clears that, along with any skew
 * between the clocks involved.
 *
 * It costs nothing: this is a BACKDATE, not a wait. Nothing sleeps. How a given
 * CSMS is told about it, and which of its clocks decides, each driver's
 * provisioner says for itself.
 */
export declare const EXPIRED_FIXTURE_BACKDATE_MINUTES = 1;
