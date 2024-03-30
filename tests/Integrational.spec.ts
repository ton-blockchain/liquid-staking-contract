import { Blockchain,BlockchainSnapshot, BlockchainTransaction, createShardAccount,internal,SandboxContract,SendMessageResult,SmartContractTransaction,TreasuryContract } from "@ton-community/sandbox";
import { Address, Cell, beginCell, toNano, Sender, Dictionary } from 'ton-core';
import { compile } from '@ton-community/blueprint';
import '@ton-community/test-utils';
import { keyPairFromSeed, getSecureRandomBytes, getSecureRandomWords, KeyPair } from 'ton-crypto';
import { JettonMinter as DAOJettonMinter, jettonContentToCell } from '../contracts/jetton_dao/wrappers/JettonMinter';
import { JettonWallet as DAOWallet } from '../wrappers/JettonWallet';
import { Pool, PoolConfig } from '../wrappers/Pool';
import { Controller, ControllerConfig, controllerConfigToCell } from '../wrappers/Controller';
import { Elector } from "../wrappers/Elector";
import { Config  } from "../wrappers/Config";
import { setConsigliere } from "../wrappers/PayoutMinter.compile";
import { Conf, ControllerState, Errors, Op } from "../PoolConstants";
import { PayoutCollection, Conf as NFTConf, Op as NFTOp } from "../wrappers/PayoutNFTCollection";
import { PayoutItem } from "../wrappers/PayoutNFTItem";
import { testJettonTransfer, buff2bigint, computedGeneric, getRandomTon, testControllerMeta, getExternals, testLog, testLogRepayment, testMintMsg, assertLog, muldivExtra, testJettonNotification, filterTransaction, findTransaction, testJettonBurnNotification, approximatelyEqual, Txiterator, executeTill, differentAddress, executeFrom } from "../utils";
import { ElectorTest } from "../wrappers/ElectorTest";
import { getElectionsConf, getStakeConf, getValidatorsConf, getVset, loadConfig, packStakeConf, packValidatorsConf } from "../wrappers/ValidatorUtils";
import { ConfigTest } from "../wrappers/ConfigTest";
import { computeMessageForwardFees, getMsgPrices } from "../fees";
import { getRandomInt, randomAddress } from "../contracts/jetton_dao/tests/utils";
import { PayoutCollectionConfig } from "../wrappers/PayoutNFTCollection";
import { flattenTransaction } from "@ton-community/test-utils";

type Validator = {
  wallet: SandboxContract<TreasuryContract>,
  keys: KeyPair
};
type MintChunk = {
    address: Address,
    item: Address,
    index: number,
    amount: bigint
}
type BillState = Awaited<ReturnType<PayoutCollection['getTotalBill']>>;

type DistributionComplete = {
    burnt: bigint,
    distributed: bigint,
}
type DistributionDelayed = MintChunk;
type DistributionResult = DistributionComplete | DistributionDelayed;

describe('Integrational tests', () => {
    let bc: Blockchain;
    let deployer:SandboxContract<TreasuryContract>;
    let snapStates:Map<string,BlockchainSnapshot>
    let controller_code:Cell;
    let config_code:Cell;
    let elector_code:Cell;
    let pool_code:Cell;
    let payout_minter_code:Cell;
    let payout_wallet_code:Cell;
    let dao_minter_code:Cell;
    let dao_wallet_code:Cell;
    let dao_voting_code:Cell;
    let dao_vote_keeper_code:Cell;
    let poolJetton: SandboxContract<DAOJettonMinter>;
    let pool:SandboxContract<Pool>;
    let controller:SandboxContract<Controller>;
    let validator:Validator;
    let validators: Validator[];
    let elector:SandboxContract<ElectorTest>;
    let config:SandboxContract<ConfigTest>;
    let poolConfig:PoolConfig;
    let initialState: BlockchainSnapshot;
    let sConf : ReturnType<typeof getStakeConf>;
    let vConf : ReturnType<typeof getValidatorsConf>;
    let eConf : ReturnType<typeof getElectionsConf>;
    let msgConf:ReturnType<typeof getMsgPrices>;
    let bcConf :ReturnType<typeof getMsgPrices>;
    let depositors: MintChunk[];

    let getContractData:(address: Address) => Promise<Cell>;
    let setContractData:(address: Address, data: Cell) => Promise<void>;
    let getContractBalance:(address: Address) => Promise<bigint>;
    let getNewController:(txs: BlockchainTransaction[]) => SandboxContract<Controller>;
    let getUserJetton:(address: Address | SandboxContract<TreasuryContract>) => Promise<SandboxContract<DAOWallet>>;
    let getUserJettonBalance:(address: Address | SandboxContract<TreasuryContract>) => Promise<bigint>;
    let loadSnapshot:(snap:string) => Promise<void>;
    let getCurTime:() => number;
    let getCreditable:() => Promise<bigint>;
    let updateConfig:() => Promise<Cell>;
    let announceElections:() => Promise<number>;
    let runElections:(profitable?: boolean) => Promise<void>;
    let waitNextRound:() => Promise<void>;
    let waitUnlock:(since: number) => void;
    let nextRound:(profitable?: boolean, count?: number, post?:() => Promise<void>) => Promise<void>;
    let compareBalance:(contractA: Address | SandboxContract<TreasuryContract>, contractB: Address | SandboxContract<TreasuryContract>, jetton?: boolean) => Promise<boolean>;
    let assertPoolJettonMint:(txs: BlockchainTransaction[],
                              amount: bigint,
                              dest: Address) => Promise<Address>;
    let assertRoundDeposit: (txs: BlockchainTransaction[],
                             depositors: MintChunk[],
                             supply:bigint,
                             balance:bigint,
                             minterAddr:Address) => Promise<DistributionComplete>;
    let assertRoundWithdraw: (txs: BlockchainTransaction[],
                              withdrawals: MintChunk[],
                              supply:bigint,
                              balance:bigint,
                              minterAddr:Address) => Promise<DistributionComplete>
    let assertBurn:(txs: BlockchainTransaction[],
                    items: MintChunk[],
                    minter: Address,
                    post?: (mint: MintChunk) => Promise<void>) => Promise<bigint>
    let assertRound:(txs: BlockchainTransaction[],
                     round:number,
                     depositers: MintChunk[],
                     withdrawals:  MintChunk[],
                     borrowed: bigint,
                     expected: bigint,
                     returned: bigint,
                     supply: bigint,
                     totalBalance: bigint,
                     depositMinter: Address | null,
                     withdrawMinter: Address | null,
                    ) => Promise<bigint>;
    let assertNewPayout:(txs: BlockchainTransaction[],
                         expectNew: boolean,
                         prevPayout: Address | null,
                         deposit: boolean) => Promise<SandboxContract<PayoutCollection>>;
    let assertPayoutMint:(txs: BlockchainTransaction[],
                          payout: SandboxContract<PayoutCollection>,
                          billBefore: BillState,
                          dest: Address,
                          amount: bigint, index: number) => Promise<MintChunk>
    let assertDeposit:(via: Sender,
                       amount: bigint,
                       index:number,
                       new_minter:boolean) => Promise<MintChunk>;
    let assertOptimisticDeposit:(via:Sender, amount:bigint, expected_profit:bigint) => Promise<bigint>;

    let assertWithdraw:(<T extends boolean, K extends boolean>(via: Sender,
                        amount:bigint,
                        optimistic: T,
                        fill_or_kill: K,
                        balance: bigint,
                        supply:  bigint,
                        index: number,
                        new_minter: boolean) => Promise<K extends true ? DistributionComplete : T extends false ? DistributionDelayed : DistributionResult>);

    let assertPoolBalanceNotChanged:(balance: bigint) => Promise<void>;
    let assertGetLoan:(controller: SandboxContract<Controller>, amount: bigint, exp_success: boolean, min_amount?:bigint) => Promise<SendMessageResult>;
    // let getLoanWithExpProfit:(controller: SandboxContract<Controller>, exp_profit: bigint) => Promise<bigint>;


    beforeAll(async () => {
        bc = await Blockchain.create();
        deployer = await bc.treasury('deployer', {workchain: -1, balance: toNano("1000000000")});
        controller_code = await compile('Controller');
        pool_code = await compile('Pool');
        await setConsigliere(deployer.address);
        payout_minter_code = await compile('PayoutNFTCollection');
        payout_wallet_code = await compile('PayoutWallet');
        dao_minter_code = await compile('DAOJettonMinter');
        const dao_wallet_code_raw = await compile('DAOJettonWallet');
        dao_vote_keeper_code = await compile('DAOVoteKeeper');
        dao_voting_code = await compile('DAOVoting');
        const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
        _libs.set(BigInt(`0x${dao_wallet_code_raw.hash().toString('hex')}`), dao_wallet_code_raw);
        const libs = beginCell().storeDictDirect(_libs).endCell();
        bc.libs = libs;
        let lib_prep = beginCell().storeUint(2,8).storeBuffer(dao_wallet_code_raw.hash()).endCell();
        dao_wallet_code = new Cell({ exotic:true, bits: lib_prep.bits, refs:lib_prep.refs});

        elector_code    = await compile('Elector');
        config_code     = await compile('Config');

        const confDict = loadConfig(bc.config);

        sConf = getStakeConf(confDict);
        vConf = getValidatorsConf(confDict);
        eConf = getElectionsConf(confDict);
        msgConf = getMsgPrices(bc.config, -1);
        bcConf  = getMsgPrices(bc.config, 0);


        validators = [];

        const validatorsCount   = 5;
        const validatorsWallets = await bc.createWallets(validatorsCount, {workchain: -1});

        validator = {
            wallet: await bc.treasury('validator', {workchain: -1}),
            keys: keyPairFromSeed(await getSecureRandomBytes(32))
        };

        for (let i = 0; i < validatorsCount; i++) {
            validators.push({
                wallet: validatorsWallets[i],
                keys: await keyPairFromSeed(await getSecureRandomBytes(32))
            });
        }

        // Downgrading elections requirements for performance and simplicity
        vConf.min_validators  = validatorsCount;
        sConf.min_total_stake = BigInt(validatorsCount) * sConf.min_stake;
        confDict.set(17, packStakeConf(sConf));
        confDict.set(16, packValidatorsConf(vConf));

        bc.setConfig(beginCell().storeDictDirect(confDict).endCell());

        const content   = jettonContentToCell({type:1,uri:"https://example.com/1.json"});
        poolJetton      =   bc.openContract(DAOJettonMinter.createFromConfig({
                                                  admin:deployer.address,
                                                  content,
                                                  voting_code:dao_voting_code,
                                                  },
                                                  dao_minter_code));
        poolConfig = {
              pool_jetton : poolJetton.address,
              pool_jetton_supply : 0n,
              optimistic_deposit_withdrawals: 0n,

              sudoer : deployer.address,
              governor : deployer.address,
              interest_manager : deployer.address,
              halter : deployer.address,
              approver : deployer.address,

              controller_code : controller_code,
              pool_jetton_wallet_code : dao_wallet_code,
              payout_minter_code : payout_minter_code,
              vote_keeper_code : dao_vote_keeper_code,
        };

        const electorAddress = Address.parse('Ef8zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM0vF');
        const configAddress  = Address.parse('Ef9VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVbxn');


        await bc.setShardAccount(electorAddress, createShardAccount({
          address: electorAddress,
          code: elector_code,
          data: ElectorTest.emptyState(buff2bigint(loadConfig(bc.config).get(34)!.hash())),
          balance: toNano('1000')
        }));
        elector = bc.openContract(ElectorTest.createFromAddress(electorAddress));

        await bc.setShardAccount(configAddress, createShardAccount({
          address: configAddress,
          code: config_code,
          data: ConfigTest.configState(bc.config),
          balance: toNano('1000')
        }));
        config = bc.openContract(ConfigTest.createFromAddress(configAddress));

        pool = bc.openContract(Pool.createFromConfig(poolConfig, pool_code));

        await pool.sendDeploy(deployer.getSender(),Conf.minStoragePool + toNano('1'));

        await poolJetton.sendDeploy(deployer.getSender(), toNano('1.05'));
        await poolJetton.sendChangeAdmin(deployer.getSender(), pool.address);

        loadSnapshot = async (name:string) => {
          const state = snapStates.get(name);
          if(!state)
            throw(Error(`Can't find state ${name}\nCheck tests execution order`));
          await bc.loadFrom(state);
        }

        snapStates = new Map<string, BlockchainSnapshot>();
        snapStates.set('initial', bc.snapshot());
        getContractData = async (address: Address) => {
          const smc = await bc.getContract(address);
          if(!smc.account.account)
            throw("Account not found")
          if(smc.account.account.storage.state.type != "active" )
            throw("Atempting to get data on inactive account");
          if(!smc.account.account.storage.state.state.data)
            throw("Data is not present");
          return smc.account.account.storage.state.state.data
        }
        setContractData = async (address, data) => {
            const smc = await bc.getContract(address);
            if(!smc.account.account)
              throw("Account not found")
            if(smc.account.account.storage.state.type != "active" )
              throw("Atempting to get data on inactive account");

            const newAccount = createShardAccount({
                address,
                code: smc.account.account.storage.state.state.code!,
                data,
                balance: smc.balance
            });
            await bc.setShardAccount(address, newAccount);
        }
        getContractBalance = async (address: Address) => {
            const smc = await bc.getContract(address);
            return smc.balance;
        };
        getUserJetton = async (contract) => {
            const walletAddr = contract instanceof Address ? contract : contract.address;
            return bc.openContract(
                DAOWallet.createFromAddress(
                    await poolJetton.getWalletAddress(walletAddr)
                )
            );
        }
        getNewController = (txs) => {
            const deployTx = findTransaction(txs, {
                from: pool.address,
                initCode: controller_code,
                deploy: true,
                success: true
            })!;
            expect(deployTx).not.toBeUndefined();
            const deployMsg = deployTx.inMessage!;
            if(deployMsg.info.type !== "internal")
                throw(Error("Internal expected"));
            return bc.openContract(Controller.createFromAddress(deployMsg.info.dest));;
        }
        getUserJettonBalance = async (contract) => {
            const walletAddr = contract instanceof Address ? contract : contract.address
            const walletSmc = await bc.getContract(walletAddr);
            // If not minted
            if(walletSmc.accountState === undefined) {
                return 0n;
            }

            const walletContract = bc.openContract(DAOWallet.createFromAddress(
                    await poolJetton.getWalletAddress(walletAddr)
            ));
            return await walletContract.getJettonBalance()
        }
        getCurTime = () => bc.now ?? Math.floor(Date.now() / 1000);
        getCreditable = async () => {
            const poolData = await pool.getFullData();
            const poolBalance = await getContractBalance(pool.address);
            const cred = poolBalance - muldivExtra(poolData.requestedForWithdrawal,
                                                   poolData.totalBalance,
                                                   poolData.supply) - Conf.minStoragePool;
            // console.log(`Pool balance:${poolBalance}`);
            // console.log(`Cred:${cred}`);
            const balanced = BigInt(256 + Conf.disbalanceTolerance) * poolData.totalBalance / 512n;
            // console.log(`Balanced:${balanced}`);
            return  cred < balanced ? cred : balanced;
        };
        updateConfig = async () => {
          // Loading data from config contract and setting as sandbox config
          const confData = await getContractData(configAddress);
          const confCell = confData.beginParse().preloadRef();
          bc.setConfig(confCell);
          return confCell;
        }

        waitNextRound = async () => {
          const nextVset = getVset(bc.config, 36);
          // Setting vset
          bc.now = getCurTime();
          if(bc.now < nextVset.utime_since)
            bc.now = nextVset.utime_since;

          await config.sendTickTock("tock");
          const newConf = await updateConfig();
          // Should change to the current vset
          const newVset = getVset(newConf, 34);
          expect(newVset).toEqual(nextVset);
          // Should trigger unfreeze if possible
          await elector.sendTickTock("tick");
        }
        waitUnlock = async (since:number) => {
            const unlockTime = since + eConf.stake_held_for + 61;
            if(getCurTime() < unlockTime)
                bc.now = unlockTime;
        }

        announceElections = async () => {
          const curVset = getVset(bc.config, 34);
          const curTime = getCurTime();
          const electBegin = curVset.utime_unitl - eConf.begin_before + 1;

          const prevElections = await elector.getActiveElectionId();

          if(curTime < electBegin) {
              bc.now = electBegin;
          }
          else if(prevElections != 0) {
              // Either not closed yet because of time or lack of stake
              return prevElections;
          }

          let curElections = prevElections;

          do {
              await elector.sendTickTock("tick");
              curElections = await elector.getActiveElectionId();
          } while(curElections == 0 || prevElections == curElections);

          return curElections;
        }

        runElections = async (profitable: boolean = true) => {

          await announceElections();

          if(profitable) {
            // Elector profits
            await bc.sendMessage(internal({
              from: new Address(-1, Buffer.alloc(32, 0)),
              to: elector.address,
              body: beginCell().endCell(),
              value: toNano('100000'),
            }));
          }

          let electState  = await elector.getParticipantListExtended();
          const partCount = electState.list.length;
          let curStake    = electState.total_stake;
          let stakeSize   = sConf.min_stake + toNano('1');
          let i           = 0;

          while(i < validators.length
                && (curStake < sConf.min_total_stake || i + partCount < vConf.min_validators)) {
            const validator = validators[i++];
            const hasStake  = await elector.getReturnedStake(validator.wallet.address);
            if(hasStake > 0n) {
                // Get stake back
                const rec = await elector.sendRecoverStake(validator.wallet.getSender());
                expect(rec.transactions).toHaveTransaction({
                    from: elector.address,
                    to: validator.wallet.address,
                    op: Op.elector.recover_stake_ok
                });
            }
            const res = await elector.sendNewStake(validator.wallet.getSender(),
                                                   stakeSize,
                                                   validator.wallet.address,
                                                   validator.keys.publicKey,
                                                   validator.keys.secretKey,
                                                   electState.elect_at);
            expect(res.transactions).toHaveTransaction({
              from: elector.address,
              to: validator.wallet.address,
              op: Op.elector.new_stake_ok
            });
            curStake += stakeSize;
          }

          // Skipping time till elections
          bc.now    = electState.elect_at;
          // Run elections
          const res = await elector.sendTickTock("tock");

          /*
           * TODO fix test-utils for non generic transactions
          expect(res.transactions).toHaveTransaction({
            from: elector.address,
            to: config.address
            ...
          });
          */
          electState = await elector.getParticipantListExtended();
          expect(electState.finished).toBe(true);
          // Updating active vset
          await elector.sendTickTock("tock");
        }

        nextRound = async (profitable: boolean = true, count:number = 1, post?:() => void) => {
            while(count--) {
                await runElections(profitable);
                await updateConfig();
                await waitNextRound();
                if(post) {
                    await post()
                }
            }
        };
        compareBalance = async (contractA, contractB, jetton: boolean = false) => {
            let cmp: boolean;
            let getBalance = async (contract: Address | SandboxContract<TreasuryContract>) => {
                let balance;
                if(jetton) {
                    balance = await getUserJettonBalance(contract);
                }
                else if(contract instanceof Address) {
                    balance = await getContractBalance(contract);
                }
                else {
                    balance = await contract.getBalance();
                }
                return balance;
            }
            const balanceA = await getBalance(contractA);
            const balanceB = await getBalance(contractB);
            return balanceA == balanceB;
        };
        assertPoolJettonMint = async(txs: BlockchainTransaction[],
                                     amount:bigint,
                                     dest:Address) => {

            const depositWallet = await poolJetton.getWalletAddress(dest);
            const mintTx = findTransaction(txs, {
                from: pool.address,
                to: poolJetton.address,
                op: Op.payout.mint,
                outMessagesCount: 1,
                body: (x) => testMintMsg(x!, {
                    dest,
                    amount,
                    notification: Conf.notificationAmount,
                    forward: 0n
                }),
                success: true
            });
            if(mintTx === undefined) {
            // No action phase failures
                //console.log(`Pool:${pool.address}`);
                //console.log(`Minter:${poolJetton.address}`);
                //console.log(txs.map(x => flattenTransaction(x)));
                expect(txs).not.toHaveTransaction({
                    actionResultCode: (x) => x! !== undefined && x! !== 0
                });
                throw(Error("No mint tx"));
            }
            expect(mintTx).not.toBeUndefined();
            const inMsg = mintTx!.inMessage!;
            // Meh
            if(inMsg.info.type !== "internal" )
                throw(Error("Internal expected"));

            const fwdFee = computeMessageForwardFees(msgConf, inMsg);
            const expValue = Conf.notificationAmount + Conf.distributionAmount;
            expect(inMsg.info.value.coins).toBeGreaterThanOrEqual(expValue
                                                                  - fwdFee.fees
                                                                  - fwdFee.remaining);

            // Transfer pool jettons to dest jetton wallet
            expect(txs).toHaveTransaction({
                from: poolJetton.address,
                to: depositWallet,
                op: Op.jetton.internal_transfer,
                body: (x) => testJettonTransfer(x!, {
                    amount
                }),
                success: true,
            });
            // Destination wallet receives transfer notification triggers distribution
            expect(txs).toHaveTransaction({
                from: depositWallet,
                to: dest,
                op: Op.jetton.transfer_notification,
                body: (x) => testJettonNotification(x!, {
                    from: null,// poolJetton.address,
                    amount,
                }),
                success: true
            });
            return depositWallet;
        }

        assertBurn = async (txs: BlockchainTransaction[],
                            mints: MintChunk[], minter: Address,
                            post?: (mint: MintChunk) => Promise<void>) => {
            // Filter burn related transactions
            const burnTxs = filterTransaction(txs, {
                op: (x) => x! == NFTOp.burn || x! == NFTOp.burn_notification,
            });
            expect(burnTxs.length).toBeGreaterThanOrEqual(2); // At least one burn and notification
            // Burning deposit jettons
            // console.log("Mints:", mints);
            let burnTotal = 0n;
            for (let i = 0; i < mints.length; i++) {
                const burnSource = i == 0 ? minter : mints[mints.length - i].item
                expect(burnTxs).toHaveTransaction({
                    from: burnSource,
                    to: mints[mints.length - i - 1].item,
                    op: NFTOp.burn,
                    value: Conf.burnRequestValue,
                    success: true,
                    actionResultCode: 0
                });
                // Every mint chunk should burn
                expect(burnTxs).toHaveTransaction({
                    from: mints[i].item,
                    to: minter,
                    op: NFTOp.burn_notification,
                    body: (x) => testJettonBurnNotification(x!, {
                        amount: mints[i].amount,
                    }),
                    success: true,
                    actionResultCode: 0
                });
                burnTotal += mints[i].amount;
                // Expect item to be destroyed
                const itemSmc = await bc.getContract(mints[i].item);
                expect(itemSmc.balance).toBe(0n);
                expect(itemSmc.accountState).toBeUndefined();

                if(post)
                    await post(mints[i]);
            }

            return burnTotal;
        }
        assertRoundDeposit = async (txs: BlockchainTransaction[],
                                    depositors: MintChunk[],
                                    supply: bigint,
                                    balance: bigint,
                                    minterAddr: Address) => {

            const deposit = depositors.reduce((total, cur) => total + cur.amount, 0n);
            const amount  = muldivExtra(deposit, supply, balance);
            const depositWallet =  await assertPoolJettonMint(txs, amount, minterAddr);

            let distributed = 0n;
            const burnt = await assertBurn(txs, depositors, minterAddr,async (mint: MintChunk) => {
                const depoJetton = await poolJetton.getWalletAddress(mint.address);
                const jetton = bc.openContract(DAOWallet.createFromAddress(depoJetton));
                const share  = muldivExtra(mint.amount, supply, balance)
                // Transfering pool jettons to depositor wallet
                expect(txs).toHaveTransaction({
                    from: depositWallet,
                    to: depoJetton,
                    op: Op.jetton.internal_transfer,
                    body: (x) => testJettonTransfer(x!, {
                        amount: share
                    }),
                    success: true,
                });
                // Pool jetton transfer notification
                expect(txs).toHaveTransaction({
                    from:depoJetton,
                    to: mint.address,
                    op: Op.jetton.transfer_notification,
                    body: (x) => testJettonNotification(x!, {
                        amount: share
                    })
                });
                distributed += share;
            });
            // No action phase failures
            expect(txs).not.toHaveTransaction({
                actionResultCode: (x) => x! !== undefined && x! !== 0
            });

            // Verifying deposit affected data
            const dataAfter = await pool.getFullData();
            expect(dataAfter.requestedForDeposit).toEqual(0n);
            expect(dataAfter.supply).toEqual(supply + distributed);
            // Verifying pool supply matches what pool's expectations
            expect(await poolJetton.getTotalSupply()).toEqual(supply + distributed);
            return {
                burnt,
                distributed
            };
        }
        assertRoundWithdraw = async (txs: BlockchainTransaction[],
                                     withdrawals: MintChunk[],
                                     supply: bigint,
                                     balance: bigint,
                                     minterAddr: Address) => {
            const withdraw = withdrawals.reduce((total, cur) => total + cur.amount, 0n);
            const amount   = muldivExtra(withdraw, balance, supply);
            // console.log(`Requested:${withdraw}`);
            // console.log(`Supply:${supply}`);
            // console.log(`Balance:${balance}`);
            // console.log(`Withdraw amount:${amount}`);
            // Check tons sent for distribution
            const distrTx = findTransaction(txs, {
                from: pool.address,
                to: minterAddr,
                op: NFTOp.start_distribution,
            });

            expect(distrTx).not.toBeUndefined();

            const inMsg = distrTx!.inMessage!;
            if(inMsg.info.type !== "internal")
                throw(Error("Should be internal"));

            const fwdFee = computeMessageForwardFees(bcConf, inMsg);
            const rawVal = inMsg.info.value.coins;
            const msgVal = rawVal + fwdFee.fees + fwdFee.remaining;
            // console.log(`Msg val:${msgVal}`);
            // console.log(`Raw value:${inMsg.info.value.coins}`);
            // console.log(`Amount and fee:${amount + Conf.notificationAmount}`);
            expect(msgVal).toEqual(amount + Conf.notificationAmount);

            const burnt = await assertBurn(txs, withdrawals, minterAddr, async (mint: MintChunk) => {
                const share = muldivExtra(mint.amount, balance, supply);
                expect(txs).toHaveTransaction({
                    from: minterAddr,
                    to: mint.address,
                    op: NFTOp.distributed_asset,
                    value: (x) => x! >= share
                });
            });

            // Withdraw data effects
            const dataAfter = await pool.getFullData();
            expect(dataAfter.requestedForWithdrawal).toEqual(0n);
            expect(dataAfter.supply).toEqual(supply - burnt);
            expect(dataAfter.totalBalance).toEqual(balance - amount);
            expect(dataAfter.withdrawalPayout).toBe(null);
            // Verifying pool supply matches what pool's expectations
            expect(await poolJetton.getTotalSupply()).toEqual(supply - burnt);
            return {
                burnt,
                distributed: amount,
            };
        }
        assertRound   = async (txs: BlockchainTransaction[],
                               round: number,
                               depositors: MintChunk[],
                               withdrawals:  MintChunk[],
                               borrowed: bigint,
                               expected: bigint,
                               returned: bigint,
                               supply: bigint,
                               totalBalance: bigint,
                               depositMinter: Address | null,
                               withdrawMinter: Address | null) => {
            let fee        = 0n;
            let sentDuring = Conf.serviceNotificationAmount;
            const profit   = returned - borrowed - Conf.finalizeRoundFee;
            const curBalance = totalBalance + profit;
            if(profit > 0) {
                fee = Conf.governanceFee * profit / Conf.shareBase;
                // console.log(`Governance fee:${fee}`);
            }
            expect(txs).toHaveTransaction({
                from: pool.address,
                to: deployer.address, // Interest manager
                op: Op.interestManager.stats,
                body: (x) => {
                    const bs = x!.beginParse().skip(32 + 64);
                    const borrowedSent = bs.loadCoins();
                    const expectedSent = bs.loadCoins();
                    const returnedSent = bs.loadCoins();
                    // console.log(`BorrowedSent:${borrowedSent}`);
                    // console.log(`expectedSent:${expectedSent}`);
                    // console.log(`returnedSent:${returnedSent}`);
                    return borrowedSent == borrowed
                           && expectedSent == expected
                           && returnedSent == returned;
                }
            });
            if(depositors.length > 0) {
                expect(depositMinter).not.toBe(null);
                const depoRes = await assertRoundDeposit(txs, depositors, supply, curBalance, depositMinter!);
                supply += depoRes.distributed;
                sentDuring += Conf.notificationAmount + Conf.distributionAmount;
            }
            if(withdrawals.length > 0n) {
                expect(withdrawMinter).not.toBe(null);
                const withdraw = await assertRoundWithdraw(txs, withdrawals, supply, curBalance, withdrawMinter!);
                supply -= withdraw.burnt;

                sentDuring += withdraw.distributed + Conf.notificationAmount;
            }
            if(fee > Conf.serviceNotificationAmount) {
                expect(txs).toHaveTransaction({
                    from: pool.address,
                    to: deployer.address, // Interest manager
                    value: fee - msgConf.lumpPrice // Bit lazy
                });
                sentDuring += fee;
            }
            const dataAfter = await pool.getFullData();
            // expect(dataAfter.currentRound.roundId).toEqual(round + 1);
            // Verify that we eactually sent out as much as expected
            const totalOut = filterTransaction(txs, {from: pool.address}).map(
                x => x.inMessage!
            ).reduce((totalFee, curMsg) => {
                let sumVal = totalFee;
                if(curMsg.info.type === "internal") {
                    // console.log(curMsg.info);
                    const op = curMsg.body.beginParse().preloadUint(32);
                    const chainConf = curMsg.info.dest.workChain == 0 ? bcConf : msgConf;
                    const msgFee = computeMessageForwardFees(chainConf, curMsg);
                    const origVal = curMsg.info.value.coins + msgFee.fees + msgFee.remaining;
                    //console.log(`Bits:${curMsg.body.bits.length}`);
                    // console.log(`Orig value exp:${origVal}`);
                    // console.log(`Value sent:${curMsg.info.value.coins}`);
                    //console.log(`Fees:${msgFee.fees}\n${msgFee.remaining}\n${curMsg.info.forwardFee}`);
                    sumVal += origVal;
                }
                return sumVal;
            }, 0n);
            // Actual sent amount should match expected
            // console.log(`Total out:${totalOut}`);
            // console.log(`Expected:${sentDuring}`);
            expect(totalOut).toEqual(sentDuring);

            return sentDuring;
        }
        assertNewPayout  = async(txs: BlockchainTransaction[],
                                 expectNew: boolean,
                                 prevPayout: Address | null,
                                 deposit: boolean) => {
            let payout = deposit ? await pool.getDepositMinter()
                                 : await pool.getWithdrawalMinter();
            if(expectNew) {
                expect(txs).toHaveTransaction({
                    from: pool.address,
                    to: payout.address,
                    deploy: true,
                    success: true
                });
            }
            else {
                expect(txs).not.toHaveTransaction({
                    from: pool.address,
                    to: payout.address,
                    deploy: true
                });
            }
            if(prevPayout !== null) {
                expect(prevPayout.equals(payout.address)).toBe(!expectNew);
            }

            return bc.openContract(payout);
        }
        assertPayoutMint = async(txs: BlockchainTransaction[],
                                 payout: SandboxContract<PayoutCollection>,
                                 billBefore: BillState,
                                 dest: Address,
                                 amount: bigint, index: number) => {
            // Testing mint of new payout jettons
            const item   = bc.openContract(
                PayoutItem.createFromAddress(await payout.getNFTAddress(BigInt(index))
            ));
            expect(txs).toHaveTransaction({
                from: pool.address,
                to: payout.address,
                op: Op.payout.mint,
                body: (x) => testMintMsg(x!, {
                    dest,
                    amount: amount,
                    notification: NFTConf.transfer_notification_amount
                }),
                success: true
            });
            expect(txs).toHaveTransaction({
                from: payout.address,
                to: item.address,
                deploy: true,
                success: true
            });

            const itemData = await item.getNFTData();
            expect(itemData.collection).toEqualAddress(payout.address);
            expect(itemData.index).toEqual(index);
            expect(itemData.inited).toBe(true);
            expect(itemData.owner).toEqualAddress(dest);
            expect(await item.getBillAmount()).toEqual(amount);

            const billAfter = await payout.getTotalBill();
            expect(billAfter.billsCount).toEqual(billBefore.billsCount + 1n);
            expect(billAfter.totalBill).toEqual(billBefore.totalBill + amount);

            return {
                address: dest,
                item: item.address,
                index,
                amount
            }
        }
        assertDeposit = async (via: Sender, amount: bigint, index: number, new_round: boolean) => {
            // Assert deposit/withdraw jettons mint and effects
            const dataBefore = await pool.getFullData();
            const prevMinter = dataBefore.depositPayout;
            let   billBefore: BillState;
            if(new_round) {
                billBefore = {
                    totalBill: 0n,
                    billsCount: 0n
                };
            }
            else {
                const tmpMinter = bc.openContract(await pool.getDepositMinter());
                billBefore = await tmpMinter.getTotalBill();
            }

            const res    = await pool.sendDeposit(via, amount);
            const minter = await assertNewPayout(res.transactions,
                                                 new_round,
                                                 prevMinter,
                                                 true);
            const expDepo  = amount - Conf.poolDepositFee;
            const nm       = await assertPayoutMint(res.transactions,
                                                    minter,
                                                    billBefore,
                                                    via.address!,
                                                    expDepo,
                                                    index);

            const dataAfter = await pool.getFullData();
            expect(dataAfter.requestedForDeposit).toEqual(dataBefore.requestedForDeposit + expDepo);
            expect(dataAfter.totalBalance).toEqual(dataBefore.totalBalance);
            expect(dataAfter.depositPayout).toEqualAddress(minter.address);

            return nm;
        }
        assertOptimisticDeposit = async (via, amount, expected_profit) => {
            const poolBefore = await pool.getFullData();
            const res = await pool.sendDeposit(via, amount)
            const balanceAfter = poolBefore.totalBalance + expected_profit;
            const expectedBalance = balanceAfter > 0n ? balanceAfter : 0n;
            const mintAmount      = muldivExtra(amount - Conf.poolDepositFee, poolBefore.supply, expectedBalance);
            // Should not deploy anything
            expect(res.transactions).not.toHaveTransaction({
                from: pool.address,
                deploy: true
            });
            await assertPoolJettonMint(res.transactions, mintAmount, via.address!);

            const poolAfter = await pool.getFullData();
            // Minters if any, should not change
            if(poolAfter.depositPayout == null) {
                expect(poolAfter.depositPayout).toEqual(poolBefore.depositPayout);
            }
            else {
                expect(poolAfter.depositPayout).toEqualAddress(poolBefore.depositPayout!);
            }
            if(poolAfter.withdrawalPayout == null) {
                expect(poolAfter.withdrawalPayout).toEqual(poolBefore.withdrawalPayout);
            }
            else {
                expect(poolAfter.withdrawalPayout).toEqualAddress(poolBefore.withdrawalPayout!);
            }

            return mintAmount;
        }

        assertWithdraw = async (via,
                                amount,
                                optimistic,
                                fill_or_kill, balance, supply, index, new_round) => {


            const withdrawAddr = via.address!;
            // Withdraw is burning pool jettons pTONs
            const withdrawJetton = bc.openContract(DAOWallet.createFromAddress(
                await poolJetton.getWalletAddress(withdrawAddr)
            ));
            const poolBefore = await pool.getFullData();
            const prevMinter = poolBefore.withdrawalPayout;

            let   billBefore: BillState;
            if(new_round || fill_or_kill) {
                billBefore = {
                    totalBill: 0n,
                    billsCount: 0n
                };
            }
            else {
                const tmpMinter = bc.openContract(await pool.getWithdrawalMinter());
                billBefore = await tmpMinter.getTotalBill();
            }

            const poolBalance = await getContractBalance(pool.address);
            const res = await withdrawJetton.sendBurnWithParams(via, toNano('1.05'),
                                                                amount,
                                                                withdrawAddr, !optimistic, fill_or_kill);
            const poolAfter = await pool.getFullData();
            // Shold burn successfully
            expect(res.transactions).toHaveTransaction({
                from: withdrawJetton.address,
                to: poolJetton.address,
                body: (x) => testJettonBurnNotification(x!, {
                    amount
                }),
                success: true
            });

            // Withdraw request reached pool
            const reqTx = findTransaction(res.transactions, {
                from: poolJetton.address,
                to: pool.address,
                op: Op.pool.withdraw,
                outMessagesCount: (x) => x! >= 1
            })!;
            expect(reqTx).not.toBeUndefined();

            if(optimistic) {
                const inMsg = reqTx.inMessage!;
                if(inMsg.info.type !== "internal")
                    throw(Error("Internal expected"));
                expect(balance).toEqual(poolBefore.totalBalance);
                expect(supply).toEqual(poolBefore.supply);
                const inValue       = inMsg.info.value.coins;
                const outMsg        = reqTx.outMessages.get(1)!;
                const fundsAvailabe = poolBalance - inValue - Conf.minStoragePool;
                const tonAmount = amount * balance / supply;
                if(tonAmount == 0n) {
                    expect(computedGeneric(reqTx).success).toBe(false);
                    // Expect to mint back burned amount
                    await assertPoolJettonMint(res.transactions, amount, withdrawAddr);
                    expect(supply).toEqual(poolAfter.supply);
                    expect(balance).toEqual(poolAfter.totalBalance);
                    return {burnt: 0n, distributed: 0n} as any;
                }
                if(fundsAvailabe > tonAmount) {
                    expect(res.transactions).toHaveTransaction({
                        from: pool.address,
                        to: withdrawAddr,
                        op: Op.pool.withdrawal,
                        value: tonAmount + inValue - bcConf.lumpPrice - computedGeneric(reqTx).gasFees
                    });
                    expect(poolAfter.totalBalance).toEqual(poolBefore.totalBalance - tonAmount);
                    expect(poolAfter.supply).toEqual(poolBefore.supply - amount);
                    return {burnt: amount, distributed: tonAmount} as DistributionComplete;
               }
            }
            if(fill_or_kill) {
                // Expect to mint back burned amount
                await assertPoolJettonMint(res.transactions, amount, withdrawAddr);
                // Nothing changed
                expect(supply).toEqual(poolAfter.supply);
                expect(balance).toEqual(poolAfter.totalBalance);
                return {burnt: 0n, distributed: 0n} as DistributionComplete;
            }
            // Otherwise we fall into pessimistic withdraw procedure
            const minter = await assertNewPayout(res.transactions,
                                                 new_round,
                                                 prevMinter,
                                                 false);
            const nm     = await assertPayoutMint(res.transactions,
                                                  minter,
                                                  billBefore,
                                                  via.address!,
                                                  amount,
                                                  index);
            expect(poolAfter.requestedForWithdrawal).toEqual(poolBefore.requestedForWithdrawal + amount);
            expect(poolAfter.totalBalance).toEqual(poolBefore.totalBalance);
            expect(poolAfter.withdrawalPayout).toEqualAddress(minter.address);



            // https://github.com/microsoft/TypeScript-Website/issues/1931
            return nm as DistributionDelayed;
        }
        assertGetLoan = async (lender, amount, exp_success, min_amount?) => {
            const poolData = await pool.getFullDataRaw();
            const stateBefore = await getContractData(pool.address);
            const controllerData = await lender.getControllerData();
            const vSender = bc.sender(controllerData.validator);
            await lender.sendUpdateHash(vSender);
            const curVset = getVset(bc.config, 34);
            if(getCurTime() < curVset.utime_unitl - eConf.begin_before) {
                bc.now = curVset.utime_unitl - eConf.begin_before + 1;
            }

            const reqBalance = await lender.getBalanceForLoan(amount, poolData.interestRate);
            const controllerBalance = await getContractBalance(lender.address);
            if(controllerBalance < reqBalance && exp_success) {
                await lender.sendTopUp(vSender, reqBalance - controllerBalance + toNano('1'));
            }
            const res =await lender.sendRequestLoan(vSender, amount, amount, poolData.interestRate);
            const succcesTx = {
                from: pool.address,
                to: lender.address,
                op: Op.controller.credit
            };
            if(exp_success) {
                const poolAfter = await pool.getFullData();
                expect(res.transactions).toHaveTransaction(succcesTx);
                expect(poolAfter.currentRound.activeBorrowers).toEqual(poolData.currentRound.activeBorrowers + 1n);
                expect(poolAfter.currentRound.borrowed).toEqual(poolData.currentRound.borrowed + amount);
            }
            else {
                expect(res.transactions).not.toHaveTransaction(succcesTx);
                expect(await getContractData(pool.address)).toEqualCell(stateBefore);
            }
            return res;
        }
        assertPoolBalanceNotChanged = async (balance) => {
            const poolData = await pool.getFullDataRaw();
            const poolBalance = await getContractBalance(pool.address);
            const poolFunds   = poolBalance - poolData.totalBalance;
            expect(poolFunds).toEqual(balance);
        }
        /*
        getLoanWithExpProfit = async (lender, exp_profit) => {
            const poolData   = await pool.getFullData();
            const controllerData = await lender.getControllerData();
            const validator = bc.sender(controllerData.validator);
            if(controllerData.state != ControllerState.REST)
                throw(Error("Controller is not in REST state"));
            const profitWithFinalize = exp_profit + Conf.finalizeRoundFee;
            const profitFee = Conf.governanceFee * exp_profit / Conf.shareBase;
            const totalProfit = profitWithFinalize + profitFee;
            console.log(`Total profit:${totalProfit}`);
            const loanAmount = totalProfit * Conf.shareBase / BigInt(poolData.interestRate); //Rounding errors?
            const creditable = await getCreditable();
            if(creditable < loanAmount)
                throw(Error("Pool doesn't have enough ton to spare"));

            // Just in case
            await controller.sendUpdateHash(validator);
            const curVset = getVset(bc.config, 34);
            if(getCurTime() < curVset.utime_unitl - eConf.begin_before) {
                bc.now = curVset.utime_unitl - eConf.begin_before + 1;
            }

            const reqBalance = await lender.getBalanceForLoan(loanAmount, poolData.interestRate);
            const controllerBalance = await getContractBalance(lender.address);
            if(controllerBalance < reqBalance) {
                await lender.sendTopUp(validator, reqBalance - controllerBalance + toNano('1'));
            }
            const res =await lender.sendRequestLoan(validator, loanAmount, loanAmount, poolData.interestRate);
            expect(res.transactions).toHaveTransaction({
                from: pool.address,
                to: controller.address,
                op: Op.controller.credit
            });
            return totalProfit;
        }
        */
    });
    it('Deploy controller', async () => {
        const res = await pool.sendRequestControllerDeploy(validator.wallet.getSender(),
                          Conf.minStoragePool + Conf.hashUpdateFine + 3n * Conf.stakeRecoverFine + toNano('1'),
                          0);
        expect(res.transactions).toHaveTransaction({
            from: validator.wallet.address,
            to: pool.address,
            outMessagesCount: 1
        });
        const deployMsg = res.transactions[1].outMessages.get(0)!;

        if(deployMsg.info.type !== "internal")
            throw(Error("Should be internal"));

        expect(res.transactions).toHaveTransaction({
            from: pool.address,
            to: deployMsg.info.dest,
            deploy: true,
            success: true,
        });

        controller = bc.openContract(Controller.createFromAddress(deployMsg.info.dest));

        const controllerData = await controller.getControllerData();

        expect(controllerData.state).toEqual(ControllerState.REST);
        expect(controllerData.validator).toEqualAddress(validator.wallet.address);
        expect(controllerData.pool).toEqualAddress(pool.address);
        expect(controllerData.approved).toBe(false);
        const controllerAddr = await pool.getControllerAddress(0, validator.wallet.address);
        expect(controllerAddr).toEqualAddress(controller.address);
        // Check that the approver is set right
        await controller.sendApprove(deployer.getSender(), true);
        expect((await controller.getControllerData()).approved).toBe(true);
        snapStates.set('deployed', bc.snapshot());
    });
    describe('Simple', () => {
    it('Two deposits with same amount should get same amount of depo jetons/pTONS/TONs', async () => {
        const prevState  = bc.snapshot();
        const depoAmount = getRandomTon(10000, 20000);
        const [nm1, nm2] = await bc.createWallets(2);
        expect(await compareBalance(nm1, nm2)).toBe(true);
        const initialBalance = await nm1.getBalance();
        await pool.sendDonate(deployer.getSender(), Conf.finalizeRoundFee);
        const depoRes1   = await assertDeposit(nm1.getSender(), depoAmount, 0, true);
        const depoRes2   = await assertDeposit(nm2.getSender(), depoAmount, 1, false);
        // expect(compareBalance(nm1, nm2)).toBe(true); // Those are actually different, because first one spends ton on minter deploy
        expect(depoRes1.amount).toEqual(depoRes2.amount);
        expect(depoRes1.amount).toEqual(depoAmount - Conf.poolDepositFee);
        await nextRound();
        // For simplicity donate again
        await pool.sendDonate(deployer.getSender(), Conf.finalizeRoundFee);
        const poolAfter = await pool.getFullData();
        const withdrawAmount = depoAmount / 3n;
        // Test jetton balance
        expect(await compareBalance(nm1, nm2, true)).toBe(true);
        const withdrawRes1 = await assertWithdraw(nm1.getSender(), withdrawAmount, false, false, poolAfter.totalBalance, poolAfter.supply, 0, true)
        const withdrawRes2 = await assertWithdraw(nm2.getSender(), withdrawAmount, false, false, poolAfter.totalBalance, poolAfter.supply, 1, false);
        expect(withdrawRes1.amount).toEqual(withdrawRes2.amount);
        await nextRound();
        const balanceBefore1 = await nm1.getBalance();
        const balanceBefore2 = await nm2.getBalance();
        // Should send withdrawn tons
        await pool.sendTouch(deployer.getSender());
        const balanceAfter1 = await nm1.getBalance();
        const balanceAfter2 = await nm2.getBalance();
        // We had no profit, so no one should get extra
        expect(balanceAfter1).toBeLessThanOrEqual(initialBalance);
        expect(balanceAfter2).toBeLessThanOrEqual(initialBalance);
        const delta1 = balanceAfter1 - balanceBefore1;
        const delta2 = balanceAfter2 - balanceBefore2;
        // Roll back
        await bc.loadFrom(prevState);
        // This will fail in strict comparasion because of the burn fee differs from payout mint fee
        expect(approximatelyEqual(delta1, delta2, toNano('0.02'))).toBe(true);
    });
    it('Should not allow to mint 0 deposit', async () => {
        const prevState = bc.snapshot();
        const depositor = await bc.treasury('Depo');
        const depo      = Conf.poolDepositFee; // Would equal 0 after deduction
        const res       = await pool.sendDeposit(depositor.getSender(), depo);
        expect(res.transactions).not.toHaveTransaction({
            from: pool.address,
            deploy: true
        });
        expect(res.transactions).not.toHaveTransaction({
            from: pool.address,
            op: Op.payout.mint
        });
        expect(res.transactions).toHaveTransaction({
            from: pool.address,
            to: depositor.address,
            inMessageBounced: true
        });
        await bc.loadFrom(prevState);
    });
    it("Should be able to burn the nft regardless of it balance", async() => {
        const prevState = bc.snapshot();
        await pool.sendDonate(deployer.getSender(), Conf.finalizeRoundFee);
        const [depoA, depoB] = await bc.createWallets(2);
        // First depo doesn't send burn, so deposit amount is irrelevant
        const depoResA = await assertDeposit(depoA.getSender(), toNano('1000'), 0, true);
        // Just enough to mint NFT with minimal balance
        const depoResB = await assertDeposit(depoB.getSender(), Conf.poolDepositFee + 1n, 1, false);
        // Check if item has enough balance to send burn
        expect(await getContractBalance(depoResB.item)).toBeGreaterThanOrEqual(Conf.burnRequestValue);
        const poolData = await pool.getFullData();
        // Check if ir works anyways
        await nextRound();
        // Will trigger the round finalization with pTON distribution
        const res = await pool.sendTouch(deployer.getSender());
        // Check results
        await assertRound(res.transactions,
                          0,
                          [depoResA, depoResB],
                          [],
                          0n,
                          0n,
                          0n,
                          poolData.supply,
                          poolData.totalBalance,
                          poolData.depositPayout,
                          poolData.withdrawalPayout);

        await bc.loadFrom(prevState);
    });
    it('Simple deposit', async () => {
        let deposited = 0n;
        depositors = [];
        let expBalances: bigint[] = [];
        const dataBefore = await pool.getFullData();
        expect(dataBefore.totalBalance).toEqual(0n);
        await pool.sendDonate(deployer.getSender(), Conf.finalizeRoundFee);
        expect((await pool.getFullData()).totalBalance).toEqual(Conf.finalizeRoundFee);
        let i = 0;
        while(deposited < sConf.min_stake * 3n) {
            const depo   = getRandomTon(150000, 200000);
            const depositor = await bc.treasury(`Depo:${i}`);
            const depoRes   = await assertDeposit(depositor.getSender(), depo, i, i == 0);
            depositors.push(depoRes);
            expBalances.push(depoRes.amount);
            deposited += depo;
            i++;
        }
        // Now some repetitive deposits to check if it will add up
        let repeats: MintChunk[] = [];
        for(let k = 0; k < depositors.length; k++) {
            const depo = getRandomTon(15000, 20000);
            let j = getRandomInt(1, 3, 2);
            const depoSender = bc.sender(depositors[k].address);
            for (let l = 0; l < j; l++) {
                const depoRes   = await assertDeposit(depoSender, depo, i + l, false);
                repeats.push(depoRes);
                expBalances[k] += depoRes.amount;
                deposited += depo;
            }
            i += j;
        }
        const poolData  = await pool.getFullData();
        await nextRound();
        const res = await pool.sendTouch(deployer.getSender());
        const dataAfter = await pool.getFullData();
        expect(dataAfter.currentRound.roundId).toEqual(dataBefore.currentRound.roundId + 1);
        await assertRound(res.transactions,
                          0,
                          [...depositors,...repeats],
                          [],
                          0n,
                          0n,
                          0n,
                          poolData.supply,
                          poolData.totalBalance,
                          poolData.depositPayout,
                          poolData.withdrawalPayout);
        for(let i = 0; i <expBalances.length; i++) {
            expect(await getUserJettonBalance(depositors[i].address)).toEqual(expBalances[i]);
        }
        snapStates.set('deposited', bc.snapshot());
    });

    it('Request loan from controller', async () => {
        // Loan should be requested during elections
        const curVset = getVset(bc.config, 34);
        if(getCurTime() < curVset.utime_unitl - eConf.begin_before) {
            bc.now = curVset.utime_unitl - eConf.begin_before + 1;
        }
        let   maxLoan = sConf.min_stake;
        let   minLoan = maxLoan - toNano('100000');
        const poolData = await pool.getFullData();
        const maxInterest = poolData.interestRate;
        let   reqBalance  = await controller.getBalanceForLoan(maxLoan, maxInterest);
        const controllerBalance = await getContractBalance(controller.address);
        if(controllerBalance < reqBalance) {
            const delta = reqBalance - controllerBalance;
            await controller.sendTopUp(validator.wallet.getSender(), delta + toNano('1'));
        }

        let   creditable = await getCreditable();
        if(creditable > maxLoan)
            creditable = maxLoan;

        const expInterest = creditable * BigInt(poolData.interestRate) / Conf.shareBase;
        const res = await controller.sendRequestLoan(validator.wallet.getSender(),
                                                     minLoan,
                                                     maxLoan,
                                                     maxInterest);
        // Loan request
        expect(res.transactions).toHaveTransaction({
            from: controller.address,
            to: pool.address,
            op: Op.pool.request_loan,
            body: (x) => {x!;
                const rs = x.beginParse().skip(64 + 32);
                // That's probably too much
                const minLoanSent = rs.loadCoins();
                const maxLoanSent = rs.loadCoins();
                const maxInterestSent = rs.loadUint(24);
                const requestMatch =
                    minLoanSent == minLoan &&
                    maxLoanSent == maxLoan &&
                    maxInterestSent == maxInterest;
                // Meta we might want to check
                const metaMatch = testControllerMeta(rs.preloadRef(), {
                    id: 0,
                    governor: deployer.address,
                    pool: pool.address,
                    approver: deployer.address,
                    halter: deployer.address
                });

                return requestMatch && metaMatch;
            },
            success: true
        });
        // Loan response
        const poolCreditTrans = findTransaction(res.transactions, {
            from: pool.address,
            to: controller.address,
            op: Op.controller.credit,
            success: true
        })!;

        expect(poolCreditTrans).not.toBeUndefined();
        expect(poolCreditTrans.parent).not.toBeUndefined();
        const creditMsg = poolCreditTrans.inMessage!;
        if(creditMsg.info.type !== "internal")
            throw(Error("Can't be"));

        const fwdFee = computeMessageForwardFees(msgConf, creditMsg);

        expect(creditMsg.info.value.coins).toEqual(creditable - fwdFee.fees - fwdFee.remaining);
        const bs = creditMsg.body.beginParse().skip(64 + 32);
        expect(bs.loadCoins()).toEqual(creditable + expInterest);
        const controllerData = await controller.getControllerData();
        expect(controllerData.borrowedAmount).toEqual(creditable + expInterest);
        expect(controllerData.borrowingTime).toEqual(poolCreditTrans.parent!.now);
        const loanData = await pool.getLoan(0, validator.wallet.address, false);
        expect(loanData.borrowed).toEqual(creditable);
        expect(loanData.interestAmount).toEqual(expInterest);
        assertLog(res.transactions, pool.address, 1, {
            lender: controller.address,
            amount: creditable
        });
    });
    it('Controller deposit to elector', async () => {
        const controllerData = await controller.getControllerData();
        let   prevElect      = 0;

        const curElect = await announceElections();
        expect(prevElect).not.toEqual(curElect);
        prevElect      = curElect;
        const depo     = sConf.min_stake + toNano('1');
        const res      = await controller.sendNewStake(validator.wallet.getSender(),
                                                       depo,
                                                       validator.keys.publicKey,
                                                       validator.keys.secretKey,
                                                       curElect);
        expect(res.transactions).toHaveTransaction({
            from: elector.address,
            to: controller.address,
            op: Op.elector.new_stake_ok
        });
        const controllerAfter = await controller.getControllerData();
        expect(controllerAfter.validatorSetChangeCount).toEqual(0);
        expect(controllerAfter.validatorSetChangeTime).toEqual(getVset(bc.config, 34).utime_since);
        const stake = await elector.getStake(validator.keys.publicKey);
        expect(stake).toEqual(depo - toNano('1'));
        // Run elections and update hashes
        await nextRound();
        await controller.sendUpdateHash(validator.wallet.getSender());
        //console.log(updRes.transactions[1].description);
        expect((await controller.getControllerData()).validatorSetChangeCount).toEqual(1);
        await pool.sendTouch(deployer.getSender());
    });
    it('Next elections round and profit return', async () => {
        const controllerData = await controller.getControllerData();
        const dataBefore     = await pool.getFullData();
        expect(controllerData.validatorSetChangeCount).toEqual(1); // Only round we participated in
        const curLoan        = await pool.getLoan(0, validator.wallet.address, true);

        expect(curLoan.borrowed).toBeGreaterThan(0n);
        expect(curLoan.interestAmount).toBeGreaterThan(0n);

        // Skip one
        await nextRound();
        let res = await controller.sendUpdateHash(validator.wallet.getSender());
        waitUnlock(res.transactions[1].now);
        await elector.sendTickTock("tock"); // Announce elecitons
        await elector.sendTickTock("tock"); // Update credits

        res = await controller.sendRecoverStake(validator.wallet.getSender());
        // Should get more than borrowed
        expect(res.transactions).toHaveTransaction({
            from: elector.address,
            to: controller.address,
            op: Op.elector.recover_stake_ok,
            value: (x) => x! > controllerData.borrowedAmount,
            success:true
        });
        // Should trigger loan repayment
        expect(res.transactions).toHaveTransaction({
            from: controller.address,
            to: pool.address,
            op: Op.pool.loan_repayment,
            value: controllerData.borrowedAmount,
            success: true
        });
        assertLog(res.transactions, pool.address, 2, {
            lender: controller.address,
            amount: curLoan.borrowed,
            profit: curLoan.interestAmount
        });
        await assertRound(res.transactions,
                    1,
                    [],
                    [],
                    curLoan.borrowed,
                    controllerData.borrowedAmount,
                    controllerData.borrowedAmount,
                    dataBefore.supply,
                    dataBefore.totalBalance,
                    null,
                    null)


        expect(await pool.getLoan(0, validator.wallet.address, true)).toEqual({
            borrowed: 0n,
            interestAmount: 0n
        });
    });
    it('Simple withdraw', async() => {
        const prevState   = bc.snapshot();
        const poolBefore  = await pool.getFullData();
        let withdrawals: MintChunk[] = [];
        let totalCount = 0;
        for( let i = 0; i < depositors.length; i++) {
            const sender = bc.sender(depositors[i].address);
            const jettonWallet = bc.openContract(DAOWallet.createFromAddress(
                await poolJetton.getWalletAddress(depositors[i].address)
            ));

            const withdrawCount = getRandomInt(1, 3);
            for(let k = 0; k < withdrawCount; k++) {
                const amount = getRandomTon(10000, 50000);
                const idx    = totalCount + k;
                const wRes   = await assertWithdraw(sender, amount, false, false, poolBefore.totalBalance, poolBefore.supply, idx, idx == 0);
                withdrawals.push(wRes);
            }
            totalCount += withdrawCount;
        }
        const poolData    = await pool.getFullData();
        await nextRound();
        const res = await pool.sendTouch(deployer.getSender());
        await assertRound(res.transactions,
                          1,
                          [],
                          withdrawals,
                          0n,
                          0n,
                          0n,
                          poolBefore.supply,
                          poolBefore.totalBalance,
                          poolData.depositPayout,
                          poolData.withdrawalPayout);
        await bc.loadFrom(prevState);
    });
    it('Withdraw in pessimistic mode with fill_or_kill true, should mint back', async () => {
        const depoIdx = getRandomInt(0, depositors.length - 1);
        const share   = BigInt(getRandomInt(2, 4));
        const depositor = depositors[depoIdx];
        const sender  = bc.sender(depositor.address);
        const pton    = await getUserJetton(depositor.address);

        const balanceBefore = await pton.getJettonBalance();
        const burnAmount = balanceBefore / share;
        const stateBefore = await getContractData(pool.address);
        const poolBefore = await pool.getFullData();
        let nftIdx = 0;
        const newPayout = poolBefore.withdrawalPayout != null;
        if(newPayout) {
            const payout = bc.openContract(
                PayoutCollection.createFromAddress(poolBefore.withdrawalPayout!)
            );
            nftIdx = Number((await payout.getCollectionData()).nextItemIndex);
        }

        const res = await assertWithdraw(sender,
                                         burnAmount,
                                         false, // pessimistic mode
                                         true, // fill_or_kill
                                         poolBefore.totalBalance, // not used in pessimistic
                                         poolBefore.supply, // not used in pessimistic
                                         nftIdx, // Nft idx.
                                         newPayout);
        expect(res.burnt).toEqual(0n);
        expect(res.distributed).toEqual(0n);
        // Transaction is not abborted so there is a possibility that data has changed
        expect(stateBefore).toEqualCell(await getContractData(pool.address));
        // Jetton balance hasn't changed
        expect(await pton.getJettonBalance()).toEqual(balanceBefore);
    });
    });
    describe('Optimistic', () => {
        let depoAddresses: Address[];
        let depoAmounts: bigint[];

        beforeAll(async () => {
            await loadSnapshot('deployed');
            // Start fresh round
            await nextRound();
            pool.sendTouch(deployer.getSender());
            controller.sendUpdateHash(validator.wallet.getSender());
        });
        it('Should set optimistic', async () => {
            const poolBefore = await pool.getFullData();
            expect(poolBefore.optimisticDepositWithdrawals).toBe(false);
            const res = await pool.sendDepositSettings(deployer.getSender(), true, true);
            expect(res.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                success: true
            });
            expect((await pool.getFullData()).optimisticDepositWithdrawals).toBe(true);
            snapStates.set('optimistic', bc.snapshot());
        });
        it('Optimistic deposit', async () => {
            depoAddresses = [];
            depoAmounts   = [];
            let   expBalances: bigint[] = [];
            await pool.sendDonate(deployer.getSender(), Conf.finalizeRoundFee);
            let deposited = 0n;
            let minted    = 0n;
            let i = 0;
            while(deposited < sConf.min_stake * 3n) {
                const depoCount  = getRandomInt(1, 3);
                const depositor  = await bc.treasury(`Depo:${i}`);
                depoAddresses.push(depositor.address);
                for(let k = 0; k < depoCount; k++) {
                    const depo       = k == 0 ? getRandomTon(150000, 200000) : getRandomTon(10000, 20000);
                    const pton = await getUserJetton(depositor.address);
                    const mintAmount = await assertOptimisticDeposit(depositor.getSender(),
                                                                     depo,
                                                                     - Conf.finalizeRoundFee);
                    deposited += depo;
                    minted += mintAmount;
                    if(k == 0) {
                        depoAmounts.push(depo);
                        expBalances.push(mintAmount);
                    }
                    else {
                        depoAmounts[i] += depo;
                        expBalances[i] += mintAmount;
                    }
                }
                i++;
            }
            for(i = 0; i < expBalances.length; i++) {
                expect(expBalances[i]).toEqual(await getUserJettonBalance(depoAddresses[i]));
            }
            snapStates.set('opt_depo', bc.snapshot());
        });
        it('Head to head optimistic deposit. Equal deposits should result in equal balances/withdrawals', async() => {
            const prevState  = bc.snapshot();
            const [nm1, nm2] = await bc.createWallets(2);
            const initialBalance = await nm1.getBalance();
            const depoAmount = getRandomTon(100000, 200000);
            const minted1    = await assertOptimisticDeposit(nm1.getSender(), depoAmount, - Conf.finalizeRoundFee);
            const minted2    = await assertOptimisticDeposit(nm2.getSender(), depoAmount, - Conf.finalizeRoundFee);
            expect(minted1).toEqual(minted2);
            expect(await compareBalance(nm1, nm2)).toBe(true);
            // Compare jetton balance
            expect(await compareBalance(nm1, nm2, true)).toBe(true);
            // Same round withdraw
            const burnAmount = depoAmount / 3n;
            const pton1 = bc.openContract(DAOWallet.createFromAddress(
                await poolJetton.getWalletAddress(nm1.address)
            ));
            const pton2 = bc.openContract(DAOWallet.createFromAddress(
                await poolJetton.getWalletAddress(nm2.address)
            ));

            const res1 = await pton1.sendBurnWithParams(nm1.getSender(), toNano('1.05'), burnAmount, nm1.address, false, false);
            const res2 = await pton2.sendBurnWithParams(nm2.getSender(), toNano('1.05'), burnAmount, nm2.address, false, false);
            const withdrawlTx1 = findTransaction(res1.transactions, {
                from: pool.address,
                to: nm1.address,
                op: Op.pool.withdrawal,
                success: true
            })!;
            const withdrawlTx2 = findTransaction(res2.transactions, {
                from: pool.address,
                to: nm2.address,
                op: Op.pool.withdrawal,
                success: true
            })!;
            expect(withdrawlTx1).not.toBeUndefined();
            expect(withdrawlTx2).not.toBeUndefined();
            const inMsg1 = withdrawlTx1.inMessage!;
            const inMsg2 = withdrawlTx2.inMessage!;
            if(inMsg1.info.type == "internal" && inMsg2.info.type == "internal") {
                // Off by one is tolerable
                expect(approximatelyEqual(inMsg1.info.value.coins, inMsg2.info.value.coins, 1n)).toBe(true)
            }
            else {
                throw(Error("Expected internal"));
            }
            expect(await compareBalance(nm1, nm2)).toBe(true);
            expect(await nm1.getBalance()).toBeLessThanOrEqual(initialBalance);
            await bc.loadFrom(prevState);
        });
        it('Should mint back if not enough balance available and fill_or_kill set', async() => {
            const prevState = bc.snapshot();
            await loadSnapshot('optimistic');
            // Going to use single fat nominator for simplicity
            const cat = await bc.treasury('FatCat');
            const depo = sConf.min_stake * 2n;

            const depoRes = await assertOptimisticDeposit(cat.getSender(), depo, - Conf.finalizeRoundFee);
            // Getting loan
            snapStates.set('pre_withdraw', bc.snapshot());
            const loanRes = await assertGetLoan(controller, sConf.min_stake, true);
            snapStates.set('has_loan', bc.snapshot());
            // Now pool funds are working, so not all of the deposit is available for withdraw
            const catPton = await getUserJetton(cat);
            const balanceBefore = await catPton.getJettonBalance();
            const res = await catPton.sendBurnWithParams(cat.getSender(), toNano('1.05'), depoRes, cat.address, false, true);
            // Burned
            expect(res.transactions).toHaveTransaction({
                from: catPton.address,
                to: poolJetton.address,
                op: Op.jetton.burn_notification,
                body: (x) => testJettonBurnNotification(x!,{
                    from: cat.address,
                    amount: depoRes
                })
            });
            // Expect pool jetton mint back
            await assertPoolJettonMint(res.transactions, depoRes, cat.address);
            expect(await balanceBefore).toEqual(await catPton.getJettonBalance());
            await bc.loadFrom(prevState);
        });
        it('Should not be possible to fail distribution action phase with low burn msg value', async() => {
            await loadSnapshot('has_loan');
            const cat = await bc.treasury('FatCat');
            const catPton = await getUserJetton(cat);
            const poolBefore = await pool.getFullData();
            const minimalValue = 774578013n + 1n // fwd_fee + 2 * gas_consumption + burn_notification
            const burnAmount = 1n;
            const res = await catPton.sendBurnWithParams(cat.getSender(), minimalValue, burnAmount, cat.address, false, false);
            // pTONs burned
            expect(res.transactions).toHaveTransaction({
                from: catPton.address,
                to: poolJetton.address,
                op: Op.jetton.burn_notification,
                body: (x) => testJettonBurnNotification(x!, {
                    from: cat.address,
                    amount: burnAmount
                })
            });
            // If action fails there would be no withdrawal message
            expect(res.transactions).toHaveTransaction({
                from: pool.address,
                to: cat.address,
                op: Op.pool.withdrawal
            });
            expect((await pool.getFullData()).supply).toEqual(poolBefore.supply - 1n);
            await loadSnapshot('opt_depo');
        });
        it('Should revert any update_round effects if withdraw fails as round closing message', async () => {
            await loadSnapshot('pre_withdraw');
            const cat     = await bc.treasury('FatCat');

            const pton        = await getUserJetton(cat);
            const ptonBalance = await pton.getJettonBalance();
            const firstFrac   = ptonBalance / 2n;
            // Withdraws some pessimisticly
            const mintRes = await assertWithdraw(cat.getSender(), firstFrac, false, false, 0n, 0n, 0, true);
            const stateBefore = await getContractData(pool.address);
            const poolBefore  = await pool.getFullData();
            const balanceBefore = await getContractBalance(pool.address);
            expect(poolBefore.requestedForWithdrawal).toEqual(firstFrac);
            // Next round happens
            await nextRound();
            const expBurn = ptonBalance - firstFrac;
            // And then some more is requested with fill_or kill to guarantee cactch case
            const res = await pton.sendBurnWithParams(cat.getSender(),
                                                      toNano('1.05'),
                                                      expBurn, cat.address,
                                                      true, // waitRound -> pessimistic
                                                      true); // fill_or_kill -> guarantee kill in pessimistic mod
            // No withdrawal message emmited
            expect(res.transactions).not.toHaveTransaction({
                from: pool.address,
                to: cat.address,
                op: Op.pool.withdrawal
            });
            // No payout distribution
            expect(res.transactions).not.toHaveTransaction({
                from: pool.address,
                op: NFTOp.start_distribution
            });
            // No stats notification
            expect(res.transactions).not.toHaveTransaction({
                from: pool.address,
                to: deployer.address,
                op: Op.interestManager.stats
            });
            // Expect burned amount to mint back
            await assertPoolJettonMint(res.transactions, expBurn, cat.address);
            // All state rolled back due to catch
            expect(await getContractData(pool.address)).toEqualCell(stateBefore);
            const poolTx = findTransaction(res.transactions, {on: pool.address})!;
            let storageFee = 0n;
            if(poolTx.description.type !== "generic")
                throw(Error("Generic expected"));
            if(poolTx.description.storagePhase)
                storageFee = poolTx.description.storagePhase.storageFeesCollected;
            expect(await getContractBalance(pool.address)).toEqual(balanceBefore - storageFee);
        })
        it('Profit should impact projected jetton rate', async() => {
            await loadSnapshot('opt_depo');
            const poolBefore = await pool.getFullData();
            const interestRate = poolBefore.interestRate;
            let controllers = [controller];
            const loanCount = 5;
            let controllerIdx  = 1;
            let totalExpReturn = 0n;
            let totalExpProfit = 0n;
            for(let i = 0; i < loanCount; i++ ) {
                let deploy = await pool.sendRequestControllerDeploy(validator.wallet.getSender(), toNano('1000'),  controllerIdx++);
                const newController = getNewController(deploy.transactions)
                controllers.push(newController);
                // Loan amount doesn't matter
                const loanAmount = getRandomTon(10000, 20000);
                await newController.sendApprove(deployer.getSender());
                await assertGetLoan(newController, loanAmount, true);
                const interest  = loanAmount * BigInt(interestRate) / Conf.shareBase;
                totalExpProfit += interest;
                totalExpReturn += loanAmount + interest;
            }
            await nextRound();
            await Promise.all(controllers.map(async x => await x.sendUpdateHash(validator.wallet.getSender())));
            await pool.sendTouch(deployer.getSender());
            // After this we expect total balance to reduce by finalizeRoundFee
            const balanceBefore = poolBefore.totalBalance - Conf.finalizeRoundFee;
            const poolAfter = await pool.getFullData();
            expect(poolAfter.previousRound.expected).toEqual(poolBefore.currentRound.expected + totalExpReturn);
            totalExpProfit -= Conf.finalizeRoundFee;
            totalExpProfit -= Conf.governanceFee * totalExpProfit / Conf.shareBase;
            expect(poolAfter.projectedTotalBalance).toEqual(balanceBefore + totalExpProfit);
            // Just in case test that exactly this rate is used while calculating deposit rate
            const depositor = await bc.treasury('TotallyRandom');

            await assertOptimisticDeposit(depositor.getSender(), getRandomTon(1000, 2000), totalExpProfit);
        });
        it('Should be able to withdraw in same round', async() => {
            await loadSnapshot('opt_depo');
            const poolBefore = await pool.getFullData();
            let   balance    = poolBefore.totalBalance;
            let   supply     = poolBefore.supply;
            for(let i = 0; i < depoAddresses.length; i++) {
                // Burn share
                const share = BigInt(getRandomInt(2, 4, 2));
                const pton  = await getUserJetton(depoAddresses[i]);
                const burnAmount = await pton.getJettonBalance(); // / share;
                const owner      = bc.sender(depoAddresses[i]);
                const res        = await assertWithdraw(owner, burnAmount, true, true, balance, supply, 0, false);
                expect(res.burnt).toEqual(burnAmount);
                expect(res.distributed).toBeGreaterThan(0n);
                balance -= res.distributed;
                supply  -= res.burnt;
            }
        });
        it('Should be able to use balance in the same round', async() => {
            await loadSnapshot('opt_depo');
            // Optimists don't wait
            const poolBefore = await pool.getFullData();
            await controller.sendTopUp(validator.wallet.getSender(), sConf.min_stake);
            const loanAmount = getRandomTon(1000, 2000);
            await assertGetLoan(controller, loanAmount, true);
            const poolAfter    = await pool.getFullData();
            // Projected balance should not change because loan profit compensates for finalize round fee
            const loan         = await pool.getLoan(0, validator.wallet.address);
            expect(loan.borrowed).toEqual(loanAmount);
            expect(loan.interestAmount).toEqual(loanAmount * BigInt(poolBefore.interestRate) / Conf.shareBase);
            // One can even participate in the elections if in a hurry
            const electId = await announceElections();
            const res = await controller.sendNewStake(validator.wallet.getSender(),
                                                      sConf.min_stake + toNano('1'),
                                                      validator.keys.publicKey,
                                                      validator.keys.secretKey,
                                                      electId);
            expect(res.transactions).toHaveTransaction({
                from: elector.address,
                to: controller.address,
                op: Op.elector.new_stake_ok
            });
            // snapStates.set('opt_pre_withdraw', bc.snapshot());
        });
    });
    describe('Long run', () => {
        // Main idea is let system run with specified parameters
        type RoundData = {
            activeBorrowers: number,
            borrowed: bigint,
            profit: bigint
        };
        const validatorsCount = 1;
        const nmPerValidator = 2;
        const roundCount = 4;
        const nmCount = 20;
        let  optimistic = true;
        let  fill_or_kill = false;

        let roundId: number;
        let curRound: RoundData
        let interestRate: bigint;
        let balance: bigint;
        let supply: bigint;
        let profit: bigint;
        let depoReq: bigint;
        let withdrawReq: bigint;
        let depoCount: number;
        let withdrawCount: number;
        let validators: Validator[];
        let startValue = toNano('100000');
        let controllers:Map<string,SandboxContract<Controller>[]>;
        let actors: {
            nms: IterableIterator<SandboxContract<TreasuryContract>>
            validstors: IterableIterator<Validator>
        };
        let depositors: SandboxContract<TreasuryContract>[];
        let accountForDepo: (depo: MintChunk | bigint, amount: bigint) => number;
        let runNmAction: (depositor: SandboxContract<TreasuryContract>) => Promise<void>;
        let runVdAction: (validator: Validator) => Promise<void>;
        let runVldActions: () => Promise<void>;
        beforeAll(async () => {
            await loadSnapshot('initial');
            validators = [];
            controllers = new Map<string, SandboxContract<Controller>[]>();
            roundId = 0;
            balance = 0n;
            supply  = 0n;
            depoReq = 0n;
            withdrawReq = 0n;
            profit  = - Conf.finalizeRoundFee;
            depoCount   = 0;
            withdrawCount = 0;
            depositors  = await bc.createWallets(nmCount);
            const depoIter = depositors[Symbol.iterator]();
            let curId = 0;
            await nextRound();
            for(let i = 0; i < validatorsCount; i++) {
                const newValidator = {
                    wallet: await bc.treasury(`Validator:${i}`, {workchain: -1, balance: startValue * 10n}),
                    keys: await keyPairFromSeed(await getSecureRandomBytes(32))
                };
                validators.push(newValidator);
                let myControllers: SandboxContract<Controller>[] = [];
                for (let k = 0; k <= nmPerValidator; k++) {
                    const res = await pool.sendRequestControllerDeploy(newValidator.wallet.getSender(), startValue, curId++);
                    const deployTx = findTransaction(res.transactions, {
                        from: pool.address,
                        deploy: true,
                        initCode: controller_code
                    })!;
                    expect(deployTx).not.toBeUndefined();
                    const deployMsg = deployTx.inMessage!;
                    if(deployMsg.info.type !== "internal")
                        throw(Error("Internal expected"));

                    const newController = bc.openContract(
                            Controller.createFromAddress(deployMsg.info.dest)
                    );
                    await newController.sendApprove(deployer.getSender());
                    const dataAfter = await newController.getControllerData();
                    expect(dataAfter.approved).toBe(true);
                    myControllers.push(newController);
                }
                controllers.set(newValidator.wallet.address.toString(), myControllers);
            }

            await pool.sendSetDepositSettings(deployer.getSender(), toNano('1'), true, true);

            accountForDepo = (depo, amount) => {
                if(typeof depo == 'bigint') {
                    supply  += depo;
                    balance += amount - Conf.poolDepositFee;
                }
                else {
                    depoReq += depo.amount;
                }
                return depoCount++;
            }
            runNmAction = async (depositor) => {
                const sender    = depositor.getSender();
                const ptonBalance = await getUserJettonBalance(depositor.address);
                const tonBalance  = await depositor.getBalance();
                let actionId: number;
                if(roundId > 0) {
                    if(ptonBalance == 0n) {
                        // Can only deposit
                        actionId = 0;
                    }
                    else if(tonBalance == 0n){
                        // Nothing to deposit
                        actionId = 1;
                    }
                    else {
                        // Can do both
                        actionId = getRandomInt(0, 1, 3);
                    }
                }
                else {
                    // Only depo on first round
                    actionId = 0;
                }
                if(actionId == 0) {
                    let depoRes: bigint | MintChunk;
                    const depoAmount = getRandomTon(1n , tonBalance);
                    if(optimistic) {
                        depoRes = await assertOptimisticDeposit(sender, depoAmount, profit);
                    }
                    else {
                        depoRes = await assertDeposit(sender, depoAmount, depoCount, depoCount == 0);
                    }
                    accountForDepo(depoRes, depoAmount);
                }
                else {
                    let withdrawRes: DistributionResult;
                    let done = false;
                    const withdrawAmount = getRandomTon(1n , ptonBalance);

                    withdrawRes = await assertWithdraw(sender,
                                                       withdrawAmount,
                                                       optimistic,
                                                       fill_or_kill,
                                                       balance,
                                                       supply,
                                                       withdrawCount,
                                                       withdrawReq == 0n);
                    if(optimistic) {
                        if((withdrawRes as DistributionComplete).burnt !== undefined) {
                            const res = withdrawRes as DistributionComplete;
                            supply -= res.burnt;
                            balance -= res.distributed;
                            done = true;
                        }
                    }
                    if(! done) {
                        const res = withdrawRes as DistributionDelayed;
                        withdrawReq += res.amount;
                        withdrawCount++;
                    }
                }
            }
            runVdAction = async (validator) => {
                const myControllers = controllers.get(validator.wallet.address.toString())!;
                const shouldAct = (roundId & 1);
                const vSender   = validator.wallet.getSender();
                // Announcing elections
                for(let i = 0; i < nmPerValidator; i++) {
                    let actingController = myControllers[i];
                    const hashUpd = await actingController.sendUpdateHash(vSender);
                    if((i & 1) == shouldAct) {
                        //console.log(`Acting on ${i}`);
                        const controllerData = await actingController.getControllerData();
                        if(controllerData.state == ControllerState.FUNDS_STAKEN) {
                            waitUnlock(hashUpd.transactions[1].now);
                            //console.log(`Recovering loan ${i}`);
                            await elector.sendTickTock("tick");
                            await elector.sendTickTock("tick");
                            const res = await actingController.sendRecoverStake(vSender);
                            expect(res.transactions).toHaveTransaction({
                                from: elector.address,
                                to: actingController.address,
                                op: Op.elector.recover_stake_ok,
                                value: (x) => x! >= sConf.min_stake
                            });
                        }
                        const curElect  = await announceElections();
                        //console.log(`Requesting loan ${i}`);
                        await assertGetLoan(actingController, sConf.min_stake, true);
                        const res = await actingController.sendNewStake(vSender, sConf.min_stake + toNano('1'),
                                                                        validator.keys.publicKey,
                                                                        validator.keys.secretKey,
                                                                        curElect);
                        expect(res.transactions).toHaveTransaction({
                            from: elector.address,
                            to: actingController.address,
                            op: Op.elector.new_stake_ok,
                            success: true
                        });
                        const controllerAfter = await actingController.getControllerData();
                        expect(controllerAfter.state).toEqual(ControllerState.FUNDS_STAKEN);
                    }
                }
            }
            snapStates.set('long_initial', bc.snapshot());
        });
        it('Validator having two controllers should be able to participate in rounds one by one', async() => {
            await loadSnapshot('long_initial');
            // Start with depo
            await Promise.all(depositors.map(async x => await pool.sendDeposit(x.getSender(), toNano('100000'))));
            for (let i = 0; i < 10; i++) {
                await runVdAction(validators[0]);
                await nextRound();
                await pool.sendTouch(deployer.getSender());
                roundId++;
            }
            roundId = 0;
        })
        /*WIP
        it('Pessimistic', async() => {
            await loadSnapshot('long_initial');
            optimistic = false;
            for(let i = 0; i < roundCount; i++) {
                actors = {
                    nms: depositors[Symbol.iterator](),
                    validstors: validators[Symbol.iterator]()
                }
                let nmDone = false;
                // Skip validators actions on first round
                let vdDone = roundId == 0 && !optimistic;

                if(i == 0) {
                    await pool.sendDonate(deployer.getSender(), Conf.finalizeRoundFee);
                }

                do {
                    // Idea of that is that actions doesn't happen sequentially
                    let whoActs: number;
                    if(!(nmDone || vdDone)) {
                        // If both queues are not done, pick at random
                        whoActs = getRandomInt(0,1,3);
                    }
                    else {
                        // Else whichever is not done
                        whoActs = nmDone ? 1 : 0;
                    }

                    if(whoActs == 0) {
                       const nextActor = actors.nms.next();
                       if(!nextActor.done) {
                        await runNmAction(nextActor.value);
                       }
                       else {
                           nmDone = true;
                       }
                    }
                    else {
                       const nextActor = actors.validstors.next();
                       if(!nextActor.done) {
                           await runVdAction(nextActor.value);
                       }
                       else {
                           vdDone = true;
                       }
                    }
                } while(!(nmDone && vdDone));
                await nextRound();
                console.log(`Round:${roundId++}`);
                balance += depoReq + profit;
                depoCount = 0;
                withdrawCount = 0;
                withdrawReq = 0n;
                depoReq = 0n;
                // Meh don't like that, but otherwise all assert functions has to change once again
                await pool.sendTouch(deployer.getSender());
            }
        })
        */
    });
    describe('Bounce', () => {
        it('Should handle controller::credit bounce correctly', async() => {
            await loadSnapshot('deposited');

            // Increasing validator part just in case
            await controller.sendTopUp(validator.wallet.getSender(), toNano('100000'));
            const loanAmount = getRandomTon(10000, 20000);
            const expInterest = loanAmount * BigInt(Conf.testInterest) / Conf.shareBase;
            const reqMsg = internal({
                from: validator.wallet.address,
                to: controller.address,
                body: Controller.requestLoanMessage(loanAmount, loanAmount, Conf.testInterest),
                value: toNano('1')
            });
            const poolBefore = await pool.getFullData();
            const curVset = getVset(bc.config, 34);
            await controller.sendUpdateHash(deployer.getSender());
            if(getCurTime() < curVset.utime_unitl - eConf.begin_before) {
                bc.now = curVset.utime_unitl - eConf.begin_before + 1;
            }
            const txInterator = new Txiterator(bc, reqMsg);
            // Execute until point where pool processed credit request
            const creditTx = await executeTill(txInterator, {
                from: controller.address,
                to: pool.address,
                op: Op.pool.request_loan,
                success: true
            });
            // Make sure pool data changed accordingly
            let poolAfter = await pool.getFullData();
            expect(poolAfter.currentRound.activeBorrowers).toEqual(poolBefore.currentRound.activeBorrowers + 1n);
            expect(poolAfter.currentRound.borrowed).toEqual(poolBefore.currentRound.borrowed + loanAmount);
            expect(poolAfter.currentRound.expected).toEqual(poolBefore.currentRound.expected + loanAmount + expInterest);
            /* Now in reality could trigger controller::credit bounce to pool?
             * Not sure.
             * Either pool address in controller data should change
             * https://github.com/EmelyanenkoK/jetton_pool/blob/main/contracts/controller.func#L178
             * I don't see how that is possible
             * Or, perhaps controller was inactive for a very long time and can't pay for storage.
             * Not likely either, because it won't be able to pass controller solvency checks.
             * Is it ever possible?
             **/
             // Not safe update, but will do for the test
             const newConfig: ControllerConfig = {
                 controllerId: 0,
                 validator: validator.wallet.address,
                 pool: differentAddress(pool.address),
                 governor: deployer.address,
                 approver: deployer.address,
                 halter: deployer.address
             }
             await setContractData(controller.address, controllerConfigToCell(newConfig));

             const txsAfter = await executeFrom(txInterator);
             expect(txsAfter).toHaveTransaction({
                 on: controller.address,
                 from: pool.address,
                 exitCode: Errors.wrong_sender
             });
             expect(txsAfter).toHaveTransaction({
                 on: pool.address,
                 body: (x) => {
                     const bs = x!.beginParse().skip(32);
                     return bs.preloadUint(32) == Op.controller.credit;
                 },
                 inMessageBounced: true,
                 success: true
             });
             poolAfter = await pool.getFullDataRaw();
             expect(poolAfter.currentRound.activeBorrowers).toEqual(poolBefore.currentRound.activeBorrowers);
             //console.log(`Profit after:${poolAfter.currentRound.profit}`);
        });
    });
    describe.skip('Attacks', () => {
    it('Should not fail on total balance = 0 and supply > 0', async() => {
        await loadSnapshot('initial');
        const depositor = await bc.treasury('Depo');
        await pool.sendDonate(deployer.getSender(), Conf.finalizeRoundFee);
        const depoRes   = await assertDeposit(depositor.getSender(), Conf.poolDepositFee + 1n, 0, true);
        let poolData  = await pool.getFullData();
        expect(poolData.totalBalance).toEqual(Conf.finalizeRoundFee);
        expect(poolData.requestedForDeposit).toEqual(1n);
        await nextRound();
        await pool.sendTouch(deployer.getSender());
        // Now credited
        poolData = await pool.getFullData();
        expect(poolData.totalBalance).toEqual(1n);
        expect(poolData.supply).toEqual(1n);
        // Next rotation we would have supply = 1 and balance 0
        // That might trigger division by zero error
        // To trigger pTON distribution we need to deposit some more

        await assertDeposit(depositor.getSender(), Conf.poolDepositFee + 1n, 0, true);
        await nextRound();
        const res = await pool.sendTouch(deployer.getSender());
        expect(res.transactions).not.toHaveTransaction({
            exitCode: 4,
            success: false
        });
    });
    it('Donate DoS', async () => {
        await loadSnapshot('initial');
        const user1  = await bc.treasury('user1');
        const sneaky = await bc.treasury('sneaky');
        // const depo1 = await assertDeposit(user1.getSender(), toNano('100000'), 0, true);
        const amount = toNano('1000');
        const depo1 = await assertDeposit(user1.getSender(), amount, 0, true);
        await pool.sendDonate(deployer.getSender(), Conf.finalizeRoundFee);
        const userJetton = bc.openContract(DAOWallet.createFromAddress(await poolJetton.getWalletAddress(user1.address)));
        // Sneaky doesn't want user to get money so sends some more money after the legit donation
        await pool.sendDonate(sneaky.getSender(), toNano('0.01'));
        const poolData = await pool.getFullData();
        await nextRound();
        // Updating round
        const res = await pool.sendTouch(deployer.getSender());
        const ptonBalance = await userJetton.getJettonBalance();
        // Should never mint 0 pool jettons
        expect(res.transactions).not.toHaveTransaction({
            to: poolJetton.address,
            op: Op.payout.mint,
            body: (x) => testMintMsg(x!, {
                amount: 0n
            })
        });
        // User should get his pTONs
        expect(ptonBalance).toBeGreaterThan(0n);
    });
    });

    describe('Question', () => {
    it('Akifoq 31', async () => {
        await loadSnapshot('deposited');
        let   totalCredit = 0n;
        let   controllerIdx = 1;
        let   roundControllers: SandboxContract<Controller>[] = [];
        const poolBefore = await pool.getFullData();
        const balanceBefore = poolBefore.totalBalance;
        const vSender = validator.wallet.getSender();
        // In current settings will be executed only once, but it may change
        while(totalCredit * 2n < balanceBefore) {
            let res = await pool.sendRequestControllerDeploy(vSender, toNano('50000'), controllerIdx++);
            let newController = getNewController(res.transactions);
            await newController.sendApprove(deployer.getSender());
            let creditable = await getCreditable();
            await assertGetLoan(newController, creditable, true);
            totalCredit += creditable;
        }

        let totalWithdrawn = 0n;
        for (let chunk of depositors) {
            const owner = bc.sender(chunk.address);
            const ownerPton = await getUserJetton(chunk.address);
            await ownerPton.sendBurnWithParams(owner, toNano('1.05'), chunk.amount, chunk.address, false, false);
            totalWithdrawn += chunk.amount;
            if(totalWithdrawn + totalCredit > balanceBefore) {
                break;
            }
        }

        await nextRound();
        const poolAfter = await pool.getFullData();
        expect(poolAfter.halted).toBe(false);
    });
    });
});
