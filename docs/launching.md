# Launching routine

## Prepare
### Prepare Pool Jetton contract
Choose Pool Jetton smartcontract. If you are not using standard one, check that it
- supports minting interface
- requires minimal `burn_notification` amount that fits Pool's `WITHDRAWAL_FEE` amount
- wallet address calculation used for determining payout jetton wallet succeed

Choose Pool Jetton metadata

### Choose common constants
- `GOVERNOR_QUARANTINE` - governor update is two-step "prepare-and-execute" process, `GOVERNOR_QUARANTINE` controls minimal duration of 'prepare' phase
- `SUDOER_QUARANTINE` - after setting sudoer it can not execute sudo requests immediately, instead it need to wait `SUDOER_QUARANTINE` period

### Prepare Controller contract
Choose appropriate constants:
- `MIN_STAKE_TO_SEND` minimal stake with which controller can try to participate in election
- `GRACE_PERIOD` Time in seconds for validator to make mandatory actions, such as recover stake or update hash
- `HASH_UPDATE_FINE` - fine for validator for overdue hash update (when it is done by third-party)
- `STAKE_RECOVER_FINE` - fine for validator for overdue stake recover (when it is done by third-party)

### Prepare Pool contract
Choose appropriate constants:
- `disbalance_tolerance` - parameter of how much total credit in round may differ from half of the funds
- `SERVICE_NOTIFICATION_AMOUNT` - TON amount which is used to notify interest manager about events
- `FINALIZE_ROUND_FEE` - TON amount which is reserved for round finalization: should include gas fees, notifications, payout distributions
- `DEPOSIT_FEE` - part of incoming deposit which is reserved for gas. Excesses of the sum will be sent back to user. Note this fee should cover possible round rotation.
- `WITHDRAWAL_FEE` - minimal incoming withdrwal request TON amount. Note, should be less then minimal `burn_notification` in Pool jetton
- `TRANSFER_NOTIFICATION_AMOUNT` - amount of TON used for pool jetton `transfer_notification`
- `MAX_POOL_GAS_ON_USER_ACTION` - should be higher than maximal possible gas usage on any user action (including possible round rotation). Leave as is if no changes to pool

Choose appropriate initial pool parameters, check `wrappers/Pool.ts:PoolFullConfig`, that includes roles (Governance, Interest Manager, etc) addresses, deposit modes, pool jetton address.
It is recommended to start with empty(`addr_none`) sudoer.

## Deploy

1. Deploy Pool Jetton with some `temporary_admin` as owner
2. Deploy Pool.
3. Use `temporary_admin` to pass ownership of Pool Jetton to Pool
4. Deposit some TON to pool
5. To prevent initial Pool Jetton/TON skew donate `FINALIZE_ROUND_FEE`: note that each round this amount will be deducted from accounted TON amount, thus if initial deposit is comparable with `FINALIZE_ROUND_FEE` ratio could fluctuate well below 1. It is recommended to use initial deposits of order 10'000x of `FINALIZE_ROUND_FEE`
