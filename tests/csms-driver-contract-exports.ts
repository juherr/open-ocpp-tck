import {
  CSMS_OPERATION_16_ACTIONS as generic16,
  CSMS_OPERATION_201_ACTIONS as generic201,
} from "../packages/csms-driver";
import {
  CSMS_OPERATION_16_ACTIONS as compatible16,
  CSMS_OPERATION_201_ACTIONS as compatible201,
} from "../tck/driver";
import type {
  CsmsOperation16 as Generic16,
  CsmsOperation201 as Generic201,
} from "../packages/csms-driver";
import type {
  CsmsOperation16 as Compatible16,
  CsmsOperation201 as Compatible201,
} from "../tck/driver";

const genericRequest16: Generic16 = { action: "Reset", type: "Hard" };
const compatibleRequest16: Compatible16 = genericRequest16;
const genericRequest201: Generic201 = { action: "Reset", type: "Immediate" };
const compatibleRequest201: Compatible201 = genericRequest201;

// The protocol vocabularies remain distinct at the type boundary.
// @ts-expect-error OCPP 2.0.1 Reset values are not OCPP 1.6 values.
const invalid16: Generic16 = genericRequest201;
// @ts-expect-error OCPP 1.6 Reset values are not OCPP 2.0.1 values.
const invalid201: Generic201 = genericRequest16;

void [compatibleRequest16, compatibleRequest201, invalid16, invalid201];

if (generic16 !== compatible16 || generic201 !== compatible201) {
  throw new Error("The legacy TCK driver entry must re-export library contracts.");
}
