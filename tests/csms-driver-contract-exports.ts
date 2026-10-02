import {
  CSMS_OPERATION_16_ACTIONS as generic16,
  CSMS_OPERATION_201_ACTIONS as generic201,
  ChargePointAlreadyExistsError as GenericExists,
  ChargePointNotFoundError as GenericNotFound,
} from "../packages/csms-driver";
import {
  CSMS_OPERATION_16_ACTIONS as compatible16,
  CSMS_OPERATION_201_ACTIONS as compatible201,
  ChargePointAlreadyExistsError as CompatibleExists,
  ChargePointNotFoundError as CompatibleNotFound,
} from "../tck/driver";
import type {
  CsmsOperation16 as Generic16,
  CsmsOperation201 as Generic201,
  CsmsCapabilities,
  CsmsChargePointAdmin,
  CsmsDriver,
  ChargePointDefinition,
  ChargePointDetails,
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

const genericCapabilities: CsmsCapabilities = {
  operations16: new Set(["Reset"]),
};
const invalidGenericCapabilities: CsmsCapabilities = {
  operations16: new Set(["Reset"]),
  // @ts-expect-error TCK record availability is not a generic CSMS capability.
  reservations: true,
};

// Charge-point administration is an opt-in surface with its own declaration.
const chargePointCapabilities: CsmsCapabilities = {
  operations16: new Set(["Reset"]),
  chargePoints: { securityProfiles: new Set([0, 1]) },
};
const chargePointAdmin: CsmsChargePointAdmin = {
  create: async () => {},
  get: async () => null,
  update: async () => {},
  delete: async () => {},
};
const adminDriver: CsmsDriver = {
  capabilities: chargePointCapabilities,
  operations16: { execute: async () => "" },
  chargePoints: chargePointAdmin,
};
const basicAuthStation: ChargePointDefinition = {
  id: "CP-1",
  registration: "Pending",
  security: { profile: 1, basicAuthPassword: "secret" },
  description: "bay 1",
};
// @ts-expect-error profiles 1 and 2 authenticate with HTTP Basic, so they need its password.
const passwordlessBasicAuth: ChargePointDefinition = { id: "CP-1", security: { profile: 1 } };
// @ts-expect-error OCPP defines security profiles 0 to 3 only.
const unknownProfile: ChargePointDefinition = { id: "CP-1", security: { profile: 4 } };
// @ts-expect-error a CSMS form field name is not part of the generic model.
const vendorField: ChargePointDefinition = { id: "CP-1", chargeBoxId: "CP-1" };
const readBack: ChargePointDetails = {
  id: "CP-1",
  registration: "Accepted",
  // @ts-expect-error the password is write-only and never read back.
  security: { profile: 1, basicAuthPassword: "secret" },
};

void [
  chargePointCapabilities,
  adminDriver,
  basicAuthStation,
  passwordlessBasicAuth,
  unknownProfile,
  vendorField,
  readBack,
  compatibleRequest16,
  compatibleRequest201,
  invalid16,
  invalid201,
  genericCapabilities,
  invalidGenericCapabilities,
];

if (generic16 !== compatible16 || generic201 !== compatible201) {
  throw new Error("The legacy TCK driver entry must re-export library contracts.");
}
// `instanceof` is how a consumer tells the two outcomes apart, so both entries
// must hand out the same classes.
if (GenericExists !== CompatibleExists || GenericNotFound !== CompatibleNotFound) {
  throw new Error("The legacy TCK driver entry must re-export the charge-point errors.");
}
