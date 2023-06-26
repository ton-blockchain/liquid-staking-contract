import { Blockchain,BlockchainSnapshot, createShardAccount,internal,SandboxContract,SendMessageResult,SmartContractTransaction,TreasuryContract } from "@ton-community/sandbox";
import { Address, Cell, beginCell, toNano } from 'ton-core';
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
import { testJettonTransfer, buff2bigint, computedGeneric, getRandomTon, testControllerMeta } from "../utils";
import { ElectorTest } from "../wrappers/ElectorTest";
import { getElectionsConf, getStakeConf, getValidatorsConf, getVset, loadConfig, packStakeConf, packValidatorsConf } from "../wrappers/ValidatorUtils";
import { ConfigTest } from "../wrappers/ConfigTest";
import { computeMessageForwardFees, getMsgPrices } from "../fees";

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
    let loadSnapshot:(snap:string) => Promise<void>;
    let getCurTime:() => number;
    let updateConfig:() => Promise<Cell>;
    let runElections:() => Promise<void>;
    let waitNextRound:() => Promise<void>;
    let nextRound:() => Promise<void>;


    beforeAll(async () => {
        bc = await Blockchain.create();
        deployer = await bc.treasury('deployer', {balance: toNano("1000000000")});
        controller_code = await compile('Controller');
        pool_code = await compile('Pool');
        await setConsigliere(deployer.address);
        payout_minter_code = await compile('PayoutMinter');
        payout_wallet_code = await compile('PayoutWallet');
        dao_minter_code = await compile('DAOJettonMinter');
        dao_wallet_code = await compile('DAOJettonWallet');
        dao_vote_keeper_code = await compile('DAOVoteKeeper');
        dao_voting_code = await compile('DAOVoting');
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
              payout_wallet_code : payout_wallet_code,
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
        getCurTime = () => bc.now ?? Math.floor(Date.now() / 1000);
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
        }

        runElections = async () => {

          const curVset = getVset(bc.config, 34);
          const electBegin = curVset.utime_unitl - eConf.begin_before + 1;

          bc.now = getCurTime();
          if(bc.now < electBegin) {
              bc.now = electBegin;
          }

          let prevElections = await elector.getActiveElectionId();
          let curElections: number;
          do {
              await elector.sendTickTock("tick");
              curElections = await elector.getActiveElectionId();
          } while(curElections == 0 || prevElections == curElections);

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
            const res       = await elector.sendNewStake(validator.wallet.getSender(),
                                                         stakeSize,
                                                         validator.wallet.address,
                                                         validator.keys.publicKey,
                                                         validator.keys.secretKey,
                                                         electState.elect_at);
            expect(res.transactions).not.toHaveTransaction({
              from: elector.address,
              to: validator.wallet.address,
              op: 0xee6f454c
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
          electState     = await elector.getParticipantListExtended();
          expect(electState.finished).toBe(true);
          // Updating active vset
          await elector.sendTickTock("tock");
        }

        nextRound = async () => {
            await runElections();
            await updateConfig();
            await waitNextRound();
        };
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
    });
    it('Deposit to pool', async () => {
        const depo   = getRandomTon(300000, 500000);
        const dataBefore = await pool.getFullData();
        const res    = await pool.sendDeposit(deployer.getSender(), depo);
        const minter = bc.openContract(await pool.getDepositMinter());
        const wallet = await minter.getWalletAddress(deployer.address);
        expect(res.transactions).toHaveTransaction({
            from: minter.address,
            to: wallet,
            body: (x) => {
                return testJettonTransfer(x!, {
                    amount: depo - Conf.poolDepositFee,
                    from: null,
                    to: null
                });
            }
        });
        expect(res.transactions).toHaveTransaction({
            from: wallet,
            to: deployer.address,
            op: Op.jetton.transfer_notification,
            success: true
        });

        const dataAfter = await pool.getFullData();
        expect(dataAfter.requestedForDeposit).toEqual(dataBefore.requestedForDeposit + depo - Conf.poolDepositFee);
        expect(dataAfter.totalBalance).toEqual(dataBefore.totalBalance);
        expect(dataAfter.depositPayout).toEqualAddress(minter.address);
        snapStates.set('initial', bc.snapshot());
    });
    it('First round rotation and deposit creditation', async () => {
        const dataBefore = await pool.getFullData();
        await nextRound();
        await pool.sendTouch(deployer.getSender());
        const dataAfter = await pool.getFullData();
        expect(dataAfter.totalBalance).toEqual(dataBefore.totalBalance + dataBefore.requestedForDeposit);
        expect(dataAfter.currentRound.roundId).toEqual(dataBefore.currentRound.roundId + 1);
        expect(dataAfter.previousRound).toEqual(dataBefore.currentRound);
    });
    it('Request loan from controller', async () => {
        let   curTime = getCurTime();
        const curVset = getVset(bc.config, 34);
        if(curTime < curVset.utime_unitl - eConf.begin_before) {
            bc.now = curVset.utime_unitl - eConf.begin_before + 1;
        }
        const minLoan = getRandomTon(100000, 150000);
        const maxLoan = getRandomTon(150001, 200000);
        const maxInterest = Math.floor(0.05 * 65535);
        const reqBalance  = await controller.getBalanceForLoan(maxLoan, maxInterest);
        const controllerSmc     = await bc.getContract(controller.address);
        if(controllerSmc.balance < reqBalance) {
            const delta = reqBalance - controllerSmc.balance;
            await controller.sendTopUp(validator.wallet.getSender(), delta + toNano('1'));
        }

        const poolData = await pool.getFullData();
        curTime        = getCurTime(); // Update in case anything ticks
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
                const minLoanSent = rs.loadCoins();
                const maxLoanSent = rs.loadCoins();
                const maxInterestSent = rs.loadUint(16);
                const requestMatch = 
                    minLoanSent == minLoan &&
                    maxLoanSent == maxLoan &&
                    maxInterestSent == maxInterest;
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
        const expInterest = maxLoan * BigInt(poolData.interestRate) / 65535n;

        expect(creditMsg.info.value.coins).toEqual(maxLoan - fwdFee.fees - fwdFee.remaining);
        const bs = creditMsg.body.beginParse();
        expect(bs.loadUint(32)).toEqual(Op.controller.credit);
        bs.skip(64);
        expect(bs.loadCoins()).toEqual(maxLoan + expInterest);
        const controllerData = await controller.getControllerData();
        expect(controllerData.borrowedAmount).toEqual(maxLoan + expInterest);
        expect(controllerData.borrowingTime).toEqual(poolCreditTrans.parent!.now);
    });
    it('Controller deposit to elector', async () => {
        const controllerData = await controller.getControllerData();
    });
});
