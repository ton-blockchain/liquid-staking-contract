import { Blockchain,BlockchainSnapshot,internal,SandboxContract,TreasuryContract } from "@ton-community/sandbox";
import { Controller, controllerConfigToCell } from '../wrappers/Controller';
import { Address, Sender, Cell, toNano, Dictionary, beginCell } from 'ton-core';
import { keyPairFromSeed, getSecureRandomBytes, getSecureRandomWords, KeyPair } from 'ton-crypto';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { randomAddress } from "@ton-community/test-utils";
import { getElectionsConf, getValidatorsConf, getVset, loadConfig, packValidatorsSet } from "../wrappers/ValidatorUtils";
import { buff2bigint, differentAddress, getRandomTon } from "../utils";
import { Conf, ControllerState, Errors } from "../PoolConstants";

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
    let randVset:() => void;
    let snapStates:Map<string,BlockchainSnapshot>
    let loadSnapshot:(snap:string) => Promise<void>;
    let getContractData:(smc:Address) => Promise<Cell>;
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

        randVset = () => {
          const confDict = loadConfig(bc.config);
          const vset = getVset(confDict, 34);
          if(!bc.now)
            bc.now = Math.floor(Date.now() / 1000);
          vset.utime_since = bc.now
          vset.utime_unitl = vset.utime_since + eConf.elected_for;
          confDict.set(34, packValidatorsSet(vset));
          bc.setConfig(beginCell().storeDictDirect(confDict).endCell());
        }

        loadSnapshot = async (name:string) => {
          const state = snapStates.get(name);
          if(!state)
            throw(Error(`Can't find state ${name}\nCheck tests execution order`));
          await bc.loadFrom(state);
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
      expect(borrowAmount).toBeGreaterThanOrEqual(toNano('100000'));
      expect(borrowAmount).toBeLessThanOrEqual(toNano('200000'));
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

      const borrowTime = Math.floor(Date.now() / 1000);
      bc.now = borrowTime;
      const res = await controller.sendCredit(bc.sender(poolAddress), borrowAmount, msgVal);
      const stateAfter = await controller.getControllerData();
      expect(stateAfter.borrowedAmount).toEqual(stateBefore.borrowedAmount + borrowAmount);
      expect(stateAfter.borrowingTime).toEqual(borrowTime);
      expect(stateAfter.state).toEqual(ControllerState.REST);
      snapStates.set('borrowed', bc.snapshot());
    });

    describe('New stake', () => {
      beforeEach(async () => await loadSnapshot('borrowed'));
      it('Not validator should not be able to deposit to elector', async() => {
        const deposit    = toNano('100000');
        const randWallet = differentAddress(validator.wallet.address);
        await testNewStake(Errors.wrong_sender, bc.sender(randWallet), deposit);
      });

      it('Pool should only accept new elector stake with confirmation', async() =>{
        const deposit    = toNano('100000');
        // 0 query id means no confirmation
        await testNewStake(Errors.newStake.query_id, validator.wallet.getSender(), deposit, 0);
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
        await controller.sendDeploy(deployer.getSender());
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
      });
    });
});
