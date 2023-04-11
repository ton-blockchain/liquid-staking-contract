# WIP
# Validator-controller

## Storage

1. Addresses (authorization for different actions)
  - validator address
  - validation pool address
  - stopcock address
  - sudoer address
  - approver address
  - approval
2. Round contol (when it is allowed to stake money)
  - `saved_validator_set_hash`
  - `validator_set_changes_count`
  - `validator_set_changes_time`
  - `stake_held_for`
3. Funds control
  - `borrowed_amount`
  - `borrowed_time`
- state


## Deploy

Validator deploys validator-controller, Approver approve it. If any address is changed (rotation of Governor for instance), validator need to deploy new validator-controller (since old one will not pass address based authentication).


## State
Validator controller can be in the following states:
- rest
- sent borrowing request
- sent stake request
- staked funds
- halted (by stopcock)

Additionally there is flag whether credit is active or not.

Controller may withdraw validator's funds only from "rest" state and `borrowed_amount=0`.

Controller can send borrowing request only from "rest" state.

When Controller receives response on borrowing request it returns to "rest" state. Note, that `borrowed_amount` and `borrowed_time` may be updated. `borrowed_time` only updates if it was `0`.

Controller can send stake request only from "rest" state and only if `now() - borrowed_time < elections_start_before`. In other words, funds can be borrowed only to participate in closest election.

When Controller receives response on stake request it either pass to "staked funds" or returns to "rest" state (depending on response).

If controller is in "rest" state, `borrowed_amount > 0` and `now() - borrowed_time > elections_start_before + 180`, it is possible to make force withdrawal to Validator Pool.
**TODO**: who makes force withdrawal? governance, pool?

Controller can send request to withdraw stake from elector only in "staked funds" state (**TODO** do we need this condition?)

If controller is in "staked funds" state, `borrowed_amount > 0` and `now() - validator_set_changes_time > stake_held_for + 180`, it is possible to trigger force withdrawal from Elector **TODO**

Upon receiving stake withdrawal from elector, if controller has enough funds it should automatically repay debt. If not, it pass to "halted" state.
