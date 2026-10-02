// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0

// The HTTP surface, and nothing behind it: the decoders and the classifier are
// how the handler keeps its promises, not promises of their own.
export { createCsmsHttpHandler, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from "./handler";
export type { CsmsHttpAbout, CsmsHttpHandler, CsmsHttpOptions } from "./handler";
export type { CsmsErrorCode } from "./errors";
export { OPERATION_16_PATHS } from "./operations16";
