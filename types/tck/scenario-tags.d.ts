/**
 * scenario-tags.ts -- the closed vocabulary of a scenario's functional tags.
 *
 * Three selection axes, each read off its own fact and never off another's:
 * `--version` reads `ScenarioSpec.ocppVersion`, the protocol; `--group` reads
 * upstream's array membership, mirrored on purpose and not a taxonomy; and
 * `--tag` reads `ScenarioSpec.tags`, what the scenario is about. A scenario
 * may carry several tags, which a group cannot express.
 *
 * The names follow OCPP 2.0.1's functional blocks, applied to 1.6 scenarios by
 * the same meaning, with one exception: TriggerMessage is `remote-trigger`
 * rather than part of `remote-control`, because OCPP 1.6 makes it a feature
 * profile of its own and a conformance report is read along those.
 *
 * THE ASSIGNMENT RULE. A tag names a function the scenario EXERCISES -- one it
 * drives, or one its verdict reads -- not one it only passes through on the
 * way. TC_K_29 needs a running transaction and says in its own comment that it
 * is "not about the transaction", so it is `smart-charging` alone; TC_K_60
 * scopes its profile to that transaction's id, so it is both. A tag is
 * declared on the spec (or the `.feature`), never derived from its file, its
 * template id, its group, its OCA case prefix or its protocol.
 *
 * Extending the vocabulary is adding a member here with its one-line meaning,
 * a row to README.md's tag table, and at least one scenario that carries it:
 * `tests/scenario-tags.ts` refuses a tag nothing carries.
 */
/** Every tag, in the order help and reports list them, with what it means. */
export declare const SCENARIO_TAG_MEANINGS: {
    readonly provisioning: "booting, resetting and configuring the station (BootNotification, Reset, GetConfiguration, ChangeConfiguration, GetVariables, SetVariables, SetNetworkProfile)";
    readonly authorization: "the CSMS's decision about an idToken, or the authorization cache (Authorize outcome, ClearCache)";
    readonly "local-auth-list": "the station's local authorization list (GetLocalListVersion, SendLocalList)";
    readonly transaction: "a charging transaction's start, stop, refusal or absence, as the frames or the CSMS's transaction record show it";
    readonly "remote-control": "the CSMS controlling a session or a connector (RemoteStartTransaction, RemoteStopTransaction, UnlockConnector)";
    readonly "remote-trigger": "the CSMS asking the station to send a message (TriggerMessage)";
    readonly availability: "operative state and status of a connector, an EVSE or the station (ChangeAvailability, StatusNotification)";
    readonly reservation: "reserving a connector (ReserveNow, CancelReservation)";
    readonly metering: "meter values reported outside a transaction (MeterValues)";
    readonly "smart-charging": "charging profiles and composite schedules (SetChargingProfile, GetChargingProfiles, ClearChargingProfile, GetCompositeSchedule)";
    readonly firmware: "firmware and diagnostics management (UpdateFirmware, GetDiagnostics)";
    readonly certificates: "certificate management (InstallCertificate, GetInstalledCertificateIds)";
    readonly "data-transfer": "vendor-specific data exchange (DataTransfer)";
};
export type ScenarioTag = keyof typeof SCENARIO_TAG_MEANINGS;
/** The vocabulary, in declaration order. */
export declare const SCENARIO_TAGS: readonly ScenarioTag[];
/** What a spec declares: at least one tag, so a filter never misses it. */
export type ScenarioTags = readonly [ScenarioTag, ...ScenarioTag[]];
export declare function isScenarioTag(value: string): value is ScenarioTag;
/** Validate a user- or feature-supplied tag before anything is selected. */
export declare function parseScenarioTag(value: string): ScenarioTag;
/** Validate a whole declaration -- at least one tag, each known, none twice.
 *  What a `.feature` compiles through; a TypeScript spec gets the first two
 *  from its type, and `tests/scenario-tags.ts` checks all three at runtime. */
export declare function parseScenarioTags(values: readonly string[]): ScenarioTags;
