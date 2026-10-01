import { type CsmsEnv } from "./driver";
export interface CsmsServerOptions {
    readonly env: CsmsEnv;
    /** Default 127.0.0.1: the daemon drives a CSMS and has no authentication
     *  of its own, so reaching it from elsewhere is a choice made explicitly. */
    readonly host?: string;
    /** Default 8787; 0 picks a free port. */
    readonly port?: number;
    readonly timeoutMs?: number;
    readonly log?: (line: string) => void;
}
export interface CsmsServer {
    readonly url: string;
    stop(): Promise<void>;
}
export declare const DEFAULT_HOST = "127.0.0.1";
export declare const DEFAULT_PORT = 8787;
export declare function secretsOf(env: CsmsEnv): string[];
export declare function startCsmsServer(options: CsmsServerOptions): Promise<CsmsServer>;
/** `ocpp-tck csms-server [--host H] [--port N] [--timeout-ms N]`. Serves until SIGINT or SIGTERM. */
export declare function csmsServerCommand(argv: string[], env: CsmsEnv): Promise<number>;
