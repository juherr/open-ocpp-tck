@sut:csms @id:cert16-tc001-cold-boot @ocpp:1.6 @template:cert16-tc001-cold-boot @connector:1 @bootWaitSecs:4 @holdSecs:20
Feature: TC_001 Cold Boot

  Scenario: The charge point reports its initial state and idles
    Given a charge point connects on connector 1
    Then a "BootNotification" request is sent
    And the "BootNotification" response status is "Accepted"
    And every "StatusNotification" request is answered
    And every "Heartbeat" request is answered
    And a StatusNotification request is sent with status Available on connector 1
    And the simulator scenario completes
    And no message is blocked by the boot gate
