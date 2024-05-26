# 2024.06 update
## Audit report
Fixes related to Audit report: no critical fixes that require immediate pool upgrade
## credit_start_prior_elections_end
Pool: New parameters and logic
- `credit_start_prior_elections_end` Forbid Pool to give credits too early prior elections end, so there is prolonged period when Pool have funds returned from previous round and can withdraw large amounts of TON instantly
- `disbalanceTolerance` Now it is not hardcoded parameter, but can be set by governance
## SudoerExecutor
Introduction of helper SudoerExecutor contract: contract that can be set as Sudoer and can only be used once to Execute specific action (for instance update contract). Not used now.
## Safer send_msg_builder
Use try/catch instead of counting bits
https://github.com/ton-blockchain/liquid-staking-contract/commit/ac62d580abb65a125a3dc6c06926a1b0dac1134e
## Introduce Instant Withdrawal Fee
Pool: Introduce fee for instant swap pool-jettons for TON. This fee is deducted from withdrawal (if it can be done immediately) and accrued in special variable inside pool state. Later it is added to governance fee on round finalization and sent. It can be set by governance.
## Halter can close deposits/optimistic
Pool: Halter can close (but can not open) deposits and optimistic deposits/withdrawals. So role of Halter is changed from just halting to various actions for risk reduction if something goes wrong.
## Allocation and time restrictions for controllers
Controller: introduce allocation and time restrictions for controllers. Now controller can not ask credit higher than allocation and can not ask credit too early.
New parameters, set by Approver are introduced:
- `allocation` - maximal amount of credit that can be asked by controller. Default is 0, that is no limits
- `allowed_borrow_start_prior_elections_end` - minimal time before elections end when controller can ask credit. Default is 65536.

That way Approver may structure credit requests, in particular, guarantee some controllers a priority time to ask credit.
## Treasury
Pool: A new role for collecting fees from Pool (instead of InterestManager). It is set by governance and can be changed by governance.
## get_conversion_rate_unsafe method
Pool: Introduced new onchain method to get current conversion rate. Method called unsafe because data may change till response reach requester
## Revenue share model
In addition to static interest on credits additional revenue share is introduced.

Approve can set `approver_set_profit_share` while controller is in REST state.
Controller during credit request set `acceptable_profit_share` (that should be higher or equal than `approver_set_profit_share`).
Upon stake recovering from elector, Controller check what is higher static interest on credit body or revenue share and result is sent back to Pool.
This way in case of drastic increase of staking profitability it will be shared with Pool (stakers).

Note! Revenue share profits can not be predicted by pool and thus are not included into expected rate at the round end calculations.
It means that if revenue share mechanism is active in the round, stakers that staked during round will get more Pool Jettons than expected.
In other words additional profit will be distributed over all stakers: new and old, and not only to those who staked earlier and whose funds were used during round.

That means that it is highly not recommended to make such settings that expected revenue share is higher than static interest payments.
In particular, it is NOT RECOMMENDED to set `interest_rate` to zero and rely on revenue share only.
## Withdrawal to response address
Do not ignore response address, instead check if it is valid and send withdrawal there
