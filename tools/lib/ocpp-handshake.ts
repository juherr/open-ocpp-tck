// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * The status line a CSMS answers an OCPP 1.6 WebSocket upgrade with: 101, or
 * why not. Written over a raw socket rather than through `WebSocket`, because
 * a refused upgrade is the answer the live tools want to read, and `WebSocket`
 * reports every refusal as the same opaque error event.
 *
 * `wsBaseUrl` is the OCPP endpoint as reachable from THIS host; the charge
 * point id is appended as the last path segment. Plain `ws:` only: the probe
 * speaks TCP, not TLS, and every CSMS these tools are run against is served
 * in clear, so a `wss:` endpoint is refused rather than dialled in clear.
 *
 * The status line is read whole however TCP segments it, and a peer that
 * closes before sending one rejects -- a split `101` once read as status 0,
 * which every caller takes for a refusal. tests/ocpp-handshake.ts holds both.
 */
import { connect } from "node:net";

/** The longest first line, CRLF excluded, read as a status line; a longer
 *  one is refused whether or not it is terminated. */
const STATUS_LINE_LIMIT = 1024;

export function handshakeStatus(
  wsBaseUrl: string,
  cpId: string,
  basicAuthPassword?: string,
): Promise<number> {
  const url = new URL(`${wsBaseUrl}/${cpId}`);
  if (url.protocol !== "ws:") {
    return Promise.reject(new Error(`${url.protocol} is not supported: this probe speaks plain WebSocket, not TLS`));
  }
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const auth = basicAuthPassword === undefined ? "" : `Authorization: Basic ${btoa(`${cpId}:${basicAuthPassword}`)}\r\n`;
  return new Promise((resolve, reject) => {
    let received = "";
    const socket = connect(Number(url.port || 80), url.hostname, () => {
      socket.write(
        `GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
          `Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Protocol: ocpp1.6\r\n${auth}\r\n`,
      );
    });
    socket.setTimeout(10_000, () => socket.destroy(new Error("handshake timed out")));
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString("latin1");
      const end = received.indexOf("\r\n");
      // + 1: a line of exactly the limit may still be waiting for its LF.
      if (end === -1 && received.length <= STATUS_LINE_LIMIT + 1) return;
      socket.destroy();
      if (end === -1 || end > STATUS_LINE_LIMIT) {
        reject(new Error(`no status line within ${STATUS_LINE_LIMIT} bytes: ${JSON.stringify(received.slice(0, 80))}...`));
        return;
      }
      const line = received.slice(0, end);
      const status = /^HTTP\/\d\.\d (\d{3})(?: |$)/.exec(line);
      if (status) resolve(Number(status[1]));
      else reject(new Error(`not an HTTP status line: ${JSON.stringify(line.slice(0, 80))}`));
    });
    socket.once("error", reject);
    // Settled already on every path but one: the peer closed before a whole
    // status line arrived, which would otherwise leave this pending for good.
    socket.once("close", () =>
      reject(new Error(`connection closed before a status line${received ? `, after ${JSON.stringify(received)}` : ""}`)),
    );
  });
}

/**
 * The OCPP endpoint `wsBaseUrl` names, at the host and port of `managerUrl`.
 * For a CSMS that publishes its UI and its OCPP endpoint on one port, that is
 * the endpoint as reachable from wherever `managerUrl` is -- so a tool on the
 * host derives it from the URL it already reaches the UI by, and `wsBaseUrl`
 * keeps meaning what the simulator container dials. An https manager URL is
 * refused, since {@link handshakeStatus} cannot dial the `wss:` it implies.
 */
export function onManagerHost(wsBaseUrl: string, managerUrl: string): string {
  const ws = new URL(wsBaseUrl);
  const manager = new URL(managerUrl);
  if (manager.protocol !== "http:") {
    throw new Error(`${managerUrl}: these live tools reach the CSMS over plain HTTP and WebSocket only`);
  }
  ws.protocol = "ws:";
  // hostname and port apart: assigning `host` from a URL without a port
  // keeps this one's.
  ws.hostname = manager.hostname;
  ws.port = manager.port;
  return ws.toString();
}
