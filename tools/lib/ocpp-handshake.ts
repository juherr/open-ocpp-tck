// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * The status line a CSMS answers an OCPP 1.6 WebSocket upgrade with: 101, or
 * why not. Written over a raw socket rather than through `WebSocket`, because
 * a refused upgrade is the answer the live tools want to read, and `WebSocket`
 * reports every refusal as the same opaque error event.
 *
 * `wsBaseUrl` is the OCPP endpoint as reachable from THIS host; the charge
 * point id is appended as the last path segment.
 */
import { connect } from "node:net";

export function handshakeStatus(
  wsBaseUrl: string,
  cpId: string,
  basicAuthPassword?: string,
): Promise<number> {
  const url = new URL(`${wsBaseUrl}/${cpId}`);
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const auth = basicAuthPassword === undefined ? "" : `Authorization: Basic ${btoa(`${cpId}:${basicAuthPassword}`)}\r\n`;
  return new Promise((resolve, reject) => {
    const socket = connect(Number(url.port || 80), url.hostname, () => {
      socket.write(
        `GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
          `Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Protocol: ocpp1.6\r\n${auth}\r\n`,
      );
    });
    socket.setTimeout(10_000, () => socket.destroy(new Error("handshake timed out")));
    socket.once("data", (chunk) => {
      resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(chunk.toString())?.[1] ?? 0));
      socket.destroy();
    });
    socket.once("error", reject);
  });
}
