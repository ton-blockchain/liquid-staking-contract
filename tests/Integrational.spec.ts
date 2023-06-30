import { Blockchain,BlockchainSnapshot, BlockchainTransaction, createShardAccount,internal,SandboxContract,SendMessageResult,SmartContractTransaction,TreasuryContract } from "@ton-community/sandbox";
import { Address, Cell, beginCell, toNano, Sender, Dictionary } from 'ton-core';
import { compile } from '@ton-community/blueprint';
import '@ton-community/test-utils';
import { keyPairFromSeed, getSecureRandomBytes, getSecureRandomWords, KeyPair } from 'ton-crypto';
import { JettonMinter as DAOJettonMinter, jettonContentToCell } from '../contracts/jetton_dao/wrappers/JettonMinter';
import { Pool, PoolConfig } from '../wrappers/Pool';
import { Controller } from '../wrappers/Controller';
import { Elector } from "../wrappers/Elector";
import { Config  } from "../wrappers/Config";
import { setConsigliere } from "../wrappers/PayoutMinter.compile";
import { Conf, ControllerState, Errors, Op } from "../PoolConstants";
import { PayoutCollection, Conf as NFTConf } from "../wrappers/PayoutNFTCollection";
import { PayoutItem } from "../wrappers/PayoutNFTItem";
import { testJettonTransfer, buff2bigint, computedGeneric, getRandomTon, testControllerMeta, getExternals, testLog, testLogRepayment, testPayoutMint, assertLog, muldivExtra, testJettonNotification } from "../utils";
import { ElectorTest } from "../wrappers/ElectorTest";
import { getElectionsConf, getStakeConf, getValidatorsConf, getVset, loadConfig, packStakeConf, packValidatorsConf } from "../wrappers/ValidatorUtils";
import { ConfigTest } from "../wrappers/ConfigTest";
import { computeMessageForwardFees, getMsgPrices } from "../fees";
import { getRandomInt, randomAddress } from "../contracts/jetton_dao/tests/utils";
import { PayoutCollectionConfig } from "../wrappers/PayoutNFTCollection";

type Validator = {
  wallet: SandboxContract<TreasuryContract>,
  keys: KeyPair
};

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

    let getContractData:(address: Address) => Promise<Cell>;
    let getContractBalance:(address: Address) => Promise<bigint>;
    let loadSnapshot:(snap:string) => Promise<void>;
    let getCurTime:() => number;
    let getCreditable:() => Promise<bigint>;
    let updateConfig:() => Promise<Cell>;
    let announceElections:() => Promise<number>;
    let runElections:() => Promise<void>;
    let waitNextRound:() => Promise<void>;
    let waitUnlock:(since: number) => void;
    let nextRound:(count?: number, post?:() => Promise<void>) => Promise<void>;
    let assertRoundDeposit: (txs: BlockchainTransaction[],
                             deposit: bigint,
                             balance:bigint,
                             amount: bigint,
                             minterAddr:Address) => Promise<bigint>;
    let assertRound:(txs: BlockchainTransaction[],
                     round:number,
                     deposit: bigint,
                     payout:  bigint,
                     borrowed: bigint,
                     expected: bigint,
                     returned: bigint,
                     supply: bigint,
                     totalBalance: bigint,
                     depositMinter: Address | null,
                     withdrawMinter: Address | null,
                    ) => Promise<bigint>;
    let assertDeposit:(via: Sender, amount: bigint, index:number, new_minter:boolean) => Promise<bigint>;


    beforeAll(async () => {
        bc = await Blockchain.create();
        deployer = await bc.treasury('deployer', {balance: toNano("1000000000")});
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
              consigliere : deployer.address,
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

        await pool.sendDeploy(deployer.getSender(),Conf.minStorage + toNano('1'));

        await poolJetton.sendDeploy(deployer.getSender(), toNano('1.05'));
        await poolJetton.sendChangeAdmin(deployer.getSender(), pool.address);

        loadSnapshot = async (name:string) => {
          const state = snapStates.get(name);
          if(!state)
            throw(Error(`Can't find state ${name}\nCheck tests execution order`));
          await bc.loadFrom(state);
        }

        snapStates = new Map<string, BlockchainSnapshot>();
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
        getContractBalance = async (address: Address) => {
            const smc = await bc.getContract(address);
            return smc.balance;
        };
        getCurTime = () => bc.now ?? Math.floor(Date.now() / 1000);
        getCreditable = async () => {
            const poolData    = await pool.getFullData();
            let cred: bigint;
            if(poolData.totalBalance == poolData.supply) {
                cred = poolData.supply - Conf.minStorage;
            }
            else {
                cred = poolData.requestedForWithdrawal * poolData.totalBalance / poolData.supply;
            }
            return  cred - Conf.minStorage;
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
          else if(curTime < prevElections - eConf.end_before) {
              return prevElections;
          }

          let curElections = prevElections;

          do {
              await elector.sendTickTock("tick");
              curElections = await elector.getActiveElectionId();
          } while(curElections == 0 || prevElections == curElections);

          return curElections;
        }

        runElections = async () => {

          await announceElections();
          // Elector profits
          await bc.sendMessage(internal({
            from: new Address(-1, Buffer.alloc(32, 0)),
            to: elector.address,
            body: beginCell().endCell(),
            value: toNano('100000'),
          }));

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

        nextRound = async (count:number = 1, post?:() => void) => {
            while(count--) {
                await runElections();
                await updateConfig();
                await waitNextRound();
                if(post) {
                    await post()
                }
            }
        };
        assertRoundDeposit = async (txs: BlockchainTransaction[],
                                    deposit:bigint,
                                    supply: bigint,
                                    balance: bigint,
                                    minterAddr: Address) => {
            const amount = muldivExtra(deposit, supply, balance);
            const depositWallet = await poolJetton.getWalletAddress(minterAddr);
            const mintTx = txs.find(x => x.address == buff2bigint(poolJetton.address.hash)
                                    && x.outMessagesCount == 1);
            expect(mintTx).not.toBeUndefined();
            const inMsg = mintTx!.inMessage!;
            // Meh
            if(inMsg.info.type !== "internal" )
                throw(Error("Internal expected"));
            expect(inMsg.info.src).toEqualAddress(pool.address);
            expect(testPayoutMint(inMsg.body, {
                dest: minterAddr,
                amount,
                notification: Conf.notificationAmount,
                forward: 0n
            })).toBe(true);
            const fwdFee = computeMessageForwardFees(msgConf, inMsg);
            const expValue = Conf.notificationAmount + Conf.distributionAmount;
            expect(inMsg.info.value.coins).toBeGreaterThanOrEqual(expValue - fwdFee.fees - fwdFee.remaining);
            expect(computedGeneric(mintTx!).success).toBe(true);

            const dataAfter = await pool.getFullData();
            expect(dataAfter.requestedForDeposit).toEqual(0n);
            expect(dataAfter.supply).toEqual(supply + amount);

            expect(txs).toHaveTransaction({
                from: poolJetton.address,
                to: depositWallet,
                op: Op.jetton.internal_transfer,
                body: (x) => testJettonTransfer(x!, {
                    amount
                }),
                success: true,
            });

            expect(await poolJetton.getTotalSupply()).toEqual(supply + amount);
            expect(txs).toHaveTransaction({
                from: depositWallet,
                to: minterAddr,
                op: Op.jetton.transfer_notification,
                body: (x) => testJettonNotification(x!, {
                    amount
                }),
                success: true
            });
            return amount;
        }
        assertRound   = async (txs: BlockchainTransaction[],
                               round: number,
                               deposit: bigint,
                               payout:  bigint,
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
            if(profit > 0) {
                fee = Conf.governanceFee * profit / 65536n;
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
                    return borrowedSent == borrowed
                           && expectedSent == expected
                           && returnedSent == returned;
                }
            });
            if(deposit > 0n) {
                expect(depositMinter).not.toBe(null);
                supply += await assertRoundDeposit(txs, deposit, supply, totalBalance, depositMinter!);
            }
            if(fee > Conf.serviceNotificationAmount) {
                expect(txs).toHaveTransaction({
                    from: pool.address,
                    to: deployer.address, // Interest manager
                    value: fee - msgConf.lumpPrice // Bit lazy
                });
                sentDuring += fee;
            }
            assertLog(txs, pool.address, 3, {
                round,
                borrowed,
                profit
            });
            // console.log("Asserting round:", round);
            // assertLog(txs, pool.address, 4, round);

            return sentDuring;
        }
        assertDeposit = async (via: Sender, amount: bigint, index: number, new_round: boolean) => {
            const dataBefore = await pool.getFullData();
            let   minter: SandboxContract<PayoutCollection> | undefined = undefined;
            let   billBefore: Awaited<ReturnType<PayoutCollection['getTotalBill']>> | null;
            if(!new_round) {
                minter     = bc.openContract(await pool.getDepositMinter());
                billBefore = await minter.getTotalBill();
            }
            else {
                billBefore = null;
            }
            const res    = await pool.sendDeposit(via, amount);
            const newMinter = bc.openContract(await pool.getDepositMinter());
            //console.log("Minter:", newMinter);
            // Just in case
            expect(res.transactions).not.toHaveTransaction({
                success: false
            });
            if(new_round) {
                expect(res.transactions).toHaveTransaction({
                    from: pool.address,
                    to: newMinter.address,
                    op: Op.payout.init,
                    initCode: payout_minter_code,
                    deploy: true,
                    success: true
                });
            }
            else {
                const same_minter = minter!.address.equals(newMinter.address);
                expect(same_minter).toBe(!new_round);

                expect(res.transactions).not.toHaveTransaction({
                    from: pool.address,
                    to: newMinter.address,
                    op: Op.payout.init,
                    deploy: true
                });
            }

            minter = newMinter;
            const item   = bc.openContract(
                PayoutItem.createFromAddress(await minter.getNFTAddress(BigInt(index))
            ));
            expect(res.transactions).toHaveTransaction({
                from: pool.address,
                to: minter.address,
                op: Op.payout.mint,
                body: (x) => testPayoutMint(x!, {
                    dest: via.address,
                    amount: amount- Conf.poolDepositFee,
                    notification: NFTConf.transfer_notification_amount
                }),
                success: true
            });
            expect(res.transactions).toHaveTransaction({
                from: minter.address,
                to: item.address,
                deploy: true,
                success: true
            });
            const itemData = await item.getNFTData();
            expect(itemData.collection).toEqualAddress(minter.address);
            expect(itemData.index).toEqual(index);
            expect(itemData.inited).toBe(true);
            expect(itemData.owner).toEqualAddress(via.address!);
            expect(await item.getBillAmount()).toEqual(amount - Conf.poolDepositFee);

            const dataAfter = await pool.getFullData();
            const expDepo   = amount - Conf.poolDepositFee;
            expect(dataAfter.requestedForDeposit).toEqual(dataBefore.requestedForDeposit + expDepo);
            expect(dataAfter.totalBalance).toEqual(dataBefore.totalBalance);
            expect(dataAfter.depositPayout).toEqualAddress(minter.address);
            if(!new_round) {
                const billAfter = await minter.getTotalBill();
                expect(billAfter.billsCount).toEqual(billBefore!.billsCount + 1n);
                expect(billAfter.totalBill).toEqual(billBefore!.totalBill + expDepo);
            }
            return dataAfter.requestedForDeposit;
        }
    });

    it('Deploy controller', async () => {
        const res = await pool.sendRequestControllerDeploy(validator.wallet.getSender(), Conf.minStorage + toNano('1'), 0);
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
        snapStates.set('initial', bc.snapshot());
    });
    it.only('Single deposit', async () => {
        let deposited: bigint;
        const roundCount = 3; // Limited by depositors balance

        const depoCount = getRandomInt(5, 10);
        const depositors = await bc.createWallets(depoCount);
        expect((await pool.getFullData()).totalBalance).toEqual(0n);
        await pool.sendDonate(deployer.getSender(), Conf.finalizeRoundFee);
        expect((await pool.getFullData()).totalBalance).toEqual(Conf.finalizeRoundFee);
        const depo   = getRandomTon(150000, 200000);
        const depositor = await bc.treasury('Depo:0');
        await assertDeposit(depositor.getSender(), depo, 0, true);
        const poolData  = await pool.getFullData();
        await nextRound();
        const res = await pool.sendTouch(deployer.getSender());
        await assertRound(res.transactions,
                          0,
                          poolData.requestedForDeposit,
                          poolData.requestedForWithdrawal,
                          0n,
                          0n,
                          0n,
                          0n,
                          poolData.supply,
                          poolData.depositPayout,
                          poolData.withdrawalPayout);
        // expect(res.transactions).not.toHaveTransaction({success: false});
    });
    it('Deposit to pool', async () => {
        let deposited: bigint;
        const roundCount = 3; // Limited by depositors balance

        const depoCount = getRandomInt(5, 10);
        const depositors = await bc.createWallets(depoCount);
        expect((await pool.getFullData()).totalBalance).toEqual(0n);
        await pool.sendDonate(deployer.getSender(), Conf.finalizeRoundFee);
        expect((await pool.getFullData()).totalBalance).toEqual(Conf.finalizeRoundFee);
        for( let i = 0; i < roundCount; i++ ) {
            const roundDepo: SandboxContract<TreasuryContract>[] = [];
            for(let k = 0; k < depoCount; k++) {
                const depo   = getRandomTon(150000, 200000);
                const depositor  = depositors[k];
                deposited = await assertDeposit(depositor.getSender(), depo, k, k == 0);
            }
            await nextRound();
            const res = await pool.sendTouch(deployer.getSender());
            const poolData = await pool.getFullData();
            console.log("Pool minter:", poolData.poolJettonMinter);
            console.log(res);
            expect(res.transactions).not.toHaveTransaction({success: false});
            // Start from 1 next round index
            assertLog(res.transactions, pool.address, 4, i + 2);
            // Previous loan round idx
            // assertRound(res.transactions, i, 0n, 0n, - Conf.finalizeRoundFee);
        }

        // Push into global depositors matrix
        // depositors.push(roundDepo);
    });
    it('First round rotation and deposit creditation', async () => {
        const dataBefore = await pool.getFullData();
        await nextRound();
        await pool.sendTouch(deployer.getSender());
        const dataAfter = await pool.getFullData();
        expect(dataAfter.totalBalance).toEqual(dataBefore.totalBalance + dataBefore.requestedForDeposit);
        expect(dataAfter.currentRound.roundId).toEqual(dataBefore.currentRound.roundId + 1);
        expect(dataAfter.previousRound).toEqual(dataBefore.currentRound);
        expect(dataAfter.requestedForDeposit).toEqual(0n);
    });
    it('Request loan from controller', async () => {
        const curVset = getVset(bc.config, 34);
        if(getCurTime() < curVset.utime_unitl - eConf.begin_before) {
            bc.now = curVset.utime_unitl - eConf.begin_before + 1;
        }
        let   maxLoan = getRandomTon(350000, 500000);
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

        const expInterest = creditable * BigInt(poolData.interestRate) / 65535n;
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
                const maxInterestSent = rs.loadUint(16);
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
            }
        });
        // Loan response
        const poolCreditTrans = res.transactions.find(x => buff2bigint(controller.address.hash) == x.address && x.outMessagesCount == 0)!;

        expect(poolCreditTrans).not.toBeUndefined();
        expect(poolCreditTrans.parent).not.toBeUndefined();
        expect(computedGeneric(poolCreditTrans).success).toBe(true);
        const creditMsg = poolCreditTrans.inMessage!;
        if(creditMsg.info.type !== "internal")
            throw(Error("Can't be"));

        const fwdFee      = computeMessageForwardFees(msgConf, creditMsg);

        expect(creditMsg.info.value.coins).toEqual(creditable - fwdFee.fees - fwdFee.remaining);
        const bs = creditMsg.body.beginParse();
        expect(bs.loadUint(32)).toEqual(Op.controller.credit);
        bs.skip(64);
        expect(bs.loadCoins()).toEqual(creditable + expInterest);
        const controllerData = await controller.getControllerData();
        expect(controllerData.borrowedAmount).toEqual(creditable + expInterest);
        expect(controllerData.borrowingTime).toEqual(poolCreditTrans.parent!.now);
        assertLog(res.transactions, pool.address, 1, {
            lender: controller.address,
            amount: creditable
        });
    });
    it('Controller deposit to elector', async () => {
        const controllerData = await controller.getControllerData();
        const curElect = await announceElections();
        const res      = await controller.sendNewStake(validator.wallet.getSender(),
                                                       controllerData.borrowedAmount,
                                                       validator.keys.publicKey,
                                                       validator.keys.secretKey,
                                                       curElect);
        expect(res.transactions).toHaveTransaction({
            from: elector.address,
            to: controller.address,
            op: Op.elector.new_stake_ok
        });
        const stake = await elector.getStake(validator.keys.publicKey);
        expect(stake).toEqual(controllerData.borrowedAmount - toNano('1'));
    });
    it('Next elections round and profit return', async () => {
        await nextRound(3, async () => {
            await controller.sendUpdateHash(validator.wallet.getSender());
            await pool.sendTouch(deployer.getSender());
        });

        const controllerData = await controller.getControllerData();
        const dataBefore     = await pool.getFullData();
        const curLoan        = await pool.getLoan(0, validator.wallet.address, true);

        expect(curLoan.borrowed).toBeGreaterThan(0n);
        expect(curLoan.interestAmount).toBeGreaterThan(0n);

        const res = await controller.sendRecoverStake(validator.wallet.getSender());
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
            value: (x) => x == controllerData.borrowedAmount,
            success: true
        });
        assertLog(res.transactions, pool.address, 2, {
            lender: controller.address,
        });

        expect(await pool.getLoan(0, validator.wallet.address, true)).toEqual({
            borrowed: 0n,
            interestAmount: 0n
        });
    });
});
