import { Blockchain, SandboxContract, internal, TreasuryContract, BlockchainSnapshot } from '@ton-community/sandbox';
import { Cell, toNano, fromNano, beginCell, Address } from 'ton-core';
import { Pool } from '../wrappers/Pool';
import { Controller } from '../wrappers/Controller';
import { JettonMinter as DAOJettonMinter, jettonContentToCell } from '../contracts/jetton_dao/wrappers/JettonMinter';
import { setConsigliere } from '../wrappers/PayoutMinter.compile';
import { getElectionsConf, getVset, loadConfig, packValidatorsSet } from "../wrappers/ValidatorUtils";
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { Conf, Op } from "../PoolConstants";
import { getRandomTon } from '../utils';


describe('Deposit Fees Calculatuion', () => {
    let blockchain: Blockchain;

    let pool_code: Cell;
    let controller_code: Cell;
    let payout_minter_code: Cell;
    let payout_wallet_code: Cell;

    let dao_minter_code: Cell;
    let dao_wallet_code: Cell;
    let dao_vote_keeper_code: Cell;
    let dao_voting_code: Cell;

    let pool: SandboxContract<Pool>;
    let controller: SandboxContract<Controller>;
    let poolJetton: SandboxContract<DAOJettonMinter>;
    let normalState: BlockchainSnapshot;
    let deployer: SandboxContract<TreasuryContract>;
    let wallets: SandboxContract<TreasuryContract>[];

    const newVset = () => {
        const confDict = loadConfig(blockchain.config);
        const vset = getVset(confDict, 34);
        const eConf = getElectionsConf(confDict);
        if(!blockchain.now)
          blockchain.now = 100;
        vset.utime_since = blockchain.now + 1
        vset.utime_unitl = vset.utime_since + eConf.elected_for;
        const newSet = packValidatorsSet(vset);
        blockchain.now += 100;
        confDict.set(34, newSet);
        blockchain.setConfig(beginCell().storeDictDirect(confDict).endCell());
        return newSet;
    }
    const toElections = () => {
        const confDict = loadConfig(blockchain.config);
        const vset = getVset(confDict, 34);
        const eConf = getElectionsConf(confDict);
        if(!blockchain.now)
          blockchain.now = 100;
        blockchain.now = vset.utime_unitl - eConf.begin_before + 1;
    }

    beforeAll(async () => {
        blockchain = await Blockchain.create();
        blockchain.now = 100;

        deployer = await blockchain.treasury("deployer");

        wallets = await Promise.all([
            blockchain.treasury("wallet1"),
            blockchain.treasury("wallet2"),
            blockchain.treasury("wallet3"),
            blockchain.treasury("wallet4"),
            blockchain.treasury("wallet5"),
        ]);

        await setConsigliere(deployer.address);
        payout_minter_code = await compile('PayoutMinter');
        payout_wallet_code = await compile('PayoutWallet');

        pool_code = await compile('Pool');
        controller_code = await compile('Controller');

        dao_minter_code = await compile('DAOJettonMinter');
        dao_wallet_code = await compile('DAOJettonWallet');
        dao_vote_keeper_code = await compile('DAOVoteKeeper');
        dao_voting_code = await compile('DAOVoting');

        const content = jettonContentToCell({type:1,uri:"https://example.com/1.json"});
        poolJetton  = blockchain.openContract(DAOJettonMinter.createFromConfig({
                                                  admin:deployer.address,
                                                  content,
                                                  voting_code:dao_voting_code,
                                                  },
                                                  dao_minter_code));
        const poolConfig = {
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
        pool = blockchain.openContract(Pool.createFromConfig(poolConfig, pool_code));

        const controllerConfig = {
          controllerId: 0,
          validator: deployer.address,
          pool: pool.address,
          governor: deployer.address,
          approver: deployer.address,
          halter: deployer.address,
        };
        controller = blockchain.openContract(Controller.createFromConfig(controllerConfig, controller_code));

        const poolDeployResult = await pool.sendDeploy(deployer.getSender(), toNano('11'));
        expect(poolDeployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            deploy: true,
            success: true,
        });
        const poolJettonDeployResult = await poolJetton.sendDeploy(deployer.getSender(), toNano('1.05'));
        expect(poolJettonDeployResult.transactions).toHaveTransaction({
                         from: deployer.address,
                         to: poolJetton.address,
                         deploy: true,
                         success: true,
        });
        // change admin because we need to know jetton address before minting the pool
        const adminTransferResult = await poolJetton.sendChangeAdmin(deployer.getSender(), pool.address);
        expect(adminTransferResult.transactions).toHaveTransaction({
                         on: poolJetton.address,
                         success: true,
        });
        const controllerDeployResult = await pool.sendRequestControllerDeploy(deployer.getSender(), toNano('100000'), 0);
        expect(controllerDeployResult.transactions).toHaveTransaction({
            from: pool.address,
            to: controller.address,
            deploy: true,
            success: true,
        });
        const approveResult = await controller.sendApprove(deployer.getSender());
        expect(approveResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: controller.address,
            success: true,
        });
        newVset();
        toElections();
        normalState = blockchain.snapshot();
    });

    beforeEach(async () =>  await blockchain.loadFrom(normalState) );

    it('Deposit fee for one', async () => {
        const poolBalanceBefore = (await pool.getFinanceData()).totalBalance;

        const depositAmount = getRandomTon(10, 100000);
        const depositResult = await pool.sendDeposit(wallets[0].getSender(), depositAmount);

        let excesses = 0n;
        expect(depositResult.transactions).not.toHaveTransaction({
            to: wallets[0].address,
            value: (x) => {excesses += x? x : 0n; return false}
        });

        newVset();
        toElections();

        const touchResult = await pool.sendTouch(deployer.getSender());
        expect(touchResult.transactions).not.toHaveTransaction({
            to: wallets[0].address,
            value: (x) => {excesses += x? x : 0n; return false}
        });

        const poolBalanceAfter = (await pool.getFinanceData()).totalBalance;
        const balanceDifference = poolBalanceAfter - poolBalanceBefore;
        const poolSideDepositFee = depositAmount - balanceDifference;

        console.log(`
                    FEES FOR ONE
            Pool side deposit fee: ${fromNano(poolSideDepositFee)} TON
            Excesses (returned to nominator): ${fromNano(excesses)} TON
            Real fee: ${fromNano(poolSideDepositFee - excesses)} TON
        `)
    });
});

