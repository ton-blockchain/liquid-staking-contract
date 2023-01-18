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
Validators participate in elections via validation-controllers which a) accept and account funds from validation pool and validators, b) ensures that assets lended to validators can not be withdrawn, c) notify validation pool about profits and losses. Validation Pool deploy new validator-controllers (upon request from validators), distributes and revokes money to validator-controllers as Operator decides, aggregates profit/loss information from validator-controllers and notify Profit Pool about aggregated data. Profit Pool manages deposits, withdrawals and stepwise update ratio of PoolJetton to TON. PoolJetton is jetton which is used to manage assets lended to the pool. There are also additional types of jettons: awaitedPJ and awaitedTON. These jettons are used for accounting during postponement of deposits/withdrawals till the moment when TON/PJ price is known. Operator controls lending of assets to validators according to it's internal risk/reward model. Governance control parameters of the system (how much profit goes to operator, nominators, minimal and maximal allowed parameters of validator-controllers). Governance itself may be a wallet, multisignature wallet or DAO. It is expected that in final revision Governance will be jetton-based DAO with it's owng GJ: governance jetton.


![scheme](scheme.png)

## Components
### Validator-controller
Validator-controller has and accounts funds of validator and funds lended from Validation Pool. It can process deposits from Validator and from Validation Pool (later Pool).
Upon request from validator it can send stake from it's balance to Elector. Upon request from Validator OR Pool, it can requests withdrawal from Elector, but only after at least three updated of validator sets ([here](https://github.com/ton-blockchain/nominator-pool/blob/main/func/pool.fc#L566) is why it is necessary for correct stake account). Thus Validator Controller need ability to "count" validator sets updates, for that purpose anybody can send "check if changed" request. Ability of Validation Pool to request withdrawal from Elector protect against non-responsing validator. 
Pool may request partial withdrawal of it's funds from validator-controller, the funds will be witheld on the balance after stake return from Elector (so validator can not use it for validation anymore), and after that can be withdrawn by additional request.
Upon receiving stake from Elector validator-controller calculates profits/losses from validation and update it's own and Pool balances. Note that profit are distributed in accordance to share, while losses first are covered from validator balance and only then from Pool balance. After all calculations done validator controller send "updates" to the Pool.
Handlers of incoming messages
- deposit (only from Pool)
- request to prepare withdrawal (only from Pool)
- withdraw Pool (only from Pool)
- count validator set update (from Pool and Validator)
- demand to request stake from Elector (from Pool and Validator)
- deposit Validator (only from Validator)
- withdraw Validator (only from Validator)
- demand to send stake to Elector (only from Validator)
- stake from Elector (only from Elector)
bounces
- bounce of sent stake to Elector (only from Elector)

Outcoming messages:
- new_stake (to Elector)
- request state (to Elector)
- Pool withdrawal (to Pool)
- Validator withdrawal (to Validator)
- Profit notification (to Pool)

[Detailed docs on Validator controler](validator-controller)

### Validation Pool
Validation pool receives deposit and withdraw requests from Profit Pool (PP below). If there is enough TON on Validation Pool it immediately send those. It receives requests from validator to deploy new validator controller and deploy it (however it doesn't store each controller address). Upon request from Operator it sends deposit and withdraw requests to validator controllers, as well as _validator-set-update_ requests and _demand-to-request-stake-from-validator_. Note that validator-controllers where Pool balance is non-zero are explicitly stored in _active controller list_ (it is expected that there will be hundreds of those). Pool change Operator address upon receiving request from Governance contract and notify about it Profit pool. Upon receiving withdrawals from controllers, Validation Pool checks whether it can make withdrawal to PP and if yes - do it immediately. Validation Pool receives profit notification from the controllers. Upon request from Operator it sends aggregated profit notification to PP.
Since there are two types of fees: Operator Fee and Governance Fee (both are set by governance), Validation Pool is able to withdraw those fees to Operator and Governance.

There is also a watchdog and "sudo" actors not mentioned in scheme. Watchdog is expected NOT to be null and have power to immediately cease any operations not related to Governance setting params. If any vulnerability will be discovered Watchdog can stop operation, while Governance decides what to do about it. In contrast "sudo" is EXPECTED TO BE NULL most of the time. It can only be set by Governance and it has ability to send arbitrary message from Pool and upgrade Pool code. It is the last resort emergency mechanisms for exploits which can not be fixed other way. By default "sudo" requests are postponed by at least 24 hours.

Handlers of incoming messages
- deposit (only from PP)
- request withdrawal (only from PP)
- request to deploy new validator-controller (from anybody)
- request to deposit assets to specific controller (only from Operator)
- request to prepare assets withdrawal from specific controller (only from Operator)
- request to withdraw assets from specific controller (only from Operator)
- request to send aggregated profit notification (from Operator)
- change Operator (from Governance)
- change pool params: controller code, fees, governance, watchdog, god (from Governance)
- withdrawal (only from Controller in active controller list)
- profit notifications (only from Controller in active controller list)
- withdraw operator fee (from Operator)
- withdraw governance fee (from Governance)
- stop/resume operation (from watchdog)
- schedule message/upgrade request (from sudo)
- realize scheduled request (from sudo)
bounces
- TODO

Outcoming messages:
- PP withdrawal (to PP)
- controller deployment
- deposit to controller (to Controller, insert into _active controller list_ if necessary)
- prepare withdrawal (to Controller from _active controller list_)
- withdraw (to Controller from _active controller list_)
- aggregation profit notification (to PP)
- update Operator notification (to PP)

### Profit pool
Profit pool implements Poll Jetton minter functionality.
Keep track of ratio of TON/PJ. Receives deposits from nominators and mints awaited PJ for them. Immediately deposits assets to Validation Pool. Receives PJ burns notifications (withdrawal requests) from nominators' wallets and mints awaited TON for them and requests withdrawals from Validation Pool. Keep track of summs of **current round** awaited jettons. Receives aggregated profit notifications and updated TON/PJ. Receives request round finalization from Operator, stores actual ratio of corresponding "awaited minters", immediately mints PJs to awaited PJ minter. TONs to awaited TON are either sent immediately (if there is enough TONs) or sent later upon request to fulfill withdrawals (and when TON from round cames to PP). Update operator upon receiving notification from Validation Pool.

There is also a watchdog and "sudo" actors not mentioned in scheme. Watchdog is expected NOT to be null and have power to immediately cease any operations not related to Governance setting params. If any vulnerability will be discovered Watchdog can stop operation, while Governance decides what to do about it. In contrast "sudo" is EXPECTED TO BE NULL most of the time. It can only be set by Governance and it has ability to send arbitrary message from Pool and upgrade Pool code. It is the last resort emergency mechanisms for exploits which can not be fixed other way. By default "sudo" requests are postponed by at least 24 hours.

Handlers of incoming messages
- deposits (from any user)
- burn notifications (from PJ wallets)
- aggregation profit notification (from Validator Pool)
- update Operator notification (from Validator Pool)
- witdrawal (from Validator Pool)
- round finalization request (from Operator)
- fullfill TON withdrawals (from Operator)
Outcoming messages:
- deposit (to Validator Pool)
- withdraw (to Validator Pool)

### Governance:
DAO-like system to reaching decisions in decentralised manner. Governance serves as jetton minter fo governance jettons (GJ). One jetton is one vote, some additional logic is introduced to ensure that one jetton voted only once (in short jettons have flavours - number of votes this jetton participated, upon mixing all jettons obtain latest flavour, while jetton-wallet owner may forbid to accept "more recent" jettons to not lose it's voting power). 
Decision is made in the form of outcoming messages, in other words GJ votes on Governance send specific message.
Any GJ owner may propose new message to send (some limits on minimal amout of GJ or fee for proposal creation may be introduced).
Handlers of incoming messages
- mint (from itself)
- create proposal (from GJ owner)
- vote for proposal (from GJ owner)
Outcoming messages:
any


## Paths
Here we list flow paths which "touch" many contracts in one chain of transactions.
Where it doesn't put too much trust on Operator, it is preferred to substitute long chains with shorter one.

1. Deposit: nominator --(deposit)--> Profit Pool -< 
     1. --(mint awaitedPJ)--> awaitedPJ minter --> awaitedPJ wallet
     2. --(deposit) --> Validator Pool
2. Withdrawal: nominator --(burn)--> PJ wallet --> Profit Pool -<
       1. --(mint awaitedTON)--> awaitedTON minter --> awaitedPJ wallet
       2. --(withdraw) --> Validator Pool (if there is enough TON --> Profit Pool)
3. Elector stake return: validator/validator pool --> validator controller --> Elector -(stake)-> validator controller -(profit notification)-> validator pool
