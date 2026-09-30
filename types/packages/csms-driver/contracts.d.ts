/**
 * CSMS-neutral OCPP operation contracts, capabilities, and dispatch errors.
 * TCK-specific driver lifecycle and assertion records live under tck/.
 */
export type TransactionRef = string;
/** A CSMS-side reservation handle. `""` = none. */
export type ReservationRef = string;
/** A CSMS-side charging-profile handle. `""` = none. */
export type ChargingProfileRef = string;
export type ResetType16 = "Hard" | "Soft";
export type AvailabilityType = "Operative" | "Inoperative";
export type UpdateType = "Full" | "Differential";
export type ChargingRateUnit = "A" | "W";
export type ChargingProfilePurpose = "ChargePointMaxProfile" | "TxDefaultProfile" | "TxProfile";
export type MessageTrigger = "BootNotification" | "DiagnosticsStatusNotification" | "FirmwareStatusNotification" | "Heartbeat" | "MeterValues" | "StatusNotification";
export type AuthorizationStatus = "Accepted" | "Blocked" | "Expired" | "Invalid" | "ConcurrentTx";
/**
 * One `AuthorizationData` entry of a SendLocalList payload.
 *
 * A CSMS whose local-list API carries only tag NAMES -- SteVe's manager UI
 * does -- honours `idTag` and must DOCUMENT in its driver that it ignores the
 * rest. It must not silently pretend it applied `status` or `expiryDate`:
 * a scenario asserting on the resulting list would then pass for a reason that
 * never happened.
 */
export interface LocalAuthorizationEntry {
    idTag: string;
    status?: AuthorizationStatus;
    expiryDate?: Date;
    parentIdTag?: string;
}
export type CsmsOperation16 = {
    action: "Reset";
    type: ResetType16;
} | {
    action: "UnlockConnector";
    connectorId: number;
} | {
    action: "ClearCache";
} | {
    action: "ChangeAvailability";
    connectorId: number;
    type: AvailabilityType;
} | {
    action: "GetConfiguration";
    /** Absent = every key. A CSMS that can only ask for all keys throws
     *  {@link UnsupportedOperationError} when this is present and non-empty,
     *  rather than silently widening the request. */
    keys?: string[];
} | {
    action: "ChangeConfiguration";
    key: string;
    value: string;
} | {
    action: "RemoteStartTransaction";
    idTag: string;
    /** Absent = let the charge point choose the connector. */
    connectorId?: number;
    /** Absent = start without a charging profile. Present means the profile
     *  must travel INSIDE RemoteStartTransaction.req -- that is what the
     *  scenario asserts on the wire, so a CSMS that can only apply it out of
     *  band must throw rather than apply it another way. */
    chargingProfile?: ChargingProfileRef;
} | {
    action: "RemoteStopTransaction";
    transaction: TransactionRef;
} | {
    action: "TriggerMessage";
    requestedMessage: MessageTrigger;
    /** Absent = station-wide, i.e. no connectorId on the wire. */
    connectorId?: number;
} | {
    action: "SetChargingProfile";
    connectorId: number;
    chargingProfile: ChargingProfileRef;
    /** Present = scoped to this running transaction (TxProfile). */
    transaction?: TransactionRef;
} | {
    action: "GetCompositeSchedule";
    connectorId: number;
    /** Seconds. */
    duration: number;
    chargingRateUnit?: ChargingRateUnit;
} | {
    action: "ClearChargingProfile";
    chargingProfile?: ChargingProfileRef;
    connectorId?: number;
    purpose?: ChargingProfilePurpose;
    stackLevel?: number;
} | {
    action: "UpdateFirmware";
    location: string;
    /** An absolute instant. A CSMS whose API takes a minute-resolution local
     *  string formats it ITSELF, and rounds UP to the next whole minute so
     *  that any strictly-future instant stays strictly future -- truncating
     *  can land in the already-past current minute. */
    retrieveDate: Date;
    retries?: number;
    /** Seconds. */
    retryInterval?: number;
} | {
    action: "GetDiagnostics";
    location: string;
    startTime?: Date;
    stopTime?: Date;
    retries?: number;
    retryInterval?: number;
} | {
    action: "GetLocalListVersion";
} | {
    action: "SendLocalList";
    listVersion: number;
    updateType: UpdateType;
    /** Absent = an empty list. A Full update with no entries clears it. */
    localAuthorizationList?: LocalAuthorizationEntry[];
} | {
    action: "ReserveNow";
    connectorId: number;
    idTag: string;
    expiryDate: Date;
    parentIdTag?: string;
    /** Absent = let the CSMS allocate the reservation id. */
    reservation?: ReservationRef;
} | {
    action: "CancelReservation";
    reservation: ReservationRef;
};
export type CsmsOperation16Action = CsmsOperation16["action"];
/** Every action name, for capability declarations and run reporting. */
export declare const CSMS_OPERATION_16_ACTIONS: readonly ["Reset", "UnlockConnector", "ClearCache", "ChangeAvailability", "GetConfiguration", "ChangeConfiguration", "RemoteStartTransaction", "RemoteStopTransaction", "TriggerMessage", "SetChargingProfile", "GetCompositeSchedule", "ClearChargingProfile", "UpdateFirmware", "GetDiagnostics", "GetLocalListVersion", "SendLocalList", "ReserveNow", "CancelReservation"];
/** OCPP 2.0.1 `ResetEnumType`. Not OCPP 1.6's Hard/Soft -- see the note on
 *  the `Reset` arm below. */
export type ResetType201 = "Immediate" | "OnIdle";
/**
 * OCPP 2.0.1 `MessageTriggerEnumType`, whole.
 *
 * COMPLETE WHERE THE UNION BELOW IS MINIMAL, and the two rules do not conflict
 * because they are about different things. "As few as the slice needs" prices
 * an operation and an optional member: each costs a driver a switch arm or a
 * field to translate, and each can be added later for nothing. An enum value
 * costs neither -- a driver passes it through -- and adding one LATER is the
 * breaking direction for a driver that switches on it exhaustively. So the
 * eleven are here because widening is the expensive move, not because a
 * scenario reaches them; {@link MessageTrigger} carries OCPP 1.6's six on the
 * same terms.
 */
export type MessageTrigger201 = "BootNotification" | "FirmwareStatusNotification" | "Heartbeat" | "LogStatusNotification" | "MeterValues" | "PublishFirmwareStatusNotification" | "SignChargingStationCertificate" | "SignCombinedCertificate" | "SignV2GCertificate" | "StatusNotification" | "TransactionEvent";
/**
 * OCPP 2.0.1 `EVSEType` -- how a request addresses part of a station.
 *
 * NESTED, AND THAT IS THE WHOLE POINT rather than a transcription of the
 * schema. 2.0.1 has no flat `evseId` member on this request: `id` names the
 * EVSE, and `connectorId` INSIDE the same object narrows it to one connector.
 * So the three addressing modes a request can be in are told apart by which of
 * these two are present -- whole station (no `evse` at all), one EVSE (`evse`
 * with `id` alone), one connector (`evse` with both) -- and a driver flattening
 * them into a single number makes the first and third indistinguishable on the
 * wire. Two of the six ChangeAvailability cases differ from two others in
 * NOTHING ELSE, so the flat spelling would have made them duplicates that both
 * pass.
 *
 * `ResetRequest`'s own `evseId` is a different member and stays flat, because
 * that is what its schema carries: 2.0.1 does not address a connector for a
 * reset.
 */
export interface Evse201 {
    id: number;
    connectorId?: number;
}
/** OCPP 2.0.1 `ComponentType` -- half of a device-model address. */
export interface Component201 {
    name: string;
}
/** OCPP 2.0.1 `VariableType` -- the other half of a device-model address. */
export interface Variable201 {
    name: string;
}
/** OCPP 2.0.1 `GetVariableDataType`. */
export interface GetVariableData201 {
    component: Component201;
    variable: Variable201;
}
/** OCPP 2.0.1 `SetVariableDataType`. */
export interface SetVariableData201 {
    component: Component201;
    variable: Variable201;
    /** Always a string on the wire, whatever the variable's declared data type:
     *  2.0.1 carries values as text and the device model says how to read them.
     *  A driver must not "helpfully" send a number. */
    attributeValue: string;
}
/** OCPP 2.0.1 `ChargingProfilePurposeEnumType`, whole. NOT
 *  {@link ChargingProfilePurpose}: 1.6 spells the station-wide purpose
 *  `ChargePointMaxProfile` and has no external-constraints value at all. */
export type ChargingProfilePurpose201 = "ChargingStationExternalConstraints" | "ChargingStationMaxProfile" | "TxDefaultProfile" | "TxProfile";
/** OCPP 2.0.1 `ChargingProfileKindEnumType`. */
export type ChargingProfileKind201 = "Absolute" | "Recurring" | "Relative";
/** OCPP 2.0.1 `RecurrencyKindEnumType`. */
export type RecurrencyKind201 = "Daily" | "Weekly";
/** OCPP 2.0.1 `ChargingRateUnitEnumType`. */
export type ChargingRateUnit201 = "W" | "A";
/** OCPP 2.0.1 `ChargingSchedulePeriodType`. */
export interface ChargingSchedulePeriod201 {
    startPeriod: number;
    limit: number;
    numberPhases?: number;
    phaseToUse?: number;
}
/**
 * OCPP 2.0.1 `ChargingScheduleType`.
 *
 * `id` IS REQUIRED AND HAS NO 1.6 COUNTERPART. 1.6's chargingSchedule is
 * anonymous -- it is identified by the profile that carries it -- where 2.0.1
 * gives every schedule its own identifier, because a profile may carry up to
 * three and `GetCompositeSchedule` and `NotifyEVChargingSchedule` name one.
 *
 * `startSchedule` is optional in the schema and NOT optional in practice for
 * the two kinds this suite sends: 2.0.1 requires it for `Absolute` and
 * `Recurring` and forbids it for `Relative`. That is a rule about the pair, so
 * it is not expressible in this type without splitting the profile into three,
 * and it is stated here rather than enforced.
 */
export interface ChargingSchedule201 {
    id: number;
    chargingRateUnit: ChargingRateUnit201;
    /** 1..N on the wire, and the first period's `startPeriod` must be 0. */
    chargingSchedulePeriod: [
        ChargingSchedulePeriod201,
        ...ChargingSchedulePeriod201[]
    ];
    startSchedule?: Date;
    duration?: number;
    minChargingRate?: number;
}
/**
 * OCPP 2.0.1 `ChargingProfileType` -- the profile itself, INLINE.
 *
 * NOT A {@link ChargingProfileRef}, and the difference is the protocol's
 * rather than this contract's. OCPP 1.6's `SetChargingProfile` is driven here
 * through an opaque CSMS-side handle because 1.6 CSMSs keep a profile registry
 * a scenario has to name a row of; 2.0.1 carries the whole profile in the
 * request, so there is nothing to look up and a ref would be a key into a
 * table no 2.0.1 driver has to have.
 *
 * `chargingSchedule` is a tuple of one to three because that is what the
 * schema says, and the bound is worth keeping: a driver that forwards the
 * array verbatim is forwarding something already known to be well-sized.
 */
export interface ChargingProfile201 {
    id: number;
    stackLevel: number;
    chargingProfilePurpose: ChargingProfilePurpose201;
    chargingProfileKind: ChargingProfileKind201;
    chargingSchedule: [ChargingSchedule201] | [ChargingSchedule201, ChargingSchedule201] | [ChargingSchedule201, ChargingSchedule201, ChargingSchedule201];
    recurrencyKind?: RecurrencyKind201;
    validFrom?: Date;
    validTo?: Date;
    /** A STRING in 2.0.1, where 1.6's transactionId is a number -- 2.0.1 lets
     *  the STATION mint the identifier, so it is text on the wire. Only a
     *  `TxProfile` may carry it. */
    transactionId?: string;
}
/**
 * OCPP 2.0.1 `ChargingLimitSourceEnumType`, whole.
 *
 * WHO SET THE LIMIT, which is a thing 1.6 has no vocabulary for at all -- there
 * is no homonym here to argue about, so this type needs none of the notes the
 * four above carry. `CSO` is the charging station operator, i.e. the CSMS
 * itself; `EMS` an energy management system, `SO` the system operator, `Other`
 * anything else.
 *
 * Complete rather than minimal, by {@link MessageTrigger201}'s rule: an enum
 * value costs a driver nothing to pass through, and adding one later is the
 * breaking direction for a driver that switches on it exhaustively.
 */
export type ChargingLimitSource201 = "EMS" | "Other" | "SO" | "CSO";
/**
 * OCPP 2.0.1 `ChargingProfileCriterionType` -- which of the profiles a station
 * holds a `GetChargingProfiles` is asking about.
 *
 * EVERY MEMBER IS OPTIONAL AND THE OBJECT IS NOT. The schema requires the
 * `chargingProfile` member of the request and requires nothing inside it, so
 * `{}` is the legal way to spell "all of them" and there is no way to spell it
 * by omission. That asymmetry is the reason this is a named type rather than an
 * inline shape: a driver that "helpfully" drops an empty criterion has sent a
 * request the schema rejects.
 *
 * TUPLES RATHER THAN ARRAYS, for {@link ChargingSchedule201}'s reason: the
 * schema says 1..N, so an empty array is not a value either member can take,
 * and a driver forwarding one verbatim is forwarding something already known to
 * be well-sized. The four the wire allows in `chargingLimitSource` are not
 * expressible as a tuple bound without spelling four arms, and the enum has
 * exactly four values, so the bound is stated rather than typed.
 */
export interface ChargingProfileCriterion201 {
    chargingProfilePurpose?: ChargingProfilePurpose201;
    stackLevel?: number;
    chargingProfileId?: [number, ...number[]];
    /** At most four on the wire. */
    chargingLimitSource?: [ChargingLimitSource201, ...ChargingLimitSource201[]];
}
/**
 * OCPP 2.0.1 `ClearChargingProfileType` -- which of the profiles a station
 * holds a `ClearChargingProfile` is asking it to forget.
 *
 * A DIFFERENT TYPE FROM {@link ChargingProfileCriterion201}, and the two are
 * near enough to be worth saying why. That one selects what to REPORT and this
 * one what to REMOVE; the wire gives them different names, different members --
 * this one has `evseId` INSIDE it where the query carries it as a sibling --
 * and different cardinalities, since nothing here is a list. Folding them into
 * one shape would let a scenario ask to clear by `chargingLimitSource`, which
 * is not a thing the request can express.
 *
 * OPTIONAL AND OMISSIBLE, unlike the query's criterion: the schema requires no
 * member of the request at all, so `undefined` here is a request that clears by
 * identifier alone. That is TC_K_08's request and TC_K_05's.
 */
export interface ClearChargingProfileCriteria201 {
    /** Absent = every EVSE; 0 = the station itself. Omit, never send null. */
    evseId?: number;
    chargingProfilePurpose?: ChargingProfilePurpose201;
    stackLevel?: number;
}
/**
 * OCPP 2.0.1 `InstallCertificateUseEnumType` -- what kind of root a certificate
 * is being installed as.
 *
 * FOUR VALUES WHERE {@link GetCertificateIdUse201} HAS FIVE, and the pair is
 * the reason both are named types rather than one shared enumeration. A
 * certificate is installed as a root; it is asked about as a root or as a
 * `V2GCertificateChain`, which is not a root at all. Sharing one type would
 * make a request the schema rejects -- installing a chain -- spellable.
 */
export type InstallCertificateUse201 = "V2GRootCertificate" | "MORootCertificate" | "CSMSRootCertificate" | "ManufacturerRootCertificate";
/**
 * OCPP 2.0.1 `OCPPInterfaceEnumType` -- which physical interface a network
 * connection profile is about.
 *
 * Complete rather than minimal, by {@link MessageTrigger201}'s rule: eight
 * values, four wired and four wireless, and a station's slots may name any of
 * them.
 */
export type OcppInterface201 = "Wired0" | "Wired1" | "Wired2" | "Wired3" | "Wireless0" | "Wireless1" | "Wireless2" | "Wireless3";
/** OCPP 2.0.1 `OCPPTransportEnumType`. Both values, though a 2.0.1 station
 *  only ever speaks the first: the enumeration is the protocol's and a driver
 *  must be able to spell what a CSMS might send. */
export type OcppTransport201 = "JSON" | "SOAP";
/**
 * OCPP 2.0.1 `OCPPVersionEnumType` -- which protocol version a network
 * connection profile tells the station to speak on that slot.
 *
 * NOT THE VERSION ANYTHING ELSE HERE MEANS BY "OCPP VERSION", which is why the
 * name is long. `ScenarioSpec`'s `ocppVersion` says which protocol a scenario
 * runs; `CitrineOcppVersion` in a driver says which route a CSMS registered.
 * This one is a MEMBER of a request, spelled the way 2.0.1 spells it -- and
 * 2.0.1 spells its own version `OCPP20`, with no value for 2.0.1 or 2.1 at all.
 * A shared type would put one of those spellings where another is required.
 */
export type NetworkProfileOcppVersion201 = "OCPP12" | "OCPP15" | "OCPP16" | "OCPP20";
/** OCPP 2.0.1 `APNAuthenticationEnumType`. */
export type ApnAuthentication201 = "CHAP" | "NONE" | "PAP" | "AUTO";
/** OCPP 2.0.1 `VPNEnumType`. */
export type VpnType201 = "IKEv2" | "IPSec" | "L2TP" | "PPTP";
/**
 * OCPP 2.0.1 `APNType` -- the cellular access point a profile dials through.
 *
 * HERE THOUGH NO SELECTED CASE NEEDS IT, by {@link MessageTrigger201}'s rule
 * applied to a member rather than to an enum value: `TC_B_42` and `TC_B_44` are
 * the only `SetNetworkProfile` cases the selection rule picks and neither
 * carries an APN, but a driver whose CSMS manages cellular stations cannot
 * spell one without this, and adding a member later is the breaking direction
 * for nobody while omitting it is a contract that describes less than the wire.
 */
export interface Apn201 {
    apn: string;
    apnAuthentication: ApnAuthentication201;
    apnUserName?: string;
    apnPassword?: string;
    simPin?: number;
    preferredNetwork?: string;
    useOnlyPreferredNetwork?: boolean;
}
/** OCPP 2.0.1 `VPNType`. Here for {@link Apn201}'s reason; its five required
 *  members are required by the schema whenever the object is present at all. */
export interface Vpn201 {
    server: string;
    user: string;
    password: string;
    key: string;
    type: VpnType201;
    group?: string;
}
/**
 * OCPP 2.0.1 `NetworkConnectionProfileType` -- how a station should reach a
 * CSMS on one of its configuration slots.
 *
 * SIX REQUIRED MEMBERS AND TWO OPTIONAL ONES, and the six are exactly what
 * `TC_B_42` validates. That is unusual enough in this contract to say out loud:
 * most cases here turn on which members are PRESENT, and this one turns on all
 * six being carried unchanged -- so a driver that dropped one has failed the
 * case rather than sent a different request.
 *
 * `securityProfile` IS A NUMBER AND NOT AN ENUM. OCPP defines profiles 1..3 and
 * types the member as a plain integer; a union of three would refuse a value
 * the wire accepts, and refusing it here would put this contract's opinion in
 * front of a CSMS's.
 */
export interface NetworkConnectionProfile201 {
    ocppVersion: NetworkProfileOcppVersion201;
    ocppTransport: OcppTransport201;
    /** Where the station should connect. A URL as text; nothing here parses it. */
    ocppCsmsUrl: string;
    /** Seconds the station waits for a response on this connection. */
    messageTimeout: number;
    /** 1..3 in the specification, an integer on the wire. */
    securityProfile: number;
    ocppInterface: OcppInterface201;
    apn?: Apn201;
    vpn?: Vpn201;
}
/**
 * OCPP 2.0.1 `GetCertificateIdUseEnumType` -- which installed certificates a
 * `GetInstalledCertificateIds` is asking the station to list.
 *
 * FIVE VALUES AND NOT FOUR, which is the whole reason this is its own type
 * rather than a reuse of the enumeration `InstallCertificate` ranges over. A
 * certificate can be INSTALLED only as one of the four roots; it can be ASKED
 * ABOUT as one of those four or as `V2GCertificateChain`, which is not a root
 * at all but the chain a station holds under one. The wire gives the two
 * requests different enumerations for that reason, and a shared type would let
 * a scenario ask to install a chain -- a request the schema rejects.
 *
 * Complete rather than minimal, by {@link MessageTrigger201}'s rule.
 */
export type GetCertificateIdUse201 = "V2GRootCertificate" | "MORootCertificate" | "CSMSRootCertificate" | "V2GCertificateChain" | "ManufacturerRootCertificate";
export type CsmsOperation201 = {
    action: "Reset";
    type: ResetType201;
    /** Which EVSE to reset. Absent means the whole charging station, which
     *  is what 2.0.1 says an omitted `evseId` means -- so an absent one is
     *  omitted rather than sent as 0. */
    evseId?: number;
} | {
    action: "GetVariables";
    variables: GetVariableData201[];
} | {
    action: "SetVariables";
    variables: SetVariableData201[];
} | {
    action: "TriggerMessage";
    requestedMessage: MessageTrigger201;
} | {
    action: "ChangeAvailability";
    operationalStatus: "Inoperative" | "Operative";
    /** WHICH PART OF THE STATION, and its absence is a value rather than a
     *  default. Absent addresses the whole charging station; present with
     *  `connectorId` absent addresses that EVSE; present with `connectorId`
     *  addresses that connector. See {@link Evse201} for why this is not a
     *  flat `evseId`. A driver must omit the member rather than send `null`
     *  or an empty object. */
    evse?: Evse201;
} | {
    action: "SetChargingProfile";
    /** Which EVSE the profile is installed at. 0 addresses the charging
     *  station itself, which is what a `ChargingStationMaxProfile` requires
     *  and what a station-wide `TxDefaultProfile` uses; a `TxProfile` needs
     *  a real EVSE. NOT optional the way `ChangeAvailability`'s `evse` is:
     *  2.0.1's SetChargingProfileRequest makes this member required, so
     *  there is no absence to give a meaning to. */
    evseId: number;
    chargingProfile: ChargingProfile201;
} | {
    action: "GetCompositeSchedule";
    /** Same addressing as above, and 0 means the grid connection point --
     *  the station's own total rather than "every EVSE". */
    evseId: number;
    /** Seconds forward from now that the schedule should cover. */
    duration: number;
    /** Absent means the station picks. Present, it is what the returned
     *  schedule's limits are expressed in. */
    chargingRateUnit?: ChargingRateUnit201;
} | {
    action: "GetChargingProfiles";
    /** The station echoes it in every `ReportChargingProfiles` it answers
     *  with, so it is how a report is tied back to the request that asked
     *  for it. Required by the schema; a scenario chooses the value. */
    requestId: number;
    /** Absent = every EVSE; 0 = the station itself. Omit, never send null.
     *  NOT `SetChargingProfile`'s required member and not
     *  `GetCompositeSchedule`'s either -- this is the one charging-profile
     *  request of the three whose scope has an absence to give a meaning
     *  to. */
    evseId?: number;
    /** Wire name kept: the body IS the OCPP payload. Required by the schema
     *  even when every criterion inside it is optional. */
    chargingProfile: ChargingProfileCriterion201;
} | {
    action: "ClearChargingProfile";
    /** The identifier the profile was installed under. One profile, not a
     *  list -- `GetChargingProfiles`' criterion takes a list and this does
     *  not, which is the wire's asymmetry and not ours. */
    chargingProfileId?: number;
    /** Absent means the request clears by identifier alone. */
    chargingProfileCriteria?: ClearChargingProfileCriteria201;
} | {
    action: "GetInstalledCertificateIds";
    /** Which kinds of certificate to list. Absent = every kind. Omit, never
     *  send an empty array: the schema's `minItems` is 1, so `[]` asks for
     *  nothing while looking like it asks for everything. */
    certificateType?: [GetCertificateIdUse201, ...GetCertificateIdUse201[]];
} | {
    action: "InstallCertificate";
    certificateType: InstallCertificateUse201;
    /** The certificate itself, PEM, at most 5500 characters on the wire. */
    certificate: string;
} | {
    action: "SetNetworkProfile";
    /** Which of the station's slots to write. The station defines them; a
     *  scenario names one it was told about. */
    configurationSlot: number;
    /** Wire name kept: the body IS the OCPP payload. */
    connectionData: NetworkConnectionProfile201;
};
export type CsmsOperation201Action = CsmsOperation201["action"];
/** Every 2.0.1 action name. Same job as {@link CSMS_OPERATION_16_ACTIONS},
 *  and a SECOND list rather than an extension of it -- see the note on
 *  {@link CsmsOperation201}'s `Reset` arm for why the two must not merge. */
export declare const CSMS_OPERATION_201_ACTIONS: readonly ["Reset", "GetVariables", "SetVariables", "TriggerMessage", "ChangeAvailability", "SetChargingProfile", "GetCompositeSchedule", "GetChargingProfiles", "ClearChargingProfile", "GetInstalledCertificateIds", "InstallCertificate", "SetNetworkProfile"];
/**
 * One well-formed operation per action, and its job is to make the union above
 * expensive to grow in exactly one place.
 *
 * {@link CSMS_OPERATION_201_ACTIONS} is already bidirectional -- `everyOneOf`
 * makes the list and the union agree about NAMES. Agreeing about names says
 * nothing about whether anything can build one, and a name is all a driver
 * needs to declare an operation it cannot express. This is the other half: the
 * annotation is a mapped type over the action union whose value for each
 * action is THAT action's arm, so an arm added to {@link CsmsOperation201} is
 * a type error here until somebody writes a request of its shape. A compiler
 * check rather than a guard, for the reason the note above `everyOneOf` gives
 * -- the compiler already decides the other half, and a shell guard would be
 * re-deciding from outside what tsc knows from inside.
 *
 * `Extract` rather than a plain `Record<CsmsOperation201Action,
 * CsmsOperation201>`, which is the shape a reader reaches for first: that one
 * types every value as the WHOLE union, so `Reset: { action: "TriggerMessage",
 * … }` satisfies it. A table whose key and value may disagree is a table that
 * eventually does.
 *
 * WHAT IT IS FOR, and it is not scenario data. Every value is the cheapest
 * thing its arm admits, and the optional members are omitted rather than
 * filled: the consumer is a driver's mapper, which
 * `tests/capability-parity.ts` pushes each one through to ask whether the
 * driver that DECLARED an action can actually express it. A scenario
 * asserting on one of these would be asserting on a placeholder anyone is free
 * to change. The device-model address is a real 2.0.1 one so that a mapper
 * which looks a variable up does not fail for a reason this table invented.
 *
 * Exported because a third-party driver owes the same parity check, and a
 * second table written over there is a second table free to disagree with this
 * one.
 */
export declare const SAMPLE_OPERATION_201: {
    readonly [A in CsmsOperation201Action]: Extract<CsmsOperation201, {
        action: A;
    }>;
};
/**
 * "This CSMS's API cannot express this operation or observation AT ALL."
 *
 * Not a transport failure, not a rejection, not a timeout: a permanent
 * statement about an API surface. The runner catches it around `drive()` and
 * records NOT APPLICABLE, printing a warning that the scope table is out of
 * date -- because a driver forced to throw this at runtime is telling you its
 * own scope table missed a scenario, and the scope table is what keeps a
 * campaign from starting containers it cannot use.
 *
 * Lives in the core, not in a driver: it is part of the contract, and the
 * runner plus every driver need the SAME class -- the runner recognises it
 * with `instanceof`, so a second copy would silently degrade NOT APPLICABLE
 * into ERROR.
 */
export declare class UnsupportedOperationError extends Error {
    readonly operation: string;
    readonly reason: string;
    constructor(operation: string, reason: string);
}
/**
 * "The request never reached the CSMS."
 *
 * The transport refused it -- a rejected form post, an unauthenticated
 * request, a connection that never opened -- so the CSMS was never asked and
 * nothing went on the wire. Distinct from every other failure a driver can
 * report, and the distinction is the point: a CSMS answering wrongly is a
 * finding about the CSMS, while an operation that was never dispatched is a
 * finding about the client, and any assertion downstream of it is measuring
 * the wrong thing.
 *
 * AN OBSERVATION COUNTS TOO. `warnOpFailed` guards two records waits alongside
 * the operations, and a read whose transport refused it leaves the scenario
 * asserting on a record nobody could look up: the same wrong measurement,
 * reached from the other side.
 *
 * WHAT IT IS NOT is a request the CSMS answered and refused. A driver that
 * cannot tell the two apart must throw a plain `Error` -- claiming a
 * non-dispatch it did not observe converts an honest finding about the CSMS
 * into a false one about the client, which is this class's own failure mode
 * run backwards.
 *
 * WHAT IT CLAIMS, EXACTLY: the driver has no evidence the request became an
 * OCPP CALL. That is weaker than "nothing was sent", and deliberately so,
 * because a TIMEOUT belongs here and is not literally a connection that never
 * opened -- bytes went out and no answer came back, so whether the charge
 * point was asked is precisely what nobody knows. Reporting that as an
 * ordinary failure would warn and carry on into assertions about a station
 * that may never have been asked, which is issue #77 again; reporting it here
 * gets the verdict the uncertainty deserves. What a driver may NOT do is come
 * here from an answer it received and understood.
 *
 * A scenario that swallows this and carries on reports a handful of confident
 * FAILs about a charge point that was never asked to do anything -- which is
 * exactly what issue #77 cost to diagnose, and why `warnOpFailed` in
 * `tck/op-warn.ts` lets this one class through instead of warning and
 * continuing.
 *
 * Lives in the core for the same reason {@link UnsupportedOperationError}
 * does: the recogniser and the thrower sit on opposite sides of the driver
 * boundary and must share one class, or `instanceof` quietly stops matching.
 */
export declare class CsmsNotDispatchedError extends Error {
    readonly operation: string;
    readonly reason: string;
    constructor(operation: string, reason: string);
}
/**
 * The subset of `fetch` a driver's HTTP client needs.
 *
 * A seam, not a policy. A client that routes every request through this can be
 * handed a fake CSMS by an offline guard, which is the only way to reach the
 * branches that matter: what a client does when the transport refuses it is a
 * 45%-of-the-time event on a real server at best, and on most branches -- a
 * 503, an unparseable body -- something no CSMS here can be asked to produce.
 * Each bundled driver's client guard is built on it; the guards name themselves
 * in the clients, which is where a reader of one of them is standing.
 *
 * Lives in the core because more than one driver needs it and
 * `tests/generic-core.sh` forbids one driver from naming another. It is a
 * shape, not behaviour: the core neither calls it nor recognises it, unlike
 * {@link CsmsNotDispatchedError}.
 *
 * TRIED AND REJECTED, here because here is where it gets re-proposed: a core
 * module of its own, so the seam is not inside the one file
 * `tests/documented-install-ref.sh` compares byte for byte against the
 * installed tag. It is a real cost -- changing this type after a tag exists
 * obliges a version bump and a repoint of both install pages. It was chosen
 * anyway: the type ships in `types/` either way, so a change to it IS a public
 * API change that owes a release, and a separate module would owe a new
 * `exports` subpath to be importable at all. The third option, a copy per
 * driver, is the worst of the three -- two `FetchLike`s that drift are two
 * types a shared guard cannot substitute for each other.
 *
 * The default is always the global, resolved PER CALL rather than captured at
 * construction -- the same principle the `defaultXConfig` resolvers follow.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
/**
 * Compile-time exhaustiveness guard for a driver's `switch (op.action)`.
 *
 * Adding an operation to {@link CsmsOperation16} becomes a type error in every
 * driver that has not handled it -- which is the entire reason the vocabulary
 * is a discriminated union rather than a string map.
 */
export declare function assertNever(value: never, context: string): never;
export interface CsmsOperations16 {
    /**
     * Drives one CSMS operation against one charge point.
     *
     * Resolves once the CSMS has accepted or dispatched it. This does NOT imply
     * the charge point has responded, or ever will. The returned string is a
     * driver-defined receipt for the run log ONLY -- a redirect Location, a
     * serialized REST body, a task id. Specs MUST NOT branch on it; they assert
     * on the simulator's captured wire log.
     *
     * Throws {@link UnsupportedOperationError} when this CSMS cannot express the
     * operation at all, and {@link CsmsNotDispatchedError} when the transport
     * refused the request so that it never became an OCPP CALL -- a refused form
     * post, a connection that never opened. Prefer the second over a plain
     * `Error` wherever a driver can tell: a scenario warns and continues on
     * anything else, and continuing past an operation the charge point was never
     * asked to perform is how one lost dispatch becomes several confident
     * findings about an idle station.
     */
    execute(cpId: string, op: CsmsOperation16): Promise<string>;
}
/**
 * The same contract for {@link CsmsOperation201}, and OPTIONAL: a driver whose
 * CSMS speaks only OCPP 1.6 omits it from its {@link CsmsDriverParts} and the
 * runner substitutes a stub whose `execute` throws
 * {@link UnsupportedOperationError} -- the same substitution
 * {@link CsmsReservationRecords} gets, for the same reason. A spec therefore
 * calls `ctx.csms201` unconditionally and never branches on which driver is
 * loaded; absence becomes a NOT APPLICABLE verdict through the normal escape.
 */
export interface CsmsOperations201 {
    execute(cpId: string, op: CsmsOperation201): Promise<string>;
}
/**
 * Coarse capability declaration, for the run report and a driver's own
 * load-time self-check.
 *
 * Deliberately NOT used to skip scenarios before they run: the core cannot
 * know which operations a scenario will attempt without running it. That is
 * what the per-driver scope table is for.
 */
export interface CsmsCapabilities {
    /** Operations this driver can express. Anything outside it MUST throw
     *  {@link UnsupportedOperationError} from `operations16.execute()`; the
     *  driver's own switch is where that is enforced, this set is what gets
     *  printed. */
    readonly operations16: ReadonlySet<CsmsOperation16Action>;
    /**
     * The same, for {@link CsmsOperation201}. ABSENT means "this driver does not
     * speak OCPP 2.0.1 at all" -- not "it speaks it and declares nothing" -- and
     * `check-driver` says nothing about a driver that omits it.
     *
     * It lives on the CAPABILITIES rather than only on {@link CsmsDriverParts}
     * for the reason {@link CsmsDriverModule.capabilities} gives: parts are
     * reachable only through `create(env)`, which is entitled to demand
     * credentials, and "does this driver speak 2.0.1" has to be answerable
     * offline, without a container.
     */
    readonly operations201?: ReadonlySet<CsmsOperation201Action>;
    readonly reservations: boolean;
    readonly chargingProfiles: boolean;
    /**
     * Whether this driver can read back what the CSMS stored about a connector.
     * See {@link CsmsDeviceModelRecords} for why that is not the same question as
     * "does the CSMS speak 2.0.1".
     *
     * REQUIRED, not `deviceModel?`, and the asymmetry with `operations201?` above
     * is deliberate rather than an oversight. That one is opt-in because its
     * absence has a second meaning -- a 1.6-only driver would otherwise draw
     * "operation not declared" warnings for operations it never claimed.
     * This is a plain boolean beside `reservations` and `chargingProfiles`, its
     * two siblings, and a driver that forgets it gets a compiler error naming the
     * field instead of a printed capability list that quietly says `false`.
     */
    readonly deviceModel: boolean;
}
export type CsmsEnv = Readonly<Record<string, string | undefined>>;
