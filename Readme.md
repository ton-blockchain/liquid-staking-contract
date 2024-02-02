# Liquid staking pool

Liquid Staking (LSt) is a protocol that connects TON holders of all caliber
with hardware node operators to participate in TON Blockchain validation through assets pooling.

TON holders aka _Nominators_ put funds to the pool and get Pool Jettons which can be used in any DeFi protocol.
Those Jettons represent share of the pool and increase in TON value by accruing validation rewards.

Node operators can work for pool by using it's funds as validation stake and share validation reward.

**More info in [documentation](https://ton-ls-protocol.gitbook.io/ton-liquid-staking-protocol/).**

## Work with code

-   Clone repo with all submodules: `git clone --recurse-submodules <git-url>`
-   Install dependencies (you need Node v18+): `npm install`
-   Build all contracts: `npx blueprint build --all`
-   Run tests: `npm test -- tests/*.ts` (standard `npx blueprint test` won't work correctly due to tests in submodules. To run those change dir to submodule and run tests from there)
-   Run deploy script (carefully read it and check that it does what you want): `npx blueprint run`

## Technical description

### Terms

-   elector: smart-contract which accepts stakes, conduct election, decides next active validator keys and distribute reward for validation
-   Сontroller: smart-contract which manage funds for stake
-   validator: actor which running TON node and (try to) participate in elections, and if elected validate new blocks. It knows it's private validator key and also "partially" control it's own Сontroller (can send and receive stakes, but can not withdraw all money for itself)
-   nominator: actor who have assets (TON) and want to lend them to validators through JettonPool to get interest on it
-   jettons: TEP-74+TEP-89 Jettons : scalable tokens on TON blockchain

### Scheme

![scheme](docs/images/scheme.png)

**Validators** participate in elections via **Сontroller** which

1. Requests funds from Validation Pool after getting **Validator approval**
2. accepts and accounts funds from validation pool and validators
3. ensures that assets lended to validators can not be withdrawn
4. sends stake plus agreed on lending interest after validation round to validation pool

**Pool** Central contract:

-   Interact with controllers
    1. Lends assets to Сontrollers upon borrow request from **Сontroller** in accordance to _Current Rate_
    2. Receives assets and aggregates profit/loss information from **Сontrollers**
-   Interaction with stakers 3. manages deposits and withdrawals
-   Interact with Interest Manager: 4. sends aggregate lending round statistics 5. updates interest upon request from Interest Manager
-   Interact with Governor: 6. sends profits share 7. updates parameters upon request: deposit params (open?, optimistic?), roles (halter, sudoer, interest_manager, governor), state (unhalt).

**pool jetton** is jetton which is used to manage assets lended to the pool. It also has DAO voting capabilities to be used for voting for network config parameters.

**Deposits/Withdrawals**: pool jetton/TON ratio is updated once per round. In strict mode, we assume that this ratio is not known till the end of the round and thus actual deposits/withdrawals should be postponed till the end of the round. Besides, even in optimistic mode (when deposits/withdrawals are processed through projected ratio), withdrawals often can not be made if pool has no enough TON. Thus **Deposits/Withdrawals** are special contracts which represent deposit/withdrawals in process. Can be implemented as NFT or Jettons so all wallets will be able to interact with it.

#### Roles

**Halter**
Halts all parts of the system if necessary.

**Sudoer**
Empty by default role, which is able to send arbitrary message from arbitrary part of the system. Sudoer only become active if set more than _sudoer_threshold_ seconds ago (expected to be 24h). Can upgrade code and directly update data.

**Approver**
Role to approve Controllers for borrow requests

**Interest Manager**
Get round stats and update interest params

**Governor**

1. set other roles in **Pool**, **Controller**, **Minters**
2. set some parameters (governance fee) in **Pool**

Each role may be performed by a wallet, multisignature wallet or DAO. It is expected that in final revision:

-   _Halter_ will be a hot wallet which scan blockchain and halts everything in case of unexpected behavior
-   _Approver_ will be either cold wallet or combined with the _Governance_
-   _Interest Manager_ will be a smart contract which implements some equilibria logic
-   _Governance_ will be jetton-based DAO with it's owng GJ: governance jetton. Optionally, filter of outcoming messages can be added that resticts setting sudoer and othe parameters.

## Optimistic deposits/withdrawals

By default, it is assumed that the jetton/TON ratio in the pool is unpredictable, since validators can be slashed. Therefore, it is impossible to say with 100% certainty how much the pool balance will change at the end of the round.

If the ratio can indeed fluctuate in both directions (both increase and decrease), then we need to postpone all deposits and withdrawals and process them immediately at the end of the round. Otherwise, if someone knows, for example, that the pool validators will be severely slashed and withdraws funds before that happens, they would avoid loss by distributing it to other holders.

However, since the protocol ensures that validators have enough funds to pay expected fines, and the credit interest is agreed upon during loan granting, the amount of returned TON at the end of the round is usually determined under normal conditions. As a result, it's possible to calculate the projected pool jetton/TON ratio.

Given this, it is feasible to process deposits and withdrawals in an _optimistic_ mode: deposits should be converted to pool jettons based on the projected ratio at the end of the round, and withdrawals should be converted to TON based on the current ratio (as if these funds are not participating in the round). This optimistic mode should be activated only if there are measures in place to protect against attempts at validator cheating; for instance, if the validator fully discloses their identity.

### Fill or Kill and Immediate withdrawals

If _optimistic_ mode is activated, withdrawals often still cannot be processed immediately if the pool does not have enough TONs. In this case, a withdrawal bill should be minted, which may not be optimal for the nominator. At the same time, the nominator may sometimes want to wait until the end of the round to reap the profits of that round, even if _optimistic_ mode is on.

To control this behavior, there are two flags in the burn requests:

-   `wait_till_round_end`: If set to `true`, a withdrawal bill will be minted regardless of the possibility for immediate withdrawal.
-   `fill_or_kill`: If set to `true` and there are not enough TONs, the burn will be reverted by minting pool jettons back.

## Components

### Сontroller

The Controller manages both the funds of the validator and the funds borrowed from the Validation Pool. It can process deposits from both the Validator and the Validation Pool (referred to as 'Pool' hereafter). Upon request from the validator, it can send stakes from its balance to the Elector. It can also request withdrawals from the Elector, but only after at least three updates of the validator sets (see [here](https://github.com/ton-blockchain/nominator-pool/blob/main/func/pool.fc#L566) for why this is necessary for correct stake accounting). For this purpose, the Controller has an `update_set_hash` request feature.

Both withdrawal and `update_set_hash` requests can be sent by the validator or, after a grace period, by anyone. In the latter case, the sender receives a bounty from the validator's funds. This functionality protects against a non-responding validator.

The Validator-Controller specifies the maximum interest rate, and the minimum and maximum TON credit size in the borrow request. The Validator can only request such parameters if its balance covers both the interest and the recommended fine. It can only request funds if approved by the Approver.

Upon receiving stakes from the Elector, the Controller sends the borrowed assets plus interest back to the Validation Pool.

#### Handlers of Incoming Messages

-   Deposit (only from the Pool)
-   Count validator set update (from Validator or anyone after grace period)
-   Demand to request stake from Elector (from Validator or anyone after grace period)
-   Deposit from Validator (only from Validator)
-   Withdraw from Validator (only from Validator)
-   Demand to send stake to Elector (only from Validator)
-   Stake from Elector (only from Elector)
-   Governance requests (from Governance, Halter, Sudoer)
-   Approve/Disapprove (from Approver)
-   Bounce of sent stake to Elector (only from Elector)

#### Outgoing Messages:

-   New stake (to Elector)
-   Request state (to Elector)
-   Borrowing request (to Pool)
-   Debt repayment (to Pool)
-   Validator withdrawal (to Validator)

[Detailed docs on Validator Controller](docs/controller.md)

If the Controller doesn't have enough assets to repay the debt after stake recovery, it should halt operations and expect that Governance will "manually" decide what to do. For instance, Governance may wait until the validator replenishes the Controller's funds or withdraws everything, depending on the conditions.

### Pool

#### Controller Part

Processes lending requests from Validator Approvals: sends funds if there are sufficient funds and if the request fits the rate and limits. Adds to the _active controller list_ (it is expected that there will be no more than hundreds of these).

Receives debt repayments from validator-controllers: removes them from the _active controller list_.

Accounts for fees: sends governance fees to Governance.

Aggregates profit/loss data for each round and the ratio of pool jetton/TON; sends stats to the Interest Manager.

#### User Part

Keeps track of the ratio of pool jetton/TON.

Receives deposits from nominators and mints _Deposit/pool jetton_ for them.

Receives pool jetton burn notifications (withdrawal requests) from nominators' wallets and mints _Withdrawal/TON_ for them or reverts the burn.

Keeps track of the sums of **current round** payouts (Withdrawals/Deposits).

On aggregation event (end of lending round):

-   Mints pool jetton for the _Deposit Payout_ minter for distribution.
-   Sends TONs to the _Withdrawal Payout_ minter to fulfill withdrawals.

#### Handlers of Incoming Messages

-   Borrow request (only from Controller)
-   Governance requests (from Governance, Halter, Sudoer)
-   Debt repayment (only from Controller in _active controller list_)
-   Deposits (from any user)
-   Burn notifications (from pool jetton wallets)
-   Bounces
-   TODO

#### Outgoing Messages:

-   Deposit to Controller (to Controller, insert into _active controller list_)
-   Aggregated profit notification (to Interest Manager)
-   Fees to Governance
-   Mint pool jetton (to Deposit Payout and nominator)
-   TONs (to Withdrawal Payout and nominator)

[Detailed docs on Pool](docs/pool.md)

### Pool Jetton

A jetton that represents a share in pool assets. It can be implemented as a DAO Jetton in such a way that owners of the pool jetton will be able to vote for network config updates.

### Payouts

Postponed until the end of the round, deposits/withdrawals can be represented on-chain in different forms. The two main approaches are to use Jettons and NFTs.

### Payout NFT

In this scheme, the Payout is an NFT collection and the "conversion obligation" is an NFT. Each round, new payout collections for deposit and withdrawal are created.

When you deposit TON into the pool, you immediately get a Deposit Bill. Later, after the current validation round ends and funds are released from the Elector, the correct pool jetton/TON ratio is discovered. The amount of pool jetton corresponding to the total deposit value is calculated and sent to the Deposit Collection. The Deposit Collection then sends a _burn request_ to the last minted NFT, triggering the conversion of that NFT and simultaneously sending a _burn request_ to the NFT before it. Here, the idea that NFTs are a linked list is used to iterate through the entire collection.

This implementation allows processed deposits/withdrawals to be sent to other users as a whole and enables auto-conversion to assets when ready. **In the current implementation, this is the main mechanism used.**
