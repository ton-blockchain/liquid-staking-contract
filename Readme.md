This documentation is organised as follows:
- short description
- list of all components (each component is isolated in separate contract)
- list of all component-to-component interfaces
- list of all multicomponent execution paths

## Description
### Terms
- elector: smart-contract which accepts stakes, conduct election, decides next active validator keys and distribute reward for validation
- Сontroller: smart-contract which manage funds for stake 
- validator: actor which running TON node and (try to) participate in elections, and if elected validate new blocks. It knows it's private validator key and also "partially" control it's own Сontroller (can send and receive stakes, but can not withdraw all money for itself)
- nominator: actor who have assets (TON) and want to lend them to validators through JettonPool to get interest on it
- jettons: TEP-74+TEP-89 Jettons : scalable tokens on TON blockchain

### Scheme

![scheme](docs/images/scheme.png)

**Validators** participate in elections via **Сontroller** which

1. Requests funds from Validation Pool through **Validator approval**
2. accept and account funds from validation pool and validators
3. ensures that assets lended to validators can not be withdrawn
4. sends stake plus agreed on lending interest after validation round to validation pool

**Pool** Single contract with two roles
  - Interaction with controllers
    1. Lends assets to Сontrollers upon borrow request from **Сontroller** in accordance to *Current Rate*
    2. Receives assets and aggregates profit/loss information from **Сontrollers**
    3. Manages funds from Profit Pool
    4. Notify Profit Pool about aggregated data
    5. Update *Current Rate* in accordance to *Desired Utilization*.
  - Interaction with stakers
    6. manages deposits and withdrawals

**pool jetton** is jetton which is used to manage assets lended to the pool. There are also additional types of jettons: Deposits and Withdrawals. These jettons are used for accounting during postponement of deposits/withdrawals till the moment when pool jetton/TON price is known. 


#### Roles

**Halter**
Halts all parts of the system if necessary.

**Sudoer**
Empty by default role, which is able to send arbitrary message from arbitrary part of the system. Sudoer only become active if set more than *sudoer_threshold* seconds ago (expected to be 24h). Can upgrade code and directly update data.

**Approver**
Role to approve Controllers for lend requests

**Consigliere**
Helps to transform payouts to TON/pool jetton accordingly

**Interest Manager**
Get round stats and update interest params

**Governor** 
1. set other roles in **Pool**, **Controller**, **Minters**
2. set some parameters (governance fee) in **Pool**


Each role may be performed by a wallet, multisignature wallet or DAO. It is expected that in final revision:
- *Halter* will be a hot wallet which scan blockchain and halts everythin in case of unexpected behavior
- *Approver* will be either wallet or combined with the *Governance*
- *Consigliere* will be a hot wallet
- *Interest Manager* will be a smart contract which implements some equilibria logic
- *Governance* will be jetton-based DAO with it's owng GJ: governance jetton. Optionally, filter of outcoming messages can be added that resticts setting sudoer.



## Components
### Сontroller
Сontroller accounts funds of validator and funds lended from Validation Pool. It can process deposits from Validator and from Validation Pool (later Pool).
Upon request from validator it can send stake from it's balance to Elector. Upon request from Validator OR Pool, it can requests withdrawal from Elector, but only after at least three updated of validator sets ([here](https://github.com/ton-blockchain/nominator-pool/blob/main/func/pool.fc#L566) is why it is necessary for correct stake account). Thus Controller need ability to "count" validator sets updates, for that purpose anybody can send "check if changed" request. This logic may change in the future if elector will be upgraded.

Ability of Validation Pool to request withdrawal from Elector protects against non-responding validator. 

Validator-controler specify maximal interest rate, minimal and maximal TON credit size in borrow request. Validator can only request such parameters that it has interest plus recommended fine on it's balance. It can only request funds if is approved by governance.

Upon receiving stake from Elector, Сontroller sends lended assets plus interest to the Validation pool.

Handlers of incoming messages
- deposit (only from Pool)
- count validator set update (from Validator or anybody after grace period)
- demand to request stake from Elector (from Validator or anybody after grace period)
- deposit Validator (only from Validator)
- withdraw Validator (only from Validator)
- demand to send stake to Elector (only from Validator)
- stake from Elector (only from Elector)
- Governance requests (from Governance, Halter, Sudoer)
- approve/disapprove (from Approver)
bounces
- bounce of sent stake to Elector (only from Elector)

Outcoming messages:
- new_stake (to Elector)
- request state (to Elector)
- Borrowin request (to Pool)
- Debt repayment (to Pool)
- Validator withdrawal (to Validator)

[Detailed docs on Validator controler](docs/controller.md)

If Сontroller doesn't have enough assets to repay debt after stake recovery:
halt Сontroller, and expect that Governance will "manually" decide what to do, for instance wait till validator replenish Сontroller or withdraw everything depending on conditions.

### Pool

#### Controller part
Process lending requests from Validator Approvals: send funds if there are enough funds and request matches rate and limits. Saves to *active controller list* (it is expected that there will be hundreds of those).

Receives debt repayment from validator-controlers: remove them from *active controller list*

Account for fees: send governance fee to governance? **TODO**

Aggregate profit/loss data for each round


#### User part
Keep track of ratio of pool jetton/TON.

Receives deposits from nominators and mints *Deposit Payout jettons* for them.

Receives pool jetton burns notifications (withdrawal requests) from nominators' wallets and mints *Withdrawal Payout jettons* for them

Keep track of summs of **current round** payout jettons.

On aggregation event:
- mints pool jetton to *Deposit Payout* minter for distribution
- sends TONs to *Withdrawal Payout* minter to fulfill withdrawals (and when TON from round cames to PP)

Handlers of incoming messages
- borrow request (only from Сontroller)
- Governance requests (from Governance, Halter, Sudoer)
- debt repayment (only from Controller in *active controller list*)
- deposits (from any user)
- burn notifications (from pool jetton wallets)
bounces
- TODO

Outcoming messages:
- PP withdrawal (to PP)
- deposit to controller (to Controller, insert into _active controller list_)
- aggregated profit notification (to PP)
- Fees to Governance (???)
- mint pool jetton (to Deposit Payout)
- TONs (to Withdrawal Payout)

[Detailed docs on Pool](docs/pool.md)

### Pool jetton
Jetton that represents share in pool assets. It can be implemented as DAO Jetton in such a way that owners of pool jetton will be able to vote for network config updates.

### Payout jettons
During validation round TON deposited to the pool and used for validation stake are indeed at stake. That means that it is not clear how much TON will be returned back and to how much TON is equal 1 pool jetton. That is why it is impossible to correctly swap pool jetton to TON during the round, otherwise the following attacks are possible:
- put assets right before funds are released from Elector and withdraw them immediately after, thus get full premium without prolonged fund lock and even without fund working as a stake. It is essectially stealing of premium from fair stakers.
- constantly monitor validator behavior and in case of misbehavior witdraw funds right before funds are released and loss (due to fine) are accounted and pool jetton/TON decreased. It is essentially shifting losses to other users.

That is why conversion of TON->pool jetton (deposits) and pool jetton->TON (withdrawals) should be postponed and synchronized with validation round ending.

To allow request deposits/withdrawals at any time and to avoid storing all requests in one contract storage we are using special type of jettons which will be converted to desired assets on round end.

This jettons are called *Deposit payout* (or simply deposits, represents assets which will be converted to pool jetton) and *Withdrawal Payout* (or withdrawals, represents assets which will be converted to TON), correspondingly.

When you deposit TON to pool you immediately get Deposit jettons. Later after current validation round ends and funds are released from Elector, correct poolJetton/TON ratio is discovered, amount of pool jetton corresponded to total deposits value is calculated and sent to Deposit minter. After that Deposit jettons can be burned to retrieve pool jettons from minter. User may burn it herself, however, for convenience special *consigliere* role is introduced which have permissions to call burn from any payout jetton wallet. If successfull (that means if distribution is already started), user gets her pool jettons and *consigliere* reimbursement for fees. That way from user perspective, in a few hours after deposit she automatically gets pool jetton.

The same way withdrawals are processed.

Separate deposit and withdrawal payouts (that is different kind of jettons) are deployed per each round.
