@sut:csms @id:cert201-tcb21-reset-scheduled @ocpp:2.0.1 @template:cert201-tcb21-reset-scheduled @connector:1 @bootWaitSecs:4 @holdSecs:12 @tag:provisioning @tag:transaction
Feature: TC_B_21 scheduled reset

  Scenario: The CSMS schedules a reset while a transaction is active
    Given the charge point has reusable state "EnergyTransferStarted"
      | connectorId | 1        |
      | idToken     | CE712001 |
    When the CSMS waits 2 seconds
    And the CSMS sends "Reset"
      | type | OnIdle |
    Then the "Reset" request is received
    And the "Reset" request payload contains:
      | type | OnIdle |
    And if reusable state "EnergyTransferStarted" was established, the "Reset" response status is "Scheduled"
    And every "TransactionEvent" request is answered
