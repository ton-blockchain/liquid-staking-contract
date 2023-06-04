# WIP
# Pool

## Storage

- `state`
- `total_balance` - amount of TONs accounted when deposit, withdraw and profit
- `interest_rate` - surplus of credit that should be returned with credit body. Set as integer equal share of credit volume times 65536
- `current_round_borrowers` - Current _round\_data_
  * `borrowers` - dict of borrowers: `controller_address -> borrowed_amount`
  * `round_id`
  * `active_borrowers` - number of borrowers that didn't return loan yet
  * `borrowed` - amount of borrowed TON (no interest)
  * `expected` - amount of TON expected to be returned (`borrowed + interest`)
  * `returned` - amount of already returned TON
  * `profit` - currently obtained profit (at the end of the round should be equal to `returned-borrowed` and `expected-borrowed`)
- `prev_round_borrowers` - Previous _round\_data_
  * `borrowers` - dict of borrowers: `controller_address -> borrowed_amount`
  * `round_id`
  * `active_borrowers` - number of borrowers that didn't return loan yet
  * `borrowed` - amount of borrowed TON (no interest)
  * `expected` - amount of TON expected to be returned (`borrowed + interest`)
  * `returned` - amount of already returned TON
  * `profit` - currently obtained profit (at the end of the round should be equal to `returned-borrowed` and `expected-borrowed`)
- `min_loan_per_validator` - minimal loan volume per validator
- `max_loan_per_validator` - maximal loan volume per validator
- `governance_fee` - share of profit sent to governance

- **Minters Data**
  * pool jetton jetton minter address
  * pool jetton supply
  * Deposit Payout (minter) address
  * Deposit Payout supply == number of deposited TON in this round
  * Withdrawal Payout (minter) address
  * Withdrawal Payout supply == number of burned pool jettons in this round

- **Roles** addresses
  * sudoer
  * governance
  * interest manager
  * halter
  * consigliere
  * approver

- **Codes** - code of child contracts needed either for deploy or for address authorization
  * `controller_code` - needed for controller authorization
  * `awaited_jetton_wallet_code` - needed for awaited*TON deployment
  * `payout_minter_code` - needed for awaited*TON deployment
  * `pool_jetton_wallet_code` - needed for calculation of address of Deposit Payout wallet
  * `vote_keeper_code` - needed for calculation of address of Deposit Payout wallet

## Deploy

Pool and pool jetton minter are deployed separately. Pool deploys Payout minters and initiate it. Address of pool jetton wallet for Deposit Payout (minter) is calculated on Pool and passed to Deposit Payout in init message.

![scheme](images/pool-scheme.png)
