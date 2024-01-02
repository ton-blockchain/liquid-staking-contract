import { Blockchain,BlockchainSnapshot, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { Address, Cell, beginCell, toNano, Dictionary } from '@ton/core';
import { compile } from '@ton/blueprint';
import { Pool, PoolConfig, PoolData } from '../wrappers/Pool';
import { Controller, ControllerConfig, controllerConfigToCell } from '../wrappers/Controller';

import { Conf, ControllerState, Errors, Op } from "../PoolConstants";
import { JettonMinter as DAOJettonMinter, jettonContentToCell } from '../contracts/jetton_dao/wrappers/JettonMinter';
import { JettonWallet as DAOWallet } from '../wrappers/JettonWallet';

import '@ton/test-utils';
import { differentAddress, getRandomInt, getRandomTon, muldivExtra } from "../utils";
import { loadConfig, packValidatorsSet, getElectionsConf, getVset, parseValidatorsSet } from "../wrappers/ValidatorUtils";
import { getMsgPrices } from "../fees";


type OperationalParams = {
    min_loan : bigint,
    max_loan : bigint,
    disbalance_tolerance: number,
    credit_start_prior: number
};

describe('New operational parameters tests', () => {
    let blockchain: Blockchain;
    let prevState: BlockchainSnapshot;

    let deployer: SandboxContract<TreasuryContract>;
    let interest_manager: SandboxContract<TreasuryContract>;
    let validator: SandboxContract<TreasuryContract>;
    let nominator: SandboxContract<TreasuryContract>;

    let pool:SandboxContract<Pool>;
    let poolConfig:PoolConfig;
    let pool_code: Cell;
    let poolJetton: SandboxContract<DAOJettonMinter>;

    let controllers: Array<SandboxContract<Controller>>;
    let secondController :SandboxContract<Controller>;
    let controller_code:Cell;

    let payout_minter_code:Cell;
    let payout_wallet_code:Cell;
    let dao_minter_code:Cell;
    let dao_wallet_code:Cell;
    let dao_voting_code:Cell;
    let dao_vote_keeper_code:Cell;

    let getCurTime:() => number;
    let getRandomOperationalParams: (data?:PoolData) => Promise<OperationalParams>;
    let getContractData:(address: Address) => Promise<Cell>;
    let eConf : ReturnType<typeof getElectionsConf>;
    let msgPrices: ReturnType<typeof getMsgPrices>;
    let randVset:() => Cell;
    let getLoanAmountByTolerance:(data?:PoolData, custom_tolerance?: bigint) => Promise<bigint>;

    beforeAll(async () => {
        blockchain = await Blockchain.create();

        deployer  = await blockchain.treasury('deployer', {workchain: -1, balance: toNano("1000000000")});
        validator = await blockchain.treasury('validator_wallet', {workchain: -1, balance: toNano("1000000000")});
        nominator = await blockchain.treasury('nominator', {workchain: 0, balance: toNano('100000000')});

        interest_manager = await blockchain.treasury('interest_manager');

        controller_code = await compile('Controller');
        pool_code = await compile('Pool');
        payout_minter_code = await compile('PayoutNFTCollection');
        payout_wallet_code = await compile('PayoutWallet');
        dao_minter_code = await compile('DAOJettonMinter');
        const dao_wallet_code_raw = await compile('DAOJettonWallet');
        dao_vote_keeper_code = await compile('DAOVoteKeeper');
        dao_voting_code = await compile('DAOVoting');

        const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
        _libs.set(BigInt(`0x${dao_wallet_code_raw.hash().toString('hex')}`), dao_wallet_code_raw);
        const libs = beginCell().storeDictDirect(_libs).endCell();
        blockchain.libs = libs;

        let lib_prep = beginCell().storeUint(2,8).storeBuffer(dao_wallet_code_raw.hash()).endCell();
        dao_wallet_code = new Cell({ exotic:true, bits: lib_prep.bits, refs:lib_prep.refs});

        const content   = jettonContentToCell({type:1,uri:"https://example.com/1.json"});
        poolJetton      = blockchain.openContract(DAOJettonMinter.createFromConfig({
                                                  admin:deployer.address,
                                                  content,
                                                  voting_code:dao_voting_code,
                                                  },
                                                  dao_minter_code));


        poolConfig = {
              pool_jetton : poolJetton.address,
              pool_jetton_supply : 0n,
              optimistic_deposit_withdrawals: -1n,

              sudoer : deployer.address,
              governor : deployer.address,
              interest_manager : interest_manager.address, // Completely separate wallet
              halter : deployer.address,
              approver : deployer.address,

              controller_code : controller_code,
              pool_jetton_wallet_code : dao_wallet_code,
              payout_minter_code : payout_minter_code,
              vote_keeper_code : dao_vote_keeper_code,
        };

        pool = blockchain.openContract(Pool.createFromConfig(poolConfig, pool_code));
        const deployResult = await pool.sendDeploy(deployer.getSender(),Conf.minStoragePool + toNano('1'));

        await poolJetton.sendDeploy(deployer.getSender(), toNano('1.05'));
        await poolJetton.sendChangeAdmin(deployer.getSender(), pool.address);

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: pool.address,
            deploy: true,
            success:true
        });
        controllers = Array(2);
        for (let i = 0; i < 2; i++) {
            let   controllerAddress = await pool.getControllerAddress(i, validator.address);
            let   res  = await pool.sendRequestControllerDeploy(validator.getSender(), toNano('100000'),i);
            expect(res.transactions).toHaveTransaction({
                from: validator.address,
                on: pool.address,
                outMessagesCount: 1
            });
            expect(res.transactions).toHaveTransaction({
                from: pool.address,
                on: controllerAddress,
                deploy: true,
                success: true
            });
            controllers[i] = blockchain.openContract(Controller.createFromAddress(controllerAddress));
            const approve = await controllers[i].sendApprove(deployer.getSender(), true);

            expect(approve.transactions).toHaveTransaction({
                from: deployer.address,
                on: controllers[i].address,
                op: Op.controller.approve,
                success: true
            });
        }

        getContractData = async (address: Address) => {
          const smc = await blockchain.getContract(address);
          if(!smc.account.account)
            throw("Account not found")
          if(smc.account.account.storage.state.type != "active" )
            throw("Atempting to get data on inactive account");
          if(!smc.account.account.storage.state.state.data)
            throw("Data is not present");
          return smc.account.account.storage.state.state.data
        }

        eConf      = getElectionsConf(blockchain.config);
        msgPrices  = getMsgPrices(blockchain.config, -1);

        getCurTime = () => blockchain.now ?? Math.floor(Date.now() / 1000);

        randVset = () => {
          const confDict = loadConfig(blockchain.config);
          const vset = getVset(confDict, 34);
          if(!blockchain.now)
            blockchain.now = Math.floor(Date.now() / 1000);
          vset.utime_since = blockchain.now
          vset.utime_unitl = vset.utime_since + eConf.elected_for;
          const newSet = packValidatorsSet(vset);
          blockchain.now += 100;
          confDict.set(34, newSet);
          blockchain.setConfig(beginCell().storeDictDirect(confDict).endCell());
          return newSet;
        }

        getRandomOperationalParams = async (data) => {
            const prevData   = data ?? await pool.getFullData();
            const newMin     = prevData.minLoan - BigInt(getRandomInt(1000, 2000, 3));
            const newMax     = prevData.maxLoan + BigInt(getRandomInt(1000, 2000, 3));
            const newDisbalanceTolerance = prevData.disbalanceTolerance + getRandomInt(1, 5, 3);
            const creditStartPrior = 3600 + getRandomInt(1, 100);

            return {
                min_loan: newMin,
                max_loan: newMax,
                disbalance_tolerance: newDisbalanceTolerance,
                credit_start_prior: creditStartPrior
            };
        }

        getLoanAmountByTolerance = async (data, custom_tolerance) => {
            const toleranceBase = BigInt(2 << 8);
            const curData   = data ?? await pool.getFullData();
            const tolerance = custom_tolerance ?? BigInt(curData.disbalanceTolerance);
            return muldivExtra(toleranceBase / 2n + tolerance, curData.totalBalance, toleranceBase) - curData.currentRound.borrowed;
        }

        const curVset = parseValidatorsSet(randVset().beginParse());
        if(curVset.type !== "ext")
            throw new Error("Extendev vset expected");
        if(getCurTime() < curVset.utime_unitl    - eConf.begin_before) {
            blockchain.now = curVset.utime_unitl - eConf.begin_before + 1;
        }

        const depoResult = await pool.sendDeposit(nominator.getSender(), toNano('1000000'));
        expect(depoResult.transactions).toHaveTransaction({
            from: nominator.address,
            on: pool.address,
            op: Op.pool.deposit,
            success: true
        });
        prevState = blockchain.snapshot();
    });

    afterEach(async () => await blockchain.loadFrom(prevState));

    it('operational parameter should only be changeable by interest manager', async() => {
        const dataBefore  = await pool.getFullData();
        const stateBefore = await getContractData(pool.address);
        const newParams   = await getRandomOperationalParams(dataBefore);
        const randomAddr  = differentAddress(interest_manager.address);
        // Deployer, having every role except interest manager, should fail
        let res = await pool.sendSetOperationalParameters(deployer.getSender(),newParams.min_loan, newParams.max_loan, newParams.disbalance_tolerance, newParams.credit_start_prior);

        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            on: pool.address,
            op: Op.interestManager.set_operational_params,
            aborted: true,
            success: false,
            exitCode: Errors.wrong_sender
        });

        expect(await getContractData(pool.address)).toEqualCell(stateBefore);

        // Just in case test totally random address

        res = await pool.sendSetOperationalParameters(blockchain.sender(randomAddr),newParams.min_loan, newParams.max_loan, newParams.disbalance_tolerance, newParams.credit_start_prior);

        expect(res.transactions).toHaveTransaction({
            from: randomAddr,
            on: pool.address,
            op: Op.interestManager.set_operational_params,
            aborted: true,
            success: false,
            exitCode: Errors.wrong_sender
        });

        expect(await getContractData(pool.address)).toEqualCell(stateBefore);

    });
    it('interest manager should be able to set operational parameters', async () => {
        const dataBefore = await pool.getFullData();
        const newParams  = await getRandomOperationalParams(dataBefore);
        const res = await pool.sendSetOperationalParameters(interest_manager.getSender(), newParams.min_loan, newParams.max_loan, newParams.disbalance_tolerance, newParams.credit_start_prior);

        expect(res.transactions).toHaveTransaction({
            from: interest_manager.address,
            on: pool.address,
            op: Op.interestManager.set_operational_params,
            success: true
        });

        const dataAfter = await pool.getFullData();

        expect(dataAfter.minLoan).toEqual(newParams.min_loan);
        expect(dataAfter.maxLoan).toEqual(newParams.max_loan);
        expect(dataAfter.disbalanceTolerance).toEqual(newParams.disbalance_tolerance);
        expect(dataAfter.creditStartPriorElectionsEnd).toEqual(newParams.credit_start_prior);
    });
    it('should not allow to set min_loan > max_loan in operational parameters', async () => {
        const dataBefore = await pool.getFullData();
        const newParams  = await getRandomOperationalParams(dataBefore);

        expect(newParams.max_loan).toBeGreaterThan(newParams.min_loan);

        // We switch min and max
        const res = await pool.sendSetOperationalParameters(interest_manager.getSender(), newParams.max_loan, newParams.min_loan, newParams.disbalance_tolerance, newParams.credit_start_prior);

        expect(res.transactions).toHaveTransaction({
            from: interest_manager.address,
            on: pool.address,
            op: Op.interestManager.set_operational_params,
            // aborted: true such tx can be aborted or accepted, depending on the chosen logic
        });

        const dataAfter = await pool.getFullData();
        // Main thing is that maxLoan has to be >= than minLoan
        expect(dataAfter.maxLoan).toBeGreaterThanOrEqual(dataAfter.minLoan);
    });
    it('min_loan should come into play after update', async () => {
        const dataBefore = await pool.getFullData();

        let controller = controllers[0];
        let   res  = await controller.sendRequestLoan(validator.getSender(),dataBefore.minLoan, dataBefore.minLoan, dataBefore.interestRate);
        expect(res.transactions).toHaveTransaction({
            from: pool.address,
            to: controller.address,
            op: Op.controller.credit,
            success: true
        });
        const newMin = dataBefore.minLoan + getRandomTon(100, 500);

        await pool.sendSetMinLoan(interest_manager.getSender(), newMin);

        expect((await pool.getMinMaxLoanPerValidator()).min).toEqual(newMin);

        controller = controllers[1];
        // We should get contradicting borrowing parameters now, because maxLoan passed is now lower than minLoan set.
        res  = await controller.sendRequestLoan(validator.getSender(),dataBefore.minLoan, dataBefore.minLoan, dataBefore.interestRate);
        expect(res.transactions).toHaveTransaction({
            from: controller.address,
            on: pool.address,
            op: Op.pool.request_loan,
            aborted: true,
            exitCode: Errors.contradicting_borrowing_params
        });
        expect(res.transactions).not.toHaveTransaction({
            from: pool.address,
            to: controller.address,
            op: Op.controller.credit,
        });
    });
    it('max_loan should come into play after update', async() => {
        // Deposit some more to eliminate disbalance tolerance effect on loan values for test case simplicity.
        const depoResult = await pool.sendDeposit(nominator.getSender(), toNano('3000000'));
        expect(depoResult.transactions).toHaveTransaction({
            from: nominator.address,
            on: pool.address,
            op: Op.pool.deposit,
            success: true
        });

        const dataBefore = await pool.getFullData();

        let loanByTolerance = await getLoanAmountByTolerance(dataBefore);
        expect(loanByTolerance).toBeGreaterThanOrEqual(dataBefore.maxLoan);
        let controller = controllers[0];

        // Just in case check that max loan limitation worked as expected before with requesting much higher maxLoan than configured
        let   res  = await controller.sendRequestLoan(validator.getSender(),toNano('1'), dataBefore.maxLoan * 2n, dataBefore.interestRate);

        // And getting exactly maxLoan - fees
        expect(res.transactions).toHaveTransaction({
            from: pool.address,
            to: controller.address,
            op: Op.controller.credit,
            value: dataBefore.maxLoan - msgPrices.lumpPrice,
            success: true
        });

        // Now update maxLoan
        const newMax = dataBefore.maxLoan / 10n;
        res = await pool.sendSetMaxLoan(interest_manager.getSender(), newMax);
        const dataAfter = await pool.getFullData();
        expect(dataAfter.maxLoan).toEqual(newMax);

        // New controller
        controller = controllers[1];

        // make sure that pool still has enough funds to cover previous maxLoan
        loanByTolerance = await getLoanAmountByTolerance(dataBefore);
        expect(loanByTolerance).toBeGreaterThanOrEqual(dataBefore.maxLoan);

        // Same parameters, but new max_loan is set in pool state
        res  = await controller.sendRequestLoan(validator.getSender(),toNano('1'), dataBefore.maxLoan * 2n, dataBefore.interestRate);

        // Now resulting loan value was calculated with respect to new max_loan parameter
        expect(res.transactions).toHaveTransaction({
            from: pool.address,
            to: controller.address,
            op: Op.controller.credit,
            value: newMax - msgPrices.lumpPrice,
            success: true
        });
    });
    it('new disbalance tolerance should come into play after update', async () => {
        /*
         * Disbalance tolerance(dt) measures how much above 50% of total_balance we're willing to loan to a single validator in range from 0 to 255
         * Increasing disbalance tolerance by 1 increases the resulting value by total_balance / 512
         * 0 tolerance means we can only lend 50% of available funds to a single validator.
         * 255 tolerance means we can lend 511/512 of available funds (99.8%) to a single validator.
         */

        let dataBefore = await pool.getFullData();
        let newTolerance: number;

        // Let's pick random disbalance value, not matching current value
        do {
            newTolerance = getRandomInt(0,100, 3);
        } while(newTolerance == dataBefore.disbalanceTolerance);

        // Lets' estimate value
        let loanByTolerance = await getLoanAmountByTolerance(dataBefore, BigInt(newTolerance));
        // Now set it in contract
        let res = await pool.sendSetDisbalanceTolerance(interest_manager.getSender(), BigInt(newTolerance));
        expect((await pool.getFullData()).disbalanceTolerance).toEqual(newTolerance);

        // And request loan
        res     = await controllers[0].sendRequestLoan(validator.getSender(),toNano('1'), dataBefore.maxLoan, dataBefore.interestRate);

        expect(res.transactions).toHaveTransaction({
            from: pool.address,
            to: controllers[0].address,
            op: Op.controller.credit,
            value: loanByTolerance - msgPrices.lumpPrice,
            success: true
        });
    });
    it('interest manager should be able to set credit closing delta prior to the end of elections', async () => {
        /*
         * We're testing the parameter 'credit_start_prior_elections_end'.
         * Point of it is to prevent borrowers from draining pool balance earlier than
         * end of elections - `credit_start_prior_elections_end`.
         *
         * So, how "end of elections" is calculated?
         *
         * https://github.com/ton-blockchain/ton/blob/master/crypto/smartcont/elector-code.fc#L995
         *
         * var cur_valid_until = cur_vset.begin_parse().skip_bits(8 + 32).preload_uint(32);
         * var t = now();
         * var t0 = cur_valid_until - elect_begin_before;
         * t0 here is the time when elections begin
         * ...
         * While functioning normally, this case expected to be true
         * if (t - t0 < 60) {
         *    ;; pretend that the elections started at t0
         *    t = t0;
         * }
         * ...
         * Now finally the elections closing time is
         *  var elect_at = t + elect_begin_before;
         *  ;; elect_at~dump();
         *  var elect_close = elect_at - elect_end_before;
         *
         *  Since we can't get elect_at difectly from elector contract, we got to hope that t always equals t0.
         *  If there was significant delay in elections announcement, we're going to have to start lending earlier this round,
         *  So cur_valid_until - elect_end_before whould be the expression.
        */

        const curVset = getVset(blockchain.config, 34);

        // So we have been borrowing at the begining of elections in all cases above, so no point to test it again

        const dataBefore = await pool.getFullData();
        expect(dataBefore.creditStartPriorElectionsEnd).toBe(0);
        const newDelta   = getRandomInt(1000, 3600, 3);
        let res = await pool.sendSetCreditStartPriorElectionsEnd(interest_manager.getSender(), newDelta);

        expect((await pool.getFullData()).creditStartPriorElectionsEnd).toEqual(newDelta);

        const controller = controllers[0];
        res = await controller.sendRequestLoan(validator.getSender(), toNano('100'), toNano('1000'), dataBefore.interestRate);
        expect(res.transactions).toHaveTransaction({
            on: pool.address,
            from: controller.address,
            op: Op.pool.request_loan,
            aborted: true,
            success: false,
            exitCode: Errors.too_early_borrowing_request
        });
        expect(res.transactions).not.toHaveTransaction({
            on: controller.address,
            from: pool.address,
            op: Op.controller.credit
        });

        const electionsEnd = curVset.utime_unitl - eConf.end_before;
        blockchain.now = electionsEnd - newDelta + 1; // Not a huge fan of + 1
        res = await controller.sendRequestLoan(validator.getSender(), toNano('100'), toNano('1000'), dataBefore.interestRate);
        expect(res.transactions).toHaveTransaction({
            on: controller.address,
            from: pool.address,
            op: Op.controller.credit,
            success: true
        });
    });
});

