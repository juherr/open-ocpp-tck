/**
 * The EVtivity driver: an independent TypeScript CSMS (Fastify, Postgres,
 * Redis), driven here over OCPP 1.6J, from its published images pinned by
 * compose.yaml.
 *
 * Everything goes over its REST API -- operations through one synchronous
 * route per 1.6 action, records through the session routes -- so the driver
 * needs no container to exec into and can be pointed at a server nobody on
 * this host owns. README.md has the run recipe and the deviations.
 *
 * An ADAPTER over `createEvtivityCsmsDriver` from `@ovarilo/csms-drivers`,
 * as the SteVe and CitrineOS drivers are over theirs. The library owns the
 * operations and the command surface: the payloads, and what each command
 * answer means for the wire -- its own tests hold that. This driver owns what
 * a TCK run adds on top: records.ts (what the API cannot be asked), the
 * prepare hook, the simulator transport, provisioning, scope and expected
 * failures, and the charging-profile catalogue the library reads refs from.
 *
 * `create()` builds both clients and does no I/O. The first call that needs
 * the server logs in, once per process and per client -- api-client.ts says
 * why there are two.
 */
import { type CsmsDriverModule } from "../../tck/driver";
export declare const csmsDriver: CsmsDriverModule;
