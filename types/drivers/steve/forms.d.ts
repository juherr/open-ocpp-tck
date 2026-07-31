/**
 * forms.ts -- renders a neutral CsmsOperation into the fields SteVe's manager
 * UI forms expect.
 *
 * This mapping used to BE the contract: every scenario was written in these
 * field names, and every other CSMS driver had to parse its way back out of
 * them. Now it is what it always was -- one CSMS's serialisation, owned by the
 * driver for that CSMS.
 */
import { type CsmsOperation } from "../../tck/driver";
/**
 * SteVe's ReserveNow `expiry` and UpdateFirmware `retrieveDateTime` inputs
 * have no seconds field. Round UP, so any strictly-future instant formats to a
 * strictly-future minute: truncating can land in the already-past current
 * minute, which is why the old spec helper had to default to +90 seconds and
 * explain itself. The rounding lives here now, where the resolution limit is.
 */
export declare function steveLocalDateTime(d: Date): string;
/** The manager-UI select-list token for an OCPP 1.6J charge point. */
export declare function cpSelect(cpId: string): string;
export declare function toSteveForm(op: CsmsOperation): {
    opPath: string;
    fields: Record<string, string>;
};
