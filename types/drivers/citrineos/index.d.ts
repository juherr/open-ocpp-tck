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
 * `POST /ocpp/1.6/<module>/<action>` IS the way to put a Call on the wire, and
 * the request body IS the OCPP payload. The interesting part is what the
 * surface omits -- see requests.ts.
 *
 * Where the observations come from, and where this has to run
 * -----------------------------------------------------------
 * Postgres, through `docker exec`, because CitrineOS's REST data endpoints
 * expose none of what the scenarios assert on: no latest transaction, no idTag
 * on a transaction, no stop reason, no count. records.ts documents the full
 * search and why the bundled Hasura sidecar was not used instead. The
 * consequence is the same as SteVe's: this driver runs on the host that owns
 * the containers, so a remote CitrineOS is out of reach for the record half
 * even though the operation half would work over HTTP.
 *
 * Versions
 * --------
 * Both CitrineOS lines are supported, selected by CITRINE_VARIANT and
 * defaulting to v2 -- drivers/citrineos/compose.yaml pins v2.0.0-beta1 by
 * digest, and compose.v1.yaml overrides it with v1.9.1. v1 costs the six
 * local-auth-list scenarios, whose 1.6 endpoints exist only from the v2 line,
 * and renames the OCPP connection column. See variant.ts.
 */
import { type CsmsDriverModule } from "../../tck/driver";
export declare const csmsDriver: CsmsDriverModule;
