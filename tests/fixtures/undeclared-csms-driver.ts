// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * fake-csms-driver.ts without its capability declaration, for the row of
 * tests/csms-server.ts that holds what the daemon assumes of a module that
 * declares nothing: the compulsory OCPP 1.6 vocabulary, and no admin surface.
 */
import type { CsmsDriverModule } from "../../tck/driver";
import { csmsDriver as declared } from "./fake-csms-driver";

const { capabilities: _, ...undeclared } = declared;

export const csmsDriver: CsmsDriverModule = undeclared;
