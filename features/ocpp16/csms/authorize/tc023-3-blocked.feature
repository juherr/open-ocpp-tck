@sut:csms @id:cert16-tc023-3-authorize-blocked @ocpp:1.6 @template:cert16-tc023-3-authorize-blocked @connector:1 @bootWaitSecs:4 @holdSecs:15
Feature: TC_023.3 Authorize Outcome (Blocked)

  Scenario: idTag CERT023-BLK is blocked -> Authorize.conf Blocked, no StartTransaction.
    Given a charge point connects on connector 1
    Then an "Authorize" request is sent with idTag "CERT023-BLK"
    And the "Authorize" response idTagInfo status is "Blocked"
    And no "StartTransaction" request is sent
    And the simulator scenario completes
    And no transaction exists for idTag "CERT023-BLK"
