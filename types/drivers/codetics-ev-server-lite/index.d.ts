/**
 * The Codetics ev-server-lite driver: an OCPP 1.6J-only CSMS with a REST admin
 * API, built from source by compose.yaml at a pinned upstream commit.
 *
 * Everything goes over that API -- operations through one generic command
 * endpoint, records through the transaction list -- so the driver needs no
 * container to exec into and can be pointed at a server nobody on this host
 * owns. README.md has the run recipe and the gap table; requests.ts says what
 * "dispatched" means here, records.ts what the server cannot be asked.
 *
 * `create()` builds a client and does no I/O. The first call that needs the
 * server logs in, once per process -- see api-client.ts for why that is a
 * limit rather than a nicety.
 */
import { type CsmsDriverModule } from "../../tck/driver";
export declare const csmsDriver: CsmsDriverModule;
