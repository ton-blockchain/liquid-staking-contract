This documentation is organised as follows:
- short description
- list of all components (each component is isolated in separate contract)
- list of all component-to-component interfaces
- list of all multicomponent execution paths

## Description
### Terms
- elector: smart-contract which accepts stakes, conduct election, decides next active validator keys and distribute reward for validation
- validator-controller: smart-contract which manage funds for stake 
- validator: actor which running TON node and (try to) participate in elections, and if elected validate new blocks. It knows it's private validator key and also "partially" control it's own validator-controller (can send and receive stakes, but can not withdraw all money for itself)
- nominator: actor who have assets (TON) and want to lend them to validators through JettonPool to get interest on it
- jettons: TEP-74+TEP-89 Jettons : scalable tokens on TON blockchain

### Scheme

![scheme](scheme.png)

**Validators** participate in elections via **validation-controller** which

1. Requests funds from Validation Pool through **Validator approval**
2. accept and account funds from validation pool and validators
3. ensures that assets lended to validators can not be withdrawn
4. sends stake plus agreed on lending interest after validation round to validation pool

**Validation Pool** 
1. Lends assets to validator-controllers upon borrow request from **Validator-controller** in accordance to *Current Rate*
2. Receives assets and aggregates profit/loss information from **validator-controllers**
3. Manages funds from Profit Pool
4. Notify Profit Pool about aggregated data
5. Update *Current Rate* in accordance to *Desired Utilization*.

**Profit Pool** manages deposits, withdrawals and stepwise update pTON/TON ratio.

**pTON** is jetton which is used to manage assets lended to the pool. There are also additional types of jettons: awaitedpTON and awaitedTON. These jettons are used for accounting during postponement of deposits/withdrawals till the moment when pTON/TON price is known. 

**Stopcock**
1. Halts all parts of the system if necessary.


**Governance** 
1. send approval requests to **Validator-controllers**
2. set *Current Rate* and *Desired Utilization* parameters in **Validation pool**
3. Assign Stopcock.
4. Transfer governance right to another contract.
5. Upgrade code. It is the last resort emergency mechanisms for exploits which can not be fixed other way.

**Governance** itself may be a wallet, multisignature wallet or DAO, it can be decided later through governance transfer. It is expected that in final revision Governance will be jetton-based DAO with it's owng GJ: governance jetton.



## Components
### Validator-controller
Validator-controller accounts funds of validator and funds lended from Validation Pool. It can process deposits from Validator and from Validation Pool (later Pool).
Upon request from validator it can send stake from it's balance to Elector. Upon request from Validator OR Pool, it can requests withdrawal from Elector, but only after at least three updated of validator sets ([here](https://github.com/ton-blockchain/nominator-pool/blob/main/func/pool.fc#L566) is why it is necessary for correct stake account). Thus Validator Controller need ability to "count" validator sets updates, for that purpose anybody can send "check if changed" request. This logic may change in the future if elector will be upgraded.

Ability of Validation Pool to request withdrawal from Elector protects against non-responding validator. 

Validator-controler specify maximal interest rate, minimal and maximal TON credit size in borrow request. Validator can only request such parameters that it has interest plus recommended fine on it's balance. It can only request funds if is approved by governance.

Upon receiving stake from Elector, validator-controller sends lended assets plus interest to the Validation pool.

Handlers of incoming messages
- deposit (only from Pool)
- count validator set update (from Pool, Validator) **TODO:** mechanics for watchdogs: actors who earn on monitoring of misbehaving validators
- demand to request stake from Elector (from Pool and Validator)
- deposit Validator (only from Validator)
- withdraw Validator (only from Validator)
- demand to send stake to Elector (only from Validator)
- stake from Elector (only from Elector)
- approve/disapprove (from Governance)
bounces
- bounce of sent stake to Elector (only from Elector)

Outcoming messages:
- new_stake (to Elector)
- request state (to Elector)
- Debt repayment (to Pool)
- Validator withdrawal (to Validator)

[Detailed docs on Validator controler](validator-controller)

**TODO:** What if Validator-controller doesn't have enough assets to repay debt after stake recovery? We have two options:
1. automatically send all validator-controller has (automatic but more risky)
2. halt validator-controller, and expect that Governance will "manually" decide what to do, for instance wait till validator replenish controller or withdraw everything depending on conditions. (manual, but more flexible)

### Validation Pool
Validation pool receives deposit and withdraw requests from Profit Pool (PP below). If there is enough TON on Validation Pool it immediately send those. 

Manages *Current Rate*: interest rate of lending. It increase/decrease rate if *Utilization rate* is not matched.

Process lending requests from Validator Approvals: send funds if there are enough funds and request matches rate and limits. Saves to *active controller list* (it is expected that there will be hundreds of those)

Receives debt repayment from validator-controlers: remove tham from *active controller list*

Account for fees: send governance fee to governance? **TODO**


Handlers of incoming messages
- deposit (only from PP)
- request withdrawal (only from PP)
- borrow request (only from Validator-controller)
- change Operator (from Governance)
- change pool params: controller code, fees, governance, stopcock, god (from Governance)
- debt repayment (only from Controller in *active controller list*)
- stop/resume operation (from Stopcock)
bounces
- TODO

Outcoming messages:
- PP withdrawal (to PP)
- deposit to controller (to Controller, insert into _active controller list_)
- aggregated profit notification (to PP)
- Fees to Governance (???)

### Profit pool
Profit pool implements Pool Jetton minter functionality: mints pTON, but not direcly to users, instead it will be distributed through awaited pTON.

Keep track of ratio of pTON/TON.

Receives deposits from nominators and mints *awaited pTON* for them. Immediately deposits assets to Validation Pool.

Receives pTON burns notifications (withdrawal requests) from nominators' wallets and mints *awaited TON* for them, requests withdrawals from Validation Pool.

Keep track of summs of **current round** awaited jettons.

Receives aggregated profit notifications and withdrawal, discover new actual pTON/TON ratio.

Immediately mints pTON to *awaited pTON* minter for distribution (in accorance to new ratio).

Also, in accordance to new ration, sends TONs to *awaited TON* minter either immediately (if there are enough TONs) or later upon request to fulfill withdrawals (and when TON from round cames to PP). **TODO: can we eliminate situation when there is not enough TON for withdrawal**

Distribution of pTON and TON happens on *awaited pTON* and *awaited TON* minters (separate minter for each round) upon burning *awaited pTON* and *awaited TON* jettons.


Handlers of incoming messages
- deposits (from any user)
- burn notifications (from pTON wallets)
- aggregation profit notification + withdrawal (from Validator Pool)
Outcoming messages:
- deposit (to Validator Pool)
- withdraw (to Validator Pool)
- mint pTON (to awaited pTON)
- TONs (to awaited TON)

### Governance:


Expected outcoming messages:
- Approve controler
- Set validation params


## TODO:
1) More info on emergency mechanisms - stops, upgrades
2) Separation Approvals from Governance
3) What is the best way of deploying Validator-controllers (it is ok to redeploy them on each update of Governance/StopCock addresses?)

## Paths
**WIP**
Here we list flow paths which "touch" many contracts in one chain of transactions.
Where it doesn't put too much trust on Operator, it is preferred to substitute long chains with shorter one.

1. Deposit: nominator --(deposit)--> Profit Pool -< 
     1. --(mint awaitedPJ)--> awaitedPJ minter --> awaitedPJ wallet
     2. --(deposit) --> Validator Pool
2. Withdrawal: nominator --(burn)--> PJ wallet --> Profit Pool -<
       1. --(mint awaitedTON)--> awaitedTON minter --> awaitedPJ wallet
       2. --(withdraw) --> Validator Pool (if there is enough TON --> Profit Pool)
3. Elector stake return: validator/validator pool --> validator controller --> Elector -(stake)-> validator controller -(profit notification)-> validator pool
