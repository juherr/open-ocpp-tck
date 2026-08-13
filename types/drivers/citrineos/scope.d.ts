/**
 * scope.ts -- what CitrineOS can drive, and what it demonstrably cannot.
 *
 * This is the first table in the repository with NOT_APPLICABLE rows, which is
 * the point of having a second driver at all: SteVe's table claims every
 * scenario because the scenarios were written against SteVe, so until now the
 * machinery that reports a scenario as out of scope had never fired.
 *
 * Every status below was settled by a real sweep against the pinned image, not
 * by reading sources -- 44 + 3 scenarios, 2026-08-11; VENDOR.md carries the
 * numbers. The seven NOT_APPLICABLE rows were predicted from the sources first
 * and then confirmed against a running container, whose /docs/json advertises
 * 18 `/ocpp/1.6/` paths with neither `reserveNow` nor `cancelReservation`
 * among them.
 *
 * TWO ROWS ARE DRIVABLE AND CURRENTLY RED, ON PURPOSE. `tck/scope.ts` forbids
 * demoting a row to NOT_APPLICABLE to make a red scenario go away, because
 * that converts a finding about the CSMS into a silence about the harness.
 * Both are findings against CitrineOS rather than gaps in this driver, and
 * both are named in drivers/citrineos/README.md's gap table. A TCK whose
 * second driver reports 100% green is a TCK that has stopped measuring.
 */
import type { ScopeTable } from "../../tck/scope";
import { type CitrineVariant } from "./variant";
/** The scope table for a declared variant. See variant.ts. */
export declare function citrineosScope(variant: CitrineVariant): ScopeTable;
