/**
 * The CitrineOS driver.
 *
 * CitrineOS (LF Energy / S44) is the second CSMS this harness drives, and the
 * first one the scenarios were not written against. That is its job here: an
 * abstraction with one implementation is neutral by assertion, and this driver
 * is how the assertion gets tested. It reports the answer honestly -- seven
 * scenarios are NOT_APPLICABLE because CitrineOS's OCPP 1.6 surface is smaller
 * than SteVe's, and scope.ts names the missing endpoint for each.
 *
 * Why the JSON message API
 * ------------------------
 * Unlike SteVe, there is no choice to justify: CitrineOS generates its
 * outbound surface from the OCPP schemas themselves, so
 * `POST /ocpp/<version>/<module>/<action>` IS the way to put a Call on the
 * wire, and the request body IS the OCPP payload. That holds for both
 * protocols -- the version is a path segment, not a second API. The
 * interesting part is what the surface omits -- see requests.ts.
 *
 * Where the observations come from
 * ---------------------------------
 * The GraphQL data API, because CitrineOS's REST data endpoints expose none of
 * what the scenarios assert on: no latest transaction, no idTag on a
 * transaction, no stop reason, no count. records.ts documents the full search,
 * and why GraphQL is the vendor's own answer rather than a workaround -- their
 * shipped OCPI package, their operator UI and their e2e fixtures all write
 * Authorizations through it.
 *
 * The consequence is worth stating because it is the opposite of SteVe's: both
 * halves of this driver are HTTP, so it can be pointed at a CitrineOS nobody
 * on this host owns. Nothing here shells into a container.
 *
 * Versions
 * --------
 * Both CitrineOS lines are supported, selected by CITRINE_VARIANT and
 * defaulting to v2 -- drivers/citrineos/compose.yaml pins the v2 prerelease by
 * digest and is the one place naming which, and compose.v1.yaml overrides it
 * with v1.9.1. v1 costs the six
 * local-auth-list scenarios, whose 1.6 endpoints exist only from the v2 line,
 * and renames the OCPP connection column. See variant.ts.
 *
 * Protocols
 * ---------
 * This is the first driver to declare an OCPP 2.0.1 surface, and it declares
 * it for the v2 line only -- four operations, which is the whole vocabulary
 * the first `cert201-` slice needs. The 1.6 half is untouched by it: one
 * CitrineOS serves both protocols on one websocket endpoint, dispatching on
 * the negotiated subprotocol, so there is no second deployment, no second
 * client and nothing conditional in the transport.
 */
import { type CsmsDriverModule } from "../../tck/driver";
/**
 * What the 1.6 message API does not route, for the declared variant --
 * confirmed against both running images: the v2 line's /docs/json advertises
 * 18 `/ocpp/1.6/` paths and v1.9.1's advertises 16, with `reserveNow` and
 * `cancelReservation` absent from both. Measured on v2.0.0-beta1, carried to
 * beta3 on a file identity, and re-counted on the running v2.0.0-beta4
 * container rather than carried again: the route tables moved to
 * `packages/ocpp/src/apis/ocpp/1.6/*.ts` under that pin, and the same 18
 * actions are what they register. At v2.0.0 the route tables register the
 * same 18 again, and the running container's /docs/json advertises them
 * (2026-09-30).
 *
 * Declared by subtraction from the contract's own list rather than by
 * enumerating the supported ones, so that an operation added to the contract
 * lands here as supported-and-unimplemented -- which `requests.ts`'s
 * `assertNever` turns into a compile error -- instead of being silently
 * dropped from the declaration and never noticed.
 *
 * A function of the environment, not a module-scope constant: which line this
 * driver is pointed at decides the answer, and `scope` and `capabilities` are
 * read by check-driver and by the pre-flight without ever calling create() --
 * which is what lets both run with no credentials and no server.
 * CITRINE_VARIANT is a declaration, not a credential, so reading it here keeps
 * that promise. The runner hands the same env to create(), so the table and
 * the requests cannot describe different servers.
 */
/**
 * The 2.0.1 half, and it shares the api client rather than getting one of its
 * own: the message API is one HTTP surface with a version segment in the path,
 * so a second client would be a second copy of the timeout, the confirmation
 * parsing and the `success: false` rule for no gain.
 *
 * No `records`, which is the difference from the function above: nothing in
 * the 2.0.1 vocabulary carries an opaque ref to resolve, so there is no
 * database round-trip to hand it.
 *
 * It does take the `variant`, which the 1.6 half also takes and this half once
 * did not -- requests.ts's header says why that reversed. The short version:
 * the declaration is now built by subtracting an unrouted table, and the
 * refusal has to come from the same table or the two are free to disagree.
 * On the v1 line this is reached through nothing at all -- `create` omits the
 * part, so the runner substitutes its throwing stub and the scenario lands NOT
 * APPLICABLE.
 */
export declare const csmsDriver: CsmsDriverModule;
