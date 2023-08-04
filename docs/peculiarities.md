# Known peculiarities
This document contains a list of behavior peculiarities which are suboptimal but are in place for simplicity. They are not considered as bugs, but may be improved in the future.  
1. If `total_balance`/`supply` is less than `1e-8` or more than `1e8` rounding inaccuracies may lead to losses. For instance `total_balance=100TON` and `supply=10e-9` (100 indivisible units), deposit of 19TON will give user 1 indivisible jetton unit. In other words 9 TON will be distributed over all jetton holders. *Countermeasure* is to keep `total_balance`/`supply` around 1.
2. Optimistic withdrawals are based on `total_balance`/`supply` ratio. In particular, it doesn't account for `FINALIZE_ROUND_FEE`. When round profit less than `FINALIZE_ROUND_FEE` (usually that means that there are no working validators) losses (quite minor though) are socialized amidst jetton holders.
3. When `total_balance=0` and `supply>0` deposits won't work due to division by zero. It is expected behavior since jetton lost all value and there is no correct way to account deposits.
4. When `total_balance>0` and `supply=0` (that may happen due to donations to empty pool) Pool can not loan credits since can not calculate how much TON need to be reserved for withdrawal. *Countermeasure* is the correct protocol of launching: first deposit (it is better if deposit >10k) and then `FINALIZE_ROUND_FEE` donation
5. Governance fee is deducted from `total_balance` every round, regardless of whether or not it was actually sent to `interest_manager`. May happen when `governance_fee` is than `SERVICE_NOTIFICATION_AMOUNT`.
6. `NFT payout` may bounce transaction when handling start of the jetton distribution.  This bounce is not handled on `pTON minter` side, because it's not clear if we can really fix the situiation at this point. One of the possible options is to transfer those pTONs back to the governor wallet for later manual handling.
7. `donate` operation is allowed from arbitrary sender address, Thus anyone can increase `total_balance` at will. That may lead to yet undiscovered issues related to deposit/withdraw rate manipulation, or similar to **4**.