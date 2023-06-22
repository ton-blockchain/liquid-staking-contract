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
import { readFileSync } from 'fs';


export function readCompiled(name: string): Cell {
    const filename = 'build/' + name + '.compiled.json';
    return Cell.fromBoc(Buffer.from(JSON.parse(readFileSync(filename, 'utf8')).hex, 'hex'))[0];
}

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
        payout_minter_code = readCompiled('PayoutMinter');
        payout_wallet_code = readCompiled('PayoutWallet');

        pool_code = readCompiled('Pool');
        controller_code = readCompiled('Controller');

        dao_minter_code = readCompiled('DAOJettonMinter');
        dao_wallet_code = readCompiled('DAOJettonWallet');
        dao_vote_keeper_code = readCompiled('DAOVoteKeeper');
        dao_voting_code = readCompiled('DAOVoting');

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
              optimistic_deposit_withdrawals: -1n,

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

    // beforeEach(async () =>  await blockchain.loadFrom(normalState) );
    //
    async function deposit5 (header: string) {
        let balancesBefore = await Promise.all(wallets.map(w => w.getBalance()));
        let poolBalanceBefore = (await pool.getFinanceData()).totalBalance;
        const poolBalanceBeforeAll = poolBalanceBefore;

        const depositAmount = toNano(100);
        const gasAttached = toNano(1)

        let diffs: bigint[] = [];
        let fees: bigint[] = [];
        for (let i = 0; i < wallets.length; i++) {
            await pool.sendDeposit(wallets[i].getSender(), depositAmount + gasAttached);
            let poolBalanceNow = (await pool.getFinanceData()).totalBalance;
            const addedToPool = poolBalanceNow - poolBalanceBefore;
            expect(addedToPool).toBe(depositAmount);
            const walletBalanceNow = await wallets[i].getBalance();
            const diff = balancesBefore[i] - walletBalanceNow;
            diffs.push(diff);
            fees.push(diff - addedToPool);
            poolBalanceBefore = poolBalanceNow;
        }

        const totalAdded = poolBalanceBefore - poolBalanceBeforeAll;
        const totalDiff = diffs.reduce((a, b) => a + b, 0n);
        const totalFee = totalDiff - totalAdded;

        let toPrint = `     ${header}\n`;
        for (let i = 0; i < wallets.length; i++) {
            toPrint += `
                #${i + 1}
                Sent for deposit: ${fromNano(depositAmount)} + ${fromNano(gasAttached)} TON
                Balance decrease: ${fromNano(diffs[i])} TON
                Deposited: ${fromNano(depositAmount)} TON
                Deposit cost: ${fromNano(fees[i])} TON
            `;
        }
        toPrint += `
            TOTAL
            Sent for deposit: ${fromNano(totalAdded)} + ${fromNano(gasAttached * BigInt(wallets.length))} TON
            Balance decrease: ${fromNano(totalDiff)} TON
            Deposited: ${fromNano(totalAdded)} TON
            Deposits cost: ${fromNano(totalFee)} TON
        `;
        console.log(toPrint);
    }

    it('Deposit fee for 5 new wallets', async () => {
        await deposit5("5 WITH NEW WALLETS (OPTIMISTIC)");
    });

    it('Deposit fee for 5 existing wallets', async () => {
        // Rotate round
        // newVset();
        // toElections();
        // await pool.sendTouch(deployer.getSender());

        await deposit5("5 WITH EXISTING WALLETS (OPTIMISTIC)")
    });
});
