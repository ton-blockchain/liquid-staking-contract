import { Blockchain,BlockchainSnapshot, createShardAccount,internal,SandboxContract,SendMessageResult,TreasuryContract } from "@ton-community/sandbox";
import { Controller, controllerConfigToCell } from '../wrappers/Controller';
import { Address, Sender, Cell, toNano, Dictionary, beginCell } from 'ton-core';
import { keyPairFromSeed, getSecureRandomBytes, getSecureRandomWords, KeyPair } from 'ton-crypto';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { randomAddress } from "@ton-community/test-utils";
import { getElectionsConf, getValidatorsConf, getVset, loadConfig, packValidatorsSet } from "../wrappers/ValidatorUtils";
import { buff2bigint, differentAddress, getMsgExcess, getRandomTon } from "../utils";
import { Conf, ControllerState, Errors, Op } from "../PoolConstants";
import { computeMessageForwardFees, getMsgPrices } from "../fees";

type Validator = {
  wallet: SandboxContract<TreasuryContract>,
  keys: KeyPair
};


describe('Cotroller mock', () => {
    let bc: Blockchain;
    let controller_code:Cell;
    let controller:SandboxContract<Controller>;
    let validator:Validator;
    let deployer:SandboxContract<TreasuryContract>;
    let electorAddress:Address;
    let poolAddress:Address;
    let InitialState:BlockchainSnapshot;
    // let vConf : ReturnType<typeof getValidatorsConf>;
    let eConf : ReturnType<typeof getElectionsConf>;
    let msgConfMc:ReturnType<typeof getMsgPrices>;
    let msgConfBc:ReturnType<typeof getMsgPrices>;
    let randVset:() => Cell;
    let snapStates:Map<string,BlockchainSnapshot>
    let loadSnapshot:(snap:string) => Promise<void>;
    let getContractData:(smc:Address) => Promise<Cell>;
    let getControllerState:() => Promise<Cell>;
    let getCurTime:() => number;
    let assertHashUpdate:(exp_hash: Buffer | bigint, exp_time:number, exp_count:number) => Promise<void>;
    let testApprove:(exp_code:number, via:Sender, approve:boolean) => Promise<SendMessageResult>;
    let testRequestLoan:(exp_code: number,
                         via: Sender,
                         min_loan: bigint,
                         max_loan:bigint,
                         interest: number) => Promise<SendMessageResult>;
    let testNewStake:(exp_code:number,
                      via:Sender,
                      stake_val:bigint,
                      query_id?:bigint | number,
                      value?:bigint) => Promise<void>;


    beforeAll(async () => {
        bc = await Blockchain.create();
        deployer = await bc.treasury('deployer', {balance: toNano("1000000000")});
        controller_code = await compile('Controller');
        validator = {
            wallet: await bc.treasury('validator'),
            keys: keyPairFromSeed(await getSecureRandomBytes(32))
        };
        electorAddress = Address.parse('Ef8zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM0vF')
        poolAddress    = randomAddress(-1);

        let controllerConfig = {
          controllerId:0,
          validator: validator.wallet.address,
          pool: poolAddress,
          governor: deployer.address,
          approver: deployer.address,
          halter: deployer.address,
        };

        eConf      = getElectionsConf(bc.config);
        // Basechain message config
        msgConfBc  = getMsgPrices(bc.config, 0);
        // Masterchain message config
        msgConfMc  = getMsgPrices(bc.config, -1);
        controller = bc.openContract(Controller.createFromConfig(controllerConfig, controller_code));
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

        getControllerState = async () => await getContractData(controller.address);

        getCurTime = () => bc.now ?? Math.floor(Date.now() / 1000);

        assertHashUpdate = async (exp_hash:Buffer | bigint, exp_time:number, exp_count:number) => {
          const curData  = await controller.getControllerData();
          const testHash = exp_hash instanceof Buffer ? buff2bigint(exp_hash) : exp_hash; 
          expect(curData.validatorSetHash).toEqual(testHash);
          expect(curData.validatorSetChangeTime).toEqual(exp_time);
          expect(curData.validatorSetChangeCount).toEqual(exp_count);
        };

        randVset = () => {
          const confDict = loadConfig(bc.config);
          const vset = getVset(confDict, 34);
          if(!bc.now)
            bc.now = Math.floor(Date.now() / 1000);
          vset.utime_since = bc.now
          vset.utime_unitl = vset.utime_since + eConf.elected_for;
          const newSet = packValidatorsSet(vset);
          bc.now += 100;
          confDict.set(34, newSet);
          bc.setConfig(beginCell().storeDictDirect(confDict).endCell());
          return newSet;
        }

        loadSnapshot = async (name:string) => {
          const state = snapStates.get(name);
          if(!state)
            throw(Error(`Can't find state ${name}\nCheck tests execution order`));
          await bc.loadFrom(state);
        }

        testApprove  = async (exp_code:number, via: Sender, approve:boolean) => {
          const stateBefore = await getContractData(controller.address);
          const approveBefore = (await controller.getControllerData()).approved;
          expect(approveBefore).not.toEqual(approve);
          const res = await controller.sendApprove(via, approve);
          expect(res.transactions).toHaveTransaction({
            from: via.address!,
            to: controller.address,
            success: exp_code == 0,
            exitCode: exp_code
          });

          if(exp_code != 0) {
            expect(await getContractData(controller.address)).toEqualCell(stateBefore);
          }
          else {
            expect((await controller.getControllerData()).approved).toEqual(approve);
          }
          return res;
        };

        testRequestLoan = async (exp_code: number,
                                 via: Sender,
                                 min_loan: bigint,
                                 max_loan: bigint,
                                 interest: number) => {

          const stateBefore = await getControllerState();

          const res = await controller.sendRequestLoan(via, min_loan, max_loan, interest);
          expect(res.transactions).toHaveTransaction({
            from: via.address!,
            to: controller.address,
            success: exp_code == 0,
            exitCode: exp_code
          });
          if(exp_code != 0)
            expect(await getControllerState()).toEqualCell(stateBefore);
          return res;
        }


        testNewStake = async (exp_code: number,
                              via:Sender,
                              stake_val:bigint,
                              query_id:bigint | number = 1,
                              value?:bigint) => {

            const dataBefore = await getContractData(controller.address);
            const electId    = 12345; // Mock id await elector.getActiveElectionId();
            const res        = await controller.sendNewStake(via,
                                                       stake_val,
                                                       validator.keys.publicKey,
                                                       validator.keys.secretKey,
                                                       electId,
                                                       1 << 16,
                                                       0n,
                                                       query_id,
                                                       value)
            expect(res.transactions).toHaveTransaction({
              from: via.address,
              to: controller.address,
              success: exp_code == 0,
              exitCode: exp_code,
            });
            if(exp_code != 0) {
              expect(res.transactions).not.toHaveTransaction({
                from: controller.address,
                to: electorAddress
              });
              const dataAfter = await getContractData(controller.address);
              expect(dataBefore.equals(dataAfter)).toBe(true);
            }
            else {
              expect(res.transactions).toHaveTransaction({
                from: controller.address,
                to: electorAddress
              });
            }
        };

        // Deploying controller
        await controller.sendDeploy(deployer.getSender());
        // Set validator set to adequate time values
        randVset();
        InitialState = bc.snapshot();
        snapStates = new Map<string, BlockchainSnapshot>();
    });

    afterEach(async () => {
        await bc.loadFrom(InitialState);
    });

    it('Controller credit should only be accepted from pool address', async() => {
      const notPool = differentAddress(poolAddress);
      const stateBefore  = await getContractData(controller.address);
      const borrowAmount = getRandomTon(100000, 200000)
      // 2000 TON interest
      const msgVal       = borrowAmount + toNano('2000');
      let res = await controller.sendCredit(bc.sender(notPool), borrowAmount, msgVal);
      expect(res.transactions).toHaveTransaction({
        from: notPool,
        to: controller.address,
        success: false,
        exitCode: Errors.wrong_sender
      });

      expect(await getContractData(controller.address)).toEqualCell(stateBefore);

      res = await controller.sendCredit(bc.sender(poolAddress), borrowAmount, msgVal);
      expect(res.transactions).toHaveTransaction({
        from: poolAddress,
        to: controller.address,
        success: true
      });
    });

    it('Should account for controller credit', async () => {
      const borrowAmount = getRandomTon(100000, 200000);
      const interest     = getRandomTon(1000, 2000);
      const msgVal       = borrowAmount + interest;
      const stateBefore  = await controller.getControllerData();

      const borrowTime = bc.now ?? Math.floor(Date.now() / 1000);
      const res = await controller.sendCredit(bc.sender(poolAddress), borrowAmount, msgVal);
      const stateAfter = await controller.getControllerData();
      expect(stateAfter.borrowedAmount).toEqual(stateBefore.borrowedAmount + borrowAmount);
      expect(stateAfter.borrowingTime).toEqual(borrowTime);
      expect(stateAfter.state).toEqual(ControllerState.REST);
      snapStates.set('borrowed', bc.snapshot());
    });
    it('Approve should only be accepted from approver address', async () => {
      const notApprover  = differentAddress(deployer.address);
      await testApprove(Errors.wrong_sender, bc.sender(notApprover), true);
    });

    it('Approve from approver address should set approve flag', async () => {
      await testApprove(0, deployer.getSender(), true);
      snapStates.set('approved', bc.snapshot());
    });
    it('Disapprove should only be accepted from approver address', async () => {
      await loadSnapshot('approved');
      const notApprover  = differentAddress(deployer.address);
      await testApprove(Errors.wrong_sender, bc.sender(notApprover), false);
    });
    it('Disapprove from approver address should unset approve flag', async () => {
      await loadSnapshot('approved');
      await testApprove(0, deployer.getSender(), false)
    });
 
    describe('Request loan', () => {
      const interest = Math.floor(0.05 * 65535);
      let approved : BlockchainSnapshot;
      let reqReady : BlockchainSnapshot;

      it('Successfull loan request', async () => {
        const dataBefore = await controller.getControllerData();
        const curVset  = getVset(bc.config, 34);
        const electStarted = curVset.utime_unitl - eConf.begin_before + 1;
        const minLoan      = toNano('100000');
        const maxLoan      = minLoan * 2n;
        if(getCurTime() < electStarted)
          bc.now = curVset.utime_unitl - eConf.begin_before + 1;
        if(!dataBefore.approved)
          await controller.sendApprove(deployer.getSender(), true);

        reqReady = bc.snapshot();

        const controllerSmc = await bc.getContract(controller.address);
        const reqBalance    = await controller.getBalanceForLoan(maxLoan, interest);
        if(controllerSmc.balance < reqBalance)
          await controller.sendDeploy(deployer.getSender(),
                                      reqBalance - controllerSmc.balance + toNano('1'));


        const res = controllerSmc.receiveMessage(internal({
          from: validator.wallet.address,
          to: controller.address,
          body: Controller.requestLoanMessage(minLoan, maxLoan, interest),
          value: toNano('1')
        }),{now: bc.now});

        expect(res.outMessagesCount).toEqual(1);
        const reqMsg    = res.outMessages.get(0)!;
        if(reqMsg.info.type !== "internal")
          throw Error("Should be internal");
        expect(reqMsg.body.beginParse().preloadUint(32)).toEqual(Op.pool.request_loan);

        const dataAfter = await controller.getControllerData();
        expect(dataAfter.state).toEqual(ControllerState.SENT_BORROWING_REQUEST);
        snapStates.set('borrowing_req', bc.snapshot());
      });
      it('Only validator can request loan', async () => {
        const interest = Math.floor(0.05 * 65535);
        await testRequestLoan(Errors.wrong_sender,
                              deployer.getSender(),
                              toNano('100000'),
                              toNano('200000'),
                              interest);

      });
      it('Controller should not be able to borrow, unless approved', async () => {
        const dataBefore  = await controller.getControllerData();
        const stateBefore = await getControllerState();
        expect(dataBefore.approved).toEqual(false);

        let res = await controller.sendRequestLoan(validator.wallet.getSender(),
                                                   toNano('100000'),
                                                   toNano('200000'),
                                                   interest);
        expect(res.transactions).toHaveTransaction({
          from: validator.wallet.address,
          to: controller.address,
          success: false,
          exitCode: Errors.controller_not_approved
        });

        expect(await getControllerState()).toEqualCell(stateBefore);

        await controller.sendApprove(deployer.getSender(), true);
        approved = bc.snapshot();

        res = await controller.sendRequestLoan(validator.wallet.getSender(),
                                               toNano('100000'),
                                               toNano('200000'),
                                               interest);
        expect(res.transactions).not.toHaveTransaction({
          from: validator.wallet.address,
          to: controller.address,
          success: false,
          exitCode: Errors.controller_not_approved
        });
      });
      it('Loan should be requested after elections start', async () => {
        await bc.loadFrom(approved);

        const stateBefore = await getControllerState();
        const curVset  = getVset(bc.config, 34);
        bc.now = curVset.utime_unitl - eConf.begin_before;

        const res = await controller.sendRequestLoan(validator.wallet.getSender(),
                                                     toNano('100000'),
                                                     toNano('200000'),
                                                     interest);
        expect(res.transactions).toHaveTransaction({
          from: validator.wallet.address,
          to: controller.address,
          success: false,
          exitCode: Errors.too_early_loan_request
        });
        expect(await getControllerState()).toEqualCell(stateBefore);
      });
      it('Loan should not be requested after elections end', async () => {
        await bc.loadFrom(approved);

        const stateBefore = await getControllerState();
        const curVset  = getVset(bc.config, 34);
        bc.now = curVset.utime_unitl - eConf.end_before;

        const res = await controller.sendRequestLoan(validator.wallet.getSender(),
                                                     toNano('100000'),
                                                     toNano('200000'),
                                                     interest);
        expect(res.transactions).toHaveTransaction({
          from: validator.wallet.address,
          to: controller.address,
          success: false,
          exitCode: Errors.too_late_loan_request
        });
        expect(await getControllerState()).toEqualCell(stateBefore);
      });
      it('Should not be able to request loan if previous loan is not returned yet', async () => {
        await loadSnapshot('borrowed');

        const dataBefore  = await controller.getControllerData();
        if(!dataBefore.approved)
          await controller.sendApprove(deployer.getSender(), true);

        await testRequestLoan(Errors.multiple_loans_are_prohibited,
                              validator.wallet.getSender(),
                              toNano('100000'),
                              toNano('200000'),
                              interest);
      });
      it('Loan requirements should change accordingly to interest passed', async () => {
        const minLoan = getRandomTon(50000, 100000);
        const maxLoan = getRandomTon(200000, 300000);

        const controllerSmc = await bc.getContract(controller.address);
        const baseReq       = await controller.getBalanceForLoan(maxLoan, interest);

        // Test that changes of interest changes required balance
        let   higherInterest = BigInt(interest * 2);
        let   higherReq      = await controller.getBalanceForLoan(maxLoan, higherInterest);
        let   expStakeGrow   = maxLoan * BigInt(interest) / 65535n;
        expect(higherReq).toBeGreaterThan(baseReq);
        expect(higherReq - baseReq).toEqual(expStakeGrow);
      });
      it('Loan requirements should change accordingly to validator punishment', async () => {
        const minLoan = getRandomTon(50000, 100000);
        const maxLoan = getRandomTon(200000, 300000);

        const controllerSmc = await bc.getContract(controller.address);
        const baseReq       = await controller.getBalanceForLoan(maxLoan, interest);

        // Test that changing punishment configuration changes resulting requirements
        const punishmentBase   = maxLoan + controllerSmc.balance;
        const punishmentBefore = await controller.getMaxPunishment(punishmentBase);
        const confDict = loadConfig(bc.config);
        confDict.set(40, beginCell()
                         .storeUint(1, 8) //prefix
                         .storeCoins(toNano('5000')) //Default flat fine
                         .storeUint((1 << 32) - 1, 32) // All of the stake
                         .storeUint(256, 16)
                         .storeUint(256, 16)
                         .storeUint(0, 16)
                         .storeUint(0, 16)
                         .storeUint(256, 16)
                         .storeUint(256, 16)
                        .endCell())
        bc.setConfig(beginCell().storeDictDirect(confDict).endCell());
        const punishmentAfter = await controller.getMaxPunishment(punishmentBase);
        expect(punishmentAfter).toBeGreaterThan(punishmentBefore);

        const higherReq = await controller.getBalanceForLoan(maxLoan, interest);
        expect(higherReq).toBeGreaterThan(baseReq);
        // Compare deltas
        expect(higherReq - baseReq).toEqual(punishmentAfter - punishmentBefore);
      });
      it('Controller should have enough balance to apply for loan', async () => {
        await bc.loadFrom(reqReady);

        const maxLoan = toNano('200000');

        const controllerSmc  = await bc.getContract(controller.address);
        const balanceForLoan = await controller.getBalanceForLoan(maxLoan, interest);
        expect(controllerSmc.balance).toBeLessThan(balanceForLoan);

        await testRequestLoan(Errors.too_high_loan_request_amount,
                              validator.wallet.getSender(),
                              toNano('100000'),
                              maxLoan,
                              interest);
        const delta = balanceForLoan - controllerSmc.balance;
        await controller.sendDeploy(deployer.getSender(), delta + toNano('1'));

        await testRequestLoan(0,
                              validator.wallet.getSender(),
                              toNano('100000'),
                              maxLoan,
                              interest);

      });
      it('Request loan bounce should only be accepted from pool address', async () => {
        await loadSnapshot('borrowing_req');
        const dataBefore = await controller.getControllerData();

        const res = await bc.sendMessage(internal({
          from: differentAddress(poolAddress),
          to: controller.address,
          body: beginCell().storeUint(0xFFFFFFFF, 32)
                           .storeUint(Op.pool.request_loan, 32)
                           .storeUint(0, 64)
                .endCell(),
          value: toNano('1'),
          bounced: true
        }));
        const dataAfter = await controller.getControllerData();
        expect(dataAfter.state).toEqual(dataBefore.state);
      });
      it('Request loan bounce handling', async () => {
        await loadSnapshot('borrowing_req');
        const res = await bc.sendMessage(internal({
          from: poolAddress,
          to: controller.address,
          body: beginCell().storeUint(0xFFFFFFFF, 32)
                           .storeUint(Op.pool.request_loan, 32)
                           .storeUint(0, 64)
                .endCell(),
          value: toNano('1'),
          bounced: true
        }));
        const dataAfter = await controller.getControllerData();
        expect(dataAfter.state).toEqual(ControllerState.REST);
      });
    });

    describe('New stake', () => {
      beforeEach(async () => loadSnapshot('borrowed'));
      it('Not validator should not be able to deposit to elector', async() => {
        const deposit    = toNano('100000');
        const randWallet = differentAddress(validator.wallet.address);
        await testNewStake(Errors.wrong_sender, bc.sender(randWallet), deposit);
      });

      it('Pool should only accept new elector stake with confirmation', async() =>{
        const deposit    = toNano('100000');
        // 0 query id means no confirmation
        await testNewStake(Errors.newStake.query_id, validator.wallet.getSender(), deposit, 0);
      });

      it('New stake message value should exceed elector fee', async () => {
        const deposit    = toNano('100000');
        const value      = Conf.electorOpValue;
        await testNewStake(Errors.newStake.request_value, validator.wallet.getSender(), deposit, 1234, value - 1n);
        await testNewStake(0, validator.wallet.getSender(), deposit);
      });

      it('New stake should exceed minimal stake', async () => {
        const deposit = Conf.minStake - 1n;
        await testNewStake(Errors.newStake.value_lt_minimum, validator.wallet.getSender(), deposit);
      });

      it('New stake too high', async () => {
        // tripple hash update cost
        const overDue   = (Conf.hashUpdateFine * 3n) - Conf.stakeRecoverFine;
        const minAmount = Conf.minStorage + overDue;
        const balance   = (await bc.getContract(controller.address)).balance;
        const msgVal    = toNano('10');
        const maxPossible = balance + msgVal - minAmount;
        const vset = getVset(bc.config, 34);
        await testNewStake(Errors.newStake.value_too_high,
                           validator.wallet.getSender(),
                           maxPossible + 1n,
                           12345, // query_id
                           msgVal);

        await testNewStake(0,
                           validator.wallet.getSender(),
                           maxPossible,
                           12345,
                           msgVal);
      });
      it('New stake wrong round', async () => {
        const deposit    = toNano('100000');
        // We have to do that because we can't roll time back without emulator account timestamp error
        await bc.loadFrom(InitialState);
        const curSet = getVset(bc.config, 34);
        // Too early
        bc.now = curSet.utime_since;
        await controller.sendCredit(bc.sender(poolAddress), toNano('200000'), toNano('201000'));
        await testNewStake(Errors.newStake.wrongly_used_credit,
                           validator.wallet.getSender(),
                           deposit);

        // Elections already ended
        bc.now = curSet.utime_unitl - eConf.end_before;

        await testNewStake(Errors.newStake.wrongly_used_credit,
                           validator.wallet.getSender(),
                           deposit);
      });
      it('Validator stake should have enough to handle punishment from elector', async () => {
        const deposit = toNano('100000');
        const validatorAmount = await controller.getValidatorAmount();
        const overDueFine   = Conf.hashUpdateFine * 3n - Conf.stakeRecoverFine;
        const stakeBase     = deposit - Conf.electorOpValue + overDueFine + Conf.minStorage;
        let   maxPunishment = await controller.getMaxPunishment(stakeBase);
        if(maxPunishment <= validatorAmount) {
          const confDict = loadConfig(bc.config);
          confDict.set(40, beginCell()
                           .storeUint(1, 8) //prefix
                           .storeCoins(toNano('5000')) //Default flat fine
                           .storeUint((1 << 32) - 1, 32) // All of the stake
                           .storeUint(256, 16)
                           .storeUint(256, 16)
                           .storeUint(0, 16)
                           .storeUint(0, 16)
                           .storeUint(256, 16)
                           .storeUint(256, 16)
                          .endCell())
          bc.setConfig(beginCell().storeDictDirect(confDict).endCell());
          maxPunishment = await controller.getMaxPunishment(stakeBase);
          expect(maxPunishment).toBeGreaterThan(validatorAmount);
        }
        await testNewStake(Errors.newStake.solvency_not_guaranteed,
                           validator.wallet.getSender(),
                           deposit);
      });
      it('New stake should be accounted correctly', async () => {
        const stateBefore = await controller.getControllerData();
        const deposit = stateBefore.borrowedAmount + getRandomTon(1000, 2000);
        const newStakeMsg = Controller.newStakeMessage(deposit,
                                                       controller.address,
                                                       validator.keys.publicKey,
                                                       validator.keys.secretKey,
                                                       12345, //stake_at
                                                       1 << 16,
                                                       0n);
        const controllerSmc = await bc.getContract(controller.address);
        const res = await controllerSmc.receiveMessage(internal({
          from: validator.wallet.address,
          to: controller.address,
          body: newStakeMsg,
          value: Conf.electorOpValue
        }), {now:bc.now ?? Math.floor(Date.now() / 1000)});
        // We can't use it with mock, because message will bounce back (no elector contract).
        //let res = await testNewStake(0, validator.wallet.getSender(), deposit);
        const stateAfter  = await controller.getControllerData();
        expect(stateAfter.state).toEqual(ControllerState.SENT_STAKE_REQUEST);
        expect(stateAfter.stakeSent).toEqual(deposit - Conf.electorOpValue);
        const confDict = loadConfig(bc.config);
        expect(stateAfter.validatorSetHash).toEqual(
          buff2bigint(confDict.get(34)!.hash())
        );
        expect(stateAfter.validatorSetChangeCount).toEqual(0);
        expect(stateAfter.validatorSetChangeTime).toEqual(getVset(confDict, 34).utime_since);
        expect(stateAfter.stakeAt).toEqual(12345);
        expect(stateAfter.stakeHeldFor).toEqual(eConf.stake_held_for);
        snapStates.set('stake_sent', bc.snapshot());
      });
      it('New stake ok message should only be accepted from elector', async () => {
        await loadSnapshot('stake_sent');
        const stateBefore = await getContractData(controller.address);
        await bc.sendMessage(internal({
          from: differentAddress(electorAddress),
          to: controller.address,
          body: beginCell().storeUint(Op.elector.new_stake_ok, 32).storeUint(1, 64).endCell(),
          value: toNano('1')
        }));
        expect(await getContractData(controller.address)).toEqualCell(stateBefore);
      });
      it('New stake error message should only be accepted from elector', async () => {
          await loadSnapshot('stake_sent');
          const stateBefore = await getContractData(controller.address);
          await bc.sendMessage(internal({
            from: differentAddress(electorAddress),
            to: controller.address,
            body: beginCell().storeUint(Op.elector.new_stake_error, 32).storeUint(1, 64).endCell(),
            value: toNano('1')
          }));
          expect(await getContractData(controller.address)).toEqualCell(stateBefore);
      })
      it('New stake ok message from elector should set state to staken', async () => {
        await loadSnapshot('stake_sent');
        await bc.sendMessage(internal({
          from: electorAddress,
          to: controller.address,
          body: beginCell().storeUint(Op.elector.new_stake_ok, 32).storeUint(1, 64).endCell(),
          value: toNano('1')
        }));
        expect((await controller.getControllerData()).state).toEqual(ControllerState.FUNDS_STAKEN);
        snapStates.set('staken', bc.snapshot());
      });
      it('New stake error message from elector should set state to rest', async () => {
        await loadSnapshot('stake_sent');
        await bc.sendMessage(internal({
          from: electorAddress,
          to: controller.address,
          body: beginCell().storeUint(Op.elector.new_stake_error, 32).storeUint(1, 64).endCell(),
          value: toNano('1')
        }));
        expect((await controller.getControllerData()).state).toEqual(ControllerState.REST);
      });

      it('New stake bounce should only be allowed from elector', async () => {
        await loadSnapshot('stake_sent');
        const stateBefore   = await getContractData(controller.address);
        const notElector    = differentAddress(electorAddress);
        const controllerSmc = await bc.getContract(controller.address);
        await controllerSmc.receiveMessage(internal({
          from: notElector,
          to: controller.address,
          body: beginCell().storeUint(0xFFFFFFFF, 32)
                           .storeUint(Op.elector.new_stake, 32)
                .endCell(),
          value: toNano('1'),
          bounced: true
        }), {now: bc.now ?? Math.floor(Date.now() / 1000)});
        expect(await getContractData(controller.address)).toEqualCell(stateBefore);
      });
      it('New stake bounce handling', async () => {
        await loadSnapshot('stake_sent');
        const controllerSmc = await bc.getContract(controller.address);

        await controllerSmc.receiveMessage(internal({
          from: electorAddress,
          to: controller.address,
          body: beginCell().storeUint(0xFFFFFFFF, 32)
                           .storeUint(Op.elector.new_stake, 32)
                .endCell(),
          value: toNano('1'),
          bounced: true
        }), {now: bc.now ?? Math.floor(Date.now() / 1000)});
        const dataAfter = await controller.getControllerData();
        expect(dataAfter.state).toEqual(ControllerState.REST);
      });
    });

    describe('Recover stake', () => {
      let recoverReady: BlockchainSnapshot;
      let recoverStakeOk: Cell;
      beforeAll(() => {
        recoverStakeOk = beginCell().storeUint(Op.elector.recover_stake_ok, 32)
                                    .storeUint(1, 64)
                         .endCell();
      });
      it('At least 2 validators set changes and stake_held_for time is required to trigger recover stake', async () => {
        await loadSnapshot('staken');
        let curState = await controller.getControllerData();
        expect(curState.validatorSetChangeCount).toEqual(0);
        const vSender  = validator.wallet.getSender();
        const recTrans = {
          from: controller.address,
          to: electorAddress,
          op: Op.elector.recover_stake
        };
        for(let i = 1; i < 3; i++) {
          let res = await controller.sendRecoverStake(vSender);
          expect(res.transactions).toHaveTransaction({
            from: validator.wallet.address,
            to: controller.address,
            success: false,
            exitCode: Errors.too_early_stake_recover_attempt_count
          });
          expect(res.transactions).not.toHaveTransaction(recTrans);
          randVset();
          await controller.sendUpdateHash(vSender);
        }
        let stateAfter = await controller.getControllerData();
        expect(stateAfter.validatorSetChangeCount).toEqual(2);
        // No unfreeze yet
        expect(getCurTime() - stateAfter.validatorSetChangeTime - eConf.stake_held_for).toBeLessThan(60);
        const twoUpdates = bc.snapshot();
        let res = await controller.sendRecoverStake(vSender);
        expect(res.transactions).toHaveTransaction({
          from: validator.wallet.address,
          to: controller.address,
          success: false,
          exitCode: Errors.too_early_stake_recover_attempt_time
        });
        expect(res.transactions).not.toHaveTransaction(recTrans);
        // > 60 sec after unfreeze
        bc.now = stateAfter.validatorSetChangeTime + eConf.stake_held_for + 61;
        res = await controller.sendRecoverStake(vSender);
        expect(res.transactions).toHaveTransaction({
          from: validator.wallet.address,
          to: controller.address,
          success: true
        });
        expect(res.transactions).toHaveTransaction(recTrans);
        recoverReady = bc.snapshot();

        await bc.loadFrom(twoUpdates);
        randVset();
        await controller.sendUpdateHash(vSender);
        expect((await controller.getControllerData()).validatorSetChangeCount).toEqual(3);

        res = await controller.sendRecoverStake(vSender);
        expect(res.transactions).toHaveTransaction({
          from: validator.wallet.address,
          to: controller.address,
          success: true
        });
        expect(res.transactions).toHaveTransaction(recTrans);
      });
      it('Stake recovery only allowed in "staken" state', async () => {
        const vSender = validator.wallet.getSender();
        const testState = async (wrong_state:boolean) => {
          const stateBefore = await getControllerState();
          const res = await controller.sendRecoverStake(vSender);
          const failTrans = {
              from: validator.wallet.address,
              to: controller.address,
              success: false,
              exitCode: Errors.wrong_state
          };
          if (wrong_state) {
            expect(res.transactions).toHaveTransaction(failTrans);
            expect(await getControllerState()).toEqualCell(stateBefore);
          }
          else {
            expect(res.transactions).not.toHaveTransaction(failTrans);
          }
        }
        await bc.loadFrom(InitialState);
        await testState(true);

        await loadSnapshot('stake_sent');
        await testState(true);
        // TODO other states
        await loadSnapshot('staken');
        await testState(false);
      });
      it('Recover stake message value should be >= elector expected value', async () => {
        await bc.loadFrom(recoverReady);

        const expTrans = {
          from: validator.wallet.address,
          to: controller.address,
          success: false,
          exitCode: Errors.too_low_recover_stake_value
        };
        const vSender = validator.wallet.getSender();

        const stateBefore = await getControllerState();
        let res = await controller.sendRecoverStake(vSender, Conf.electorOpValue - 1n); 
        expect(res.transactions).toHaveTransaction(expTrans);
        expect(await getControllerState()).toEqualCell(stateBefore);

        res = await controller.sendRecoverStake(vSender, Conf.electorOpValue)
        expect(res.transactions).not.toHaveTransaction(expTrans);
      });
      it('Only validator should be able to trigger stake recovery till grace period expire', async () => {
       await bc.loadFrom(recoverReady);
       const stateBefore = await controller.getControllerData();
       // Meh
       const dataBefore  = await getControllerState();
       const sinceUnfreeze = getCurTime() - stateBefore.validatorSetChangeTime - eConf.stake_held_for;
       expect(sinceUnfreeze).toBeLessThan(Conf.gracePeriod);

       let res = await controller.sendRecoverStake(deployer.getSender());

       expect(res.transactions).toHaveTransaction({
         from: deployer.address,
         to: controller.address,
         success: false,
         exitCode: Errors.wrong_sender
       });
       expect(res.transactions).not.toHaveTransaction({
         from: controller.address,
         to: electorAddress,
         op: Op.elector.recover_stake
       });

       expect(await getControllerState()).toEqualCell(dataBefore);

       res = await controller.sendRecoverStake(validator.wallet.getSender());
       expect(res.transactions).not.toHaveTransaction({
         from: validator.wallet.address,
         to: controller.address,
         success: false,
         exitCode: Errors.wrong_sender
       });
      });

      it('If stake is not recovered till grace period expire, anyone could trigger recovery and get reward', async () => {
       await bc.loadFrom(recoverReady);
       const stateBefore = await controller.getControllerData();
       bc.now = stateBefore.validatorSetChangeTime + eConf.stake_held_for + Conf.gracePeriod;
       const res = await controller.sendRecoverStake(deployer.getSender());

       // Successfull recovery op sends recovery msg to elector
       expect(res.transactions).toHaveTransaction({
         from: controller.address,
         to: electorAddress,
         op: Op.elector.recover_stake
       });

       const trans = res.transactions[1];
       expect(trans.outMessagesCount).toEqual(2);
       const rewardMsg = trans.outMessages.get(1)!;
       const fwdFees   = computeMessageForwardFees(msgConfMc, rewardMsg);

       expect(res.transactions).toHaveTransaction({
         from: controller.address,
         to: deployer.address,
         value: Conf.stakeRecoverFine - fwdFees.fees - fwdFees.remaining
       });
      });
      it('Reward should not be sent if less than minimal storage is left after', async () => {
       await bc.loadFrom(recoverReady);
       const stateBefore = await controller.getControllerData();
       bc.now = stateBefore.validatorSetChangeTime + eConf.stake_held_for + Conf.gracePeriod;
       const minReq = Conf.stakeRecoverFine + Conf.minStorage;
       // Setting balance
       await bc.setShardAccount(controller.address, createShardAccount({
         address: controller.address,
         code: controller_code,
         data: await getControllerState(),
         balance: minReq - 1n // account for balance at message processit time
       }));

       const res = await controller.sendRecoverStake(deployer.getSender());
       // Should still send message to elector
       expect(res.transactions).toHaveTransaction({
         from: controller.address,
         to: electorAddress,
         op: Op.elector.recover_stake
       });
       // But no reward
       expect(res.transactions).not.toHaveTransaction({
         from: controller.address,
         to: deployer.address
       });
      });
      it('Validator should not be rewarded for not recovering stake in time', async () => {
       await bc.loadFrom(recoverReady);
       const stateBefore = await controller.getControllerData();
       bc.now = stateBefore.validatorSetChangeTime + eConf.stake_held_for + Conf.gracePeriod;

       const res = await controller.sendRecoverStake(validator.wallet.getSender());

       // Should still send message to elector
       expect(res.transactions).toHaveTransaction({
         from: controller.address,
         to: electorAddress,
         op: Op.elector.recover_stake
       });
       // But no reward
       expect(res.transactions).not.toHaveTransaction({
         from: controller.address,
         to: validator.wallet.address
       });
      });
      it('Recover stake ok message should only be accepted from elector', async () => {
        await bc.loadFrom(recoverReady);

        const notElector  = differentAddress(electorAddress);
        const borrowed    = (await controller.getControllerData()).borrowedAmount;
        const stateBefore = await getControllerState();
        const res = await bc.sendMessage(internal({
          from: notElector,
          to: controller.address,
          body: recoverStakeOk,
          value: borrowed + toNano('10000')
        }));
        expect(await getControllerState()).toEqualCell(stateBefore);
      });
      it('Successfull stake recovery  should trigger debt repay', async () => {
        await bc.loadFrom(recoverReady);
        const stateBefore = await controller.getControllerData();
        // We don't want to trigger loan repayment bounce, so have to use receiveMessage
        const controllerSmc = await bc.getContract(controller.address);
        const res = await controllerSmc.receiveMessage(internal({
          from: electorAddress,
          to: controller.address,
          body: recoverStakeOk,
          value: stateBefore.borrowedAmount + toNano('10000')
        }), {now: bc.now});
        expect(res.outMessagesCount).toEqual(1);
        const repayMsg = res.outMessages.get(0)!;
        // TS type check
        if( repayMsg.info.type !== "internal" )
          throw Error("Can't be!");

        expect(repayMsg.info.dest).toEqualAddress(poolAddress);
        expect(repayMsg.info.value.coins).toEqual(stateBefore.borrowedAmount);
        expect(repayMsg.body.beginParse().preloadUint(32)).toEqual(Op.pool.loan_repayment);

        // Should revert to rest state
        const dataAfter = await controller.getControllerData();
        expect(dataAfter.state).toEqual(ControllerState.REST);
        expect(dataAfter.borrowedAmount).toEqual(0n);
        expect(dataAfter.borrowingTime).toEqual(0);
      });
      it('Controller should halt If not enough balance to repay debt on recovery', async () => {
        await bc.loadFrom(recoverReady);
        const dataBefore = await controller.getControllerData();
        // We don't want to trigger loan repayment bounce, so have to use receiveMessage
        const controllerSmc = await bc.getContract(controller.address);
        const minBalance    = Conf.minStorage + dataBefore.borrowedAmount;
        expect(controllerSmc.balance).toBeLessThan(minBalance);
        const offByOne = minBalance - controllerSmc.balance - 1n;
        const res = await controllerSmc.receiveMessage(internal({
          from: electorAddress,
          to: controller.address,
          body: recoverStakeOk,
          value: offByOne
        }), {now: bc.now});
        expect(res.outMessagesCount).toEqual(0);

        const dataAfter = await controller.getControllerData();
        // State get's halted
        expect(dataAfter.state).toEqual(ControllerState.HALTED);
        // Should not change borrow related info just in case
        expect(dataAfter.borrowedAmount).toEqual(dataBefore.borrowedAmount);
        expect(dataAfter.borrowingTime).toEqual(dataBefore.borrowingTime);
      });
    });
    describe('Hash update', () => {

      let threeSetState:BlockchainSnapshot;
      beforeEach(async () => await loadSnapshot('staken'));

      it('Hash update should only be possible in "staken" state', async () => {
        await bc.loadFrom(InitialState);
        const expErr = {
          from: validator.wallet.address,
          to: controller.address,
          success: false,
          exitCode: Errors.wrong_state
        };
        expect((await controller.getControllerData()).state).toEqual(ControllerState.REST);
        const vSender = validator.wallet.getSender();
        // Initial state REST
        let res = await controller.sendUpdateHash(vSender);
        expect(res.transactions).toHaveTransaction(expErr);

        await loadSnapshot('stake_sent');
        expect((await controller.getControllerData()).state).toEqual(ControllerState.SENT_STAKE_REQUEST);
        res = await controller.sendUpdateHash(vSender);
        expect(res.transactions).toHaveTransaction(expErr);
        // TODO for other states
        //
        await loadSnapshot('staken');
        res = await controller.sendUpdateHash(vSender);
        expect(res.transactions).toHaveTransaction({
          from: vSender.address!,
          to: controller.address,
          success: true
        });
      });
      it('Hash update should not trigger if vset hash didn\'t change', async () => {
        const stateBefore = await getContractData(controller.address);
        const confDict = loadConfig(bc.config);
        const curHash  = buff2bigint(confDict.get(34)!.hash());
        expect((await controller.getControllerData()).validatorSetHash).toEqual(curHash);
        await controller.sendUpdateHash(validator.wallet.getSender());
        expect(await getContractData(controller.address)).toEqualCell(stateBefore);

        randVset();
        // Now it will trigger
        await controller.sendUpdateHash(validator.wallet.getSender());
        expect(await getContractData(controller.address)).not.toEqualCell(stateBefore);
      });
      it('Validator should update validator set hash correctly', async () => {
        expect((await controller.getControllerData()).validatorSetChangeCount).toEqual(0);
        const curTime = getCurTime();
        const curVset = getVset(bc.config, 34);
        expect(curTime - curVset.utime_since).toBeLessThanOrEqual(Conf.gracePeriod);
 
        const vSender = validator.wallet.getSender();

        for(let i = 1; i < 4; i++) {
          const newSetCell = randVset();
          const msgVal     = getRandomTon(1, 10);
          const changeTime = getCurTime();
          const res = await controller.sendUpdateHash(vSender, msgVal);
          const dataAfter = await controller.getControllerData();
          await assertHashUpdate(newSetCell.hash(), changeTime, i);
          /*
          expect(dataAfter.validatorSetHash).toEqual(buff2bigint(newSetCell.hash()));
          expect(dataAfter.validatorSetChangeCount).toEqual(i);
          expect(dataAfter.validatorSetChangeTime).toEqual(changeTime);
          */
          const excessTrans = res.transactions[1];
          expect(excessTrans.outMessagesCount).toEqual(1);
          const excessMsg   = excessTrans.outMessages.get(0)!;
          expect(res.transactions).toHaveTransaction({
            from: controller.address,
            to: validator.wallet.address,
            value: getMsgExcess(excessTrans, excessMsg, msgVal, msgConfMc)
          });
        }
        // Saving for later
        threeSetState =  bc.snapshot();
      });
      it('Only validator should be able to update validators set hash till loan grace period expires', async () => {
        const curTime = getCurTime();
        const curVset = getVset(bc.config, 34);
        expect(curTime - curVset.utime_since).toBeLessThanOrEqual(Conf.gracePeriod);
        const res = await controller.sendUpdateHash(deployer.getSender());
        expect(res.transactions).toHaveTransaction({
          from: deployer.address,
          to: controller.address,
          success: false,
          exitCode: Errors.wrong_sender
        });
      });
      it('After grace period anyone should be able to update validaotrs set and get rewarded(except validator)', async() => {
        for(let i = 1; i < 3; i++) {
          const newSetCell = randVset();
          const curVset = getVset(bc.config, 34);
          const changeTime = curVset.utime_since + Conf.gracePeriod + 1;
          bc.now = changeTime;

          const res        = await controller.sendUpdateHash(deployer.getSender());
          const dataAfter  = await controller.getControllerData();

          await assertHashUpdate(newSetCell.hash(), changeTime, i);

          const updTrans = res.transactions[1];
          expect(updTrans.outMessagesCount).toEqual(1);
          const rewardMsg = updTrans.outMessages.get(0)!;
          const fwdFees = computeMessageForwardFees(msgConfMc, rewardMsg);
          expect(res.transactions).toHaveTransaction({
            from: controller.address,
            to: deployer.address,
            value: Conf.hashUpdateFine - fwdFees.fees - fwdFees.remaining
          });
        }
        // But only if there is > min storage + hash update fine on balance
        const minReq = Conf.minStorage + Conf.hashUpdateFine;
        const msgVal = toNano('1');

        // Setting balance
        await bc.setShardAccount(controller.address, createShardAccount({
          address: controller.address,
          code: controller_code,
          data: await getControllerState(),
          balance: minReq - msgVal - 1n // account for balance at message processit time
        }));
        // Meh
        const newSetCell = randVset();
        const curVset = getVset(bc.config, 34);
        const changeTime = curVset.utime_since + Conf.gracePeriod + 1;
        bc.now = changeTime;

        const res        = await controller.sendUpdateHash(deployer.getSender());
        const dataAfter  = await controller.getControllerData();

        await assertHashUpdate(newSetCell.hash(), changeTime, 3);

        expect(res.transactions).not.toHaveTransaction({
          from: controller.address,
          to: deployer.address
        });
      });
      it('Validator should not get rewarded after grace period', async () => {
        const stateBefore = await controller.getControllerData();
        const newSetCell = randVset();
        const curVset = getVset(bc.config, 34);
        const changeTime = curVset.utime_since + Conf.gracePeriod + 1;
        bc.now = changeTime;

        const res = await controller.sendUpdateHash(validator.wallet.getSender());
        expect(res.transactions).not.toHaveTransaction({
          from: controller.address,
          to: validator.wallet.address
        });
        await assertHashUpdate(newSetCell.hash(), changeTime, stateBefore.validatorSetChangeCount + 1);
      });
      it('Validators hash update should only be allowed 3 times till new deposit', async () => {
        await bc.loadFrom(threeSetState);
        // Just in case
        expect((await controller.getControllerData()).validatorSetChangeCount).toEqual(3);
        const stateBefore = await getControllerState();
        const res = await controller.sendUpdateHash(validator.wallet.getSender());
        expect(res.transactions).toHaveTransaction({
          from: validator.wallet.address,
          to: controller.address,
          success: false,
          exitCode: Errors.too_much_validator_set_counts
        });
        expect(await getControllerState()).toEqualCell(stateBefore);
      });
    });
});
