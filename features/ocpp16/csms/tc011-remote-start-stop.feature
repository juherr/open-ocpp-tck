@sut:csms @id:cert16-tc011-remote-start-stop @ocpp:1.6 @template:cert16-tc011-remote-start-stop @connector:1 @bootWaitSecs:4 @holdSecs:20
Feature: TC_011 Remote Start and Remote Stop

  Scenario: The CSMS starts and stops a charging transaction
    Given a charge point connects on connector 1
    When the CSMS waits 2 seconds
    And the CSMS sends RemoteStartTransaction
      | action      | RemoteStartTransaction |
      | connectorId | 1                       |
      | idTag       | CERT-TAG-2              |
    And the CSMS waits 3 seconds
    And the latest transaction is captured
    And the CSMS waits 2 seconds
    And the CSMS sends RemoteStopTransaction for the captured transaction when one exists
      | action | RemoteStopTransaction |
    Then the CSMS "RemoteStartTransaction" response status is "Accepted"
    And a StartTransaction request is sent with CSMS-supplied idTag "CERT-TAG-2"
    And the CSMS "RemoteStopTransaction" response status is "Accepted"
    And a StopTransaction request is sent with reason "Remote"
    And every "StatusNotification" request is answered
    And every "StartTransaction" request is answered
    And every "Authorize" request is answered
    And the transaction is closed
