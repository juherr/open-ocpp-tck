@sut:csms @id:cert16-tc003-charging-plugin-first @ocpp:1.6 @template:cert16-tc003-charging-plugin-first @connector:1 @bootWaitSecs:4 @holdSecs:45
Feature: TC_003 Charging Session, plug-in first

  Scenario: The charge point starts and closes a charging transaction
    Given a charge point connects on connector 1
    Then a "StatusNotification" request with status "Preparing" precedes a "StartTransaction" request
    And a "StartTransaction" request is sent with idTag "CERT003"
    And the "StartTransaction" response idTagInfo status is "Accepted"
    And a "MeterValues" request is sent
    And a MeterValues request precedes a StopTransaction request
    And a "StopTransaction" request is sent
    And a StatusNotification request is sent with status Available
    And every "Authorize" request is answered
    And every "StatusNotification" request is answered
    And a transaction exists with idTag "CERT003"
