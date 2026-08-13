/**
 * The SteVe driver.
 *
 * SteVe is the CSMS this harness was originally written against, which gives
 * this driver one job the other bundled one cannot do: if an operation cannot
 * be expressed here, the contract has drifted away from OCPP rather than
 * towards it. Its scope table claims every scenario, and a guard asserts that
 * -- the day it needs a NOT_APPLICABLE row, the generalization lost a
 * capability it used to have.
 *
 * That is a different question from the one drivers/citrineos/ answers, not a
 * lesser or greater one: this driver catches the harness losing something, the
 * other catches the core assuming something about SteVe. Neither is "the
 * reference".
 *
 * Why the manager UI and not the REST API
 * ---------------------------------------
 * Operations go through the manager UI on purpose, not for lack of a REST
 * client. SteVe's REST CancelReservation
 * (OcppOperationsService#cancelReservation -> #validateReservationId,
 * source-verified) checks the reservationId against
 * ReservationRepository#getActiveReservationIds(chargeBoxId) BEFORE dispatching
 * to the charge point, and returns 400 without putting anything on the wire for
 * an id the station does not have active. TC_052 exists precisely to check that
 * the CHARGE POINT answers Rejected to a made-up id, so the REST path cannot
 * drive it -- a permanent capability gap, not a flake. The manager-UI path
 * (Ocpp15Controller#postCancelReserv -> ChargePointServiceClient) has no such
 * pre-check and always reaches the charge point.
 *
 * That is a fact about SteVe, so it lives here. It used to live inside the
 * scenario, which constructed its own SteVe client mid-drive() and made one
 * vendored scenario unusable against any other CSMS.
 *
 * Where it has to run
 * -------------------
 * Transactions are observed over the WebAPI, which serves `stopReason`,
 * `stopTimestamp` and `ocppIdTag` and filters by charge point, idTag and
 * active-ness -- measured on the pinned image, and worth stating because an
 * earlier version of this file claimed the opposite and read all of it from
 * MariaDB. What REST genuinely cannot serve is reservation status and the
 * charging-profile registry: no such controller exists. Those two still come
 * from MariaDB through `docker exec` -- steve-community/steve#2074 and #2069
 * respectively, both under the #1000 "Meta - API Endpoint" umbrella.
 *
 * So this driver runs on the host that owns the SteVe containers, and reaches
 * the manager UI on the container network -- a deployment behind a
 * forward-auth proxy is unreachable from outside it, and its OCPP port may not
 * be published to the internet at all. The day those two tickets land, that
 * constraint goes with them.
 */
import { type CsmsDriverModule } from "../../tck/driver";
export declare const csmsDriver: CsmsDriverModule;
