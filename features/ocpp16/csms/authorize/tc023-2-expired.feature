@sut:csms @id:cert16-tc023-2-authorize-expired @ocpp:1.6 @template:cert16-tc023-2-authorize-expired @connector:1 @bootWaitSecs:4 @holdSecs:15 @tag:authorization @tag:transaction
Feature: TC_023.2 Authorize Outcome (Expired)

  Scenario: idTag CERT023-EXP has expiry_date in the past -> Authorize.conf Expired, no StartTransaction.
    Given a charge point connects on connector 1
    Then an "Authorize" request is sent with idTag "CERT023-EXP"
    And the "Authorize" response idTagInfo status is "Expired"
    And no "StartTransaction" request is sent
    And the simulator scenario completes
    And no transaction exists for idTag "CERT023-EXP"
