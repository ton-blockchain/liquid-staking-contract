# WIP
# Pool

## Storage

- `state`
- `total_balance` - amount of TONs accounted when deposit, withdraw and profit
- `interest_rate` - surplus of credit that should be returned with credit body. Set as integer equal share of credit volume times 65536
- `current_round_lenders` - Current _round\_data_
  * `lenders` - dict of lenders: `controller_address -> lended_amount`
  * `round_id`
  * `active_lenders` - number of lenders that didn't return loan yet
  * `lended` - amount of lended TON
  * `returned` - amount of returned TON
  * `profit` - currently obtained profit (at the end of the round should be equal to `returned`-`lended`)
- `prev_round_lenders` - Previous _round\_data_
  * `lenders` - dict of lenders: `controller_address -> lended_amount`
  * `round_id`
  * `active_lenders` - number of lenders that didn't return loan yet
  * `lended` - amount of lended TON
  * `returned` - amount of returned TON
  * `profit` - currently obtained profit (at the end of the round should be equal to `returned`-`lended`)
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
