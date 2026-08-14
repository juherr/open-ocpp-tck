/**
 * expected.ts -- the scenarios CitrineOS is known to fail, and where each
 * finding is written down.
 *
 * The counterpart of scope.ts, not a part of it. A row here is DRIVABLE, runs,
 * starts a container and prints FAIL; what it does not do is end the build.
 * tck/scope.ts forbids demoting such a row to NOT_APPLICABLE -- that would turn
 * a finding about CitrineOS into a silence about the harness -- and before this
 * file the only alternative was `continue-on-error` on the whole CI job, which
 * muted the other 46 scenarios along with the one finding.
 *
 * THE MECHANISM SENTENCE LIVES HERE and scope.ts imports it, the same way
 * variant.ts owns NO_RESERVATIONS for both scope.ts and requests.ts. The two
 * halves a reader compares -- "this row is drivable, and here is what the CSMS
 * does with it" and "this row is expected to fail, and here is why" -- must not
 * be free to disagree.
 */
import type { ExpectedFailureTable } from "../../tck/expected";
import type { CitrineVariant } from "./variant";
/**
 * Why a stored `Blocked` idTag comes back `Invalid`, worded once.
 *
 * Read in the sources and confirmed on the running image, 3 runs out of 3:
 * `AuthorizeRequestOcpp16Handler` reaches its status mapper only through the
 * `status === Accepted` branch, so a stored `Blocked` falls through to the
 * default `Invalid`. The only route to a real `Blocked` is an `IAuthorizer`,
 * and `container.ts` registers `authorizers: asValue([])` with no setting that
 * changes it.
 */
export declare const BLOCKED_UNREACHABLE: string;
/**
 * Why every FirmwareStatusNotification the charge point sends comes back as a
 * CALLERROR, worded once.
 *
 * Read in the sources and confirmed on the running image: CitrineOS registers
 * no 1.6 REQUEST handler for FirmwareStatusNotification --
 * `packages/core/src/handlers/requests/1.6/` has one for
 * DiagnosticsStatusNotification and none for this -- so the router answers
 * `[4,…,"NotSupported","No handler found for action: FirmwareStatusNotification
 * at module configuration"]`. Ten of them across the three TC_044 logs of a
 * sequential sweep, and the only CALLERROR the CSMS emits anywhere in the
 * suite.
 */
export declare const FIRMWARE_STATUS_NOT_HANDLED: string;
/** The expected-failure list for a declared variant. See variant.ts. */
export declare function citrineosExpectedFailures(variant: CitrineVariant): ExpectedFailureTable;
