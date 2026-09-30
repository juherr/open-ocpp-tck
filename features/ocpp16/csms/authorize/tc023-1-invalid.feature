@sut:csms @id:cert16-tc023-1-authorize-invalid @ocpp:1.6 @template:cert16-tc023-1-authorize-invalid @connector:1 @bootWaitSecs:4 @holdSecs:15
Feature: TC_023.1 Authorize Outcome (Invalid)

  Scenario: unknown idTag CERT023-INV -> Authorize.conf Invalid, no StartTransaction.
    Given a charge point connects on connector 1
    Then an "Authorize" request is sent with idTag "CERT023-INV"
    And the "Authorize" response idTagInfo status is "Invalid"
    And no "StartTransaction" request is sent
    And the simulator scenario completes
    And no transaction exists for idTag "CERT023-INV"
