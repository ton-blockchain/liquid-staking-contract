# Pool

`slice get_current_round_deposit_payout();` - returns address of current round Deposit collection.

---
`slice get_current_round_withdrawal_payout();` - returns address of current round Deposit collection.

---
`(int, int, int, int, slice) get_finance_data()` - returns
 - `total_balance` of TONs accounted by the Pool
 - `supply` number of issued pool jettons
 - `requested_for_deposit` amount of TON of not yet processed deposits
 - `requested_for_withdrawal` amount of burned pool jettons of not yet processed withdrawals
 - `jetton_minter` address of pool jetton root

Current pool jetton/TON ratio is equal to `total_balance/supply`. This ratio is used for immediate withdrawals in *optimistic* mode.

---
`(int, int) get_projected_conversion_ratio ()`
 - `projected_total_balance` - amount of TON expected to be accounted by the Pool at the end of the round
 - `projected_supply` - number of issued pool jettons at the end of the round

Projected pool jetton/TON ratio is equal to `projected_total_balance/projected_supply`. This ratio is used for immediate deposits in *optimistic* mode.

---

`(slice) get_controller_address(int controller_id, slice validator)` - returns address of validator controller with given id and validator address. Note controller may be not yet deployed.

---
`(int, int) get_controller_address_legacy(int controller_id, int wc, int addr_hash)` - the same as previous but accepts parsed validator address and return parsed controller address

---
`(int, int, int, int, slice) get_pool_credit_params()` - return credit parameters of ther pool
 - `min_loan_per_validator` minimal credit per validator which pool can loan
 - `max_loan_per_validator` maximal credit per validator which pool can loan
 - `interest_rate` - interest rate **per round** encoded as 16 bit number. In other words, after borrowing X TON validator need to return `X*( 65536 + interest_rate) / 65536` TON
 - `governance_fee` - share of pool profit which is sent to governance encoded as 16 bit number.
 - `interest_manager` - address of interest manager - contract which controls interest rate
