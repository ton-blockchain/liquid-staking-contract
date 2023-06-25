import { Blockchain, SandboxContract, internal, TreasuryContract, BlockchainSnapshot, printTransactionFees } from '@ton-community/sandbox';
import { Cell, toNano, fromNano, beginCell, Address, Dictionary } from 'ton-core';
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

describe('Fees Printer', () => {
    let blockchain: Blockchain;

    let pool_code: Cell;
    let controller_code: Cell;
    let payout_minter_code: Cell;
    let payout_wallet_code: Cell;
    let payout_collection: Cell;

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

    let optimistic = true;
    let nftDistribution = false;

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

    async function deployAll () {
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

        payout_collection = await compile('PayoutNFTCollection');

        pool_code = await compile('Pool');
        controller_code = readCompiled('Controller');

        dao_wallet_code = await compile('DAOJettonWallet');
        dao_minter_code = await compile('DAOJettonMinter');
        dao_vote_keeper_code = await compile('DAOVoteKeeper');
        dao_voting_code = await compile('DAOVoting');

        //TODO add instead of set
        const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
        _libs.set(BigInt(`0x${dao_wallet_code.hash().toString('hex')}`), dao_wallet_code);
        const libs = beginCell().storeDictDirect(_libs).endCell();
        blockchain.libs = libs;

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
              optimistic_deposit_withdrawals: optimistic ? -1n : 0n,

              sudoer : deployer.address,
              governor : deployer.address,
              interest_manager : deployer.address,
              halter : deployer.address,
              consigliere : deployer.address,
              approver : deployer.address,

              controller_code : controller_code,
              payout_wallet_code : payout_wallet_code,
              pool_jetton_wallet_code : dao_wallet_code,
              payout_minter_code : nftDistribution ? payout_collection : payout_minter_code,
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
        await pool.sendTouch(deployer.getSender());
        normalState = blockchain.snapshot();
    }

    async function deposit5Optimistic (header: string) {
        let poolBalanceBefore = (await pool.getFinanceData()).totalBalance;
        const poolBalanceBeforeAll = poolBalanceBefore;

        const depositAmount = toNano(100);
        const gasAttached = toNano(1);

        let diffs: bigint[] = [];
        let fees: bigint[] = [];
        let deposits: bigint[] = [];
        for (let i = 0; i < wallets.length; i++) {
            const balanceBefore = await wallets[i].getBalance();
            let x = await pool.sendDeposit(wallets[i].getSender(), depositAmount + gasAttached);
            //printTransactionFees(x.transactions);
            let poolBalanceNow = (await pool.getFinanceData()).totalBalance;
            const addedToPool = poolBalanceNow - poolBalanceBefore;
            deposits.push(addedToPool);
            const walletBalanceNow = await wallets[i].getBalance();
            const diff = balanceBefore - walletBalanceNow;
            diffs.push(diff);
            fees.push(diff - addedToPool);
            poolBalanceBefore = poolBalanceNow;
        }

        const totalAdded = poolBalanceBefore - poolBalanceBeforeAll;
        const totalDiff = diffs.reduce((a, b) => a + b, 0n);
        const totalFee = totalDiff - totalAdded;

        let toPrint = `     ${header}\n`;
        /*for (let i = 0; i < wallets.length; i++) {
            toPrint += `
              #${i + 1}
                Sent for deposit: ${fromNano(depositAmount)} + ${fromNano(gasAttached)} TON
                Balance decrease: ${fromNano(diffs[i])} TON
                Deposited: ${fromNano(deposits[i])} TON
                Deposit cost: ${fromNano(fees[i])} TON
            `;
        }*/
        toPrint += `
          TOTAL
            Sent for deposit: ${fromNano(totalAdded)} + ${fromNano(gasAttached * BigInt(wallets.length))} TON
            Balance decrease: ${fromNano(totalDiff)} TON
            Deposited: ${fromNano(totalAdded)} TON
            Average Deposits cost: ${fromNano(totalFee/5n)} TON
        `;
        console.log(toPrint);
    }

    async function deposit5 (header: string) {
        let poolBalanceBefore = (await pool.getFinanceData()).totalBalance;
        const poolBalanceBeforeAll = poolBalanceBefore;

        const depositAmount = toNano(100);
        const gasAttached = toNano(1);

        let diffs: bigint[] = [];
        let fees: bigint[] = [];
        let deposits: bigint[] = [];
        let balancesBefore: bigint[] = [];
        for (let i = 0; i < wallets.length; i++) {
            balancesBefore.push(await wallets[i].getBalance());
            await pool.sendDeposit(wallets[i].getSender(), depositAmount + gasAttached);
            const poolBalanceNow = (await pool.getFinanceData()).totalBalance;
            const addedToPool = poolBalanceNow - poolBalanceBefore;
            deposits.push(addedToPool);
            poolBalanceBefore = poolBalanceNow;
        }
        const totalAdded = poolBalanceBefore - poolBalanceBeforeAll;

        newVset();
        toElections();
        await pool.sendTouch(deployer.getSender());

        for (let i = 0; i < wallets.length; i++) {
            const balanceAfter = await wallets[i].getBalance();
            const diff = balancesBefore[i] - balanceAfter;
            diffs.push(diff);
            const fee = diff - deposits[i];
            fees.push(fee);
        }

        const totalDiff = diffs.reduce((a, b) => a + b, 0n);
        const totalFee = totalDiff - totalAdded;

        let toPrint = `     ${header}\n`;
        /*for (let i = 0; i < wallets.length; i++) {
            toPrint += `
              #${i + 1}
                Sent for deposit: ${fromNano(depositAmount)} + ${fromNano(gasAttached)} TON
                Balance decrease: ${fromNano(diffs[i])} TON
                Deposited: ${fromNano(deposits[i])} TON
                Deposit cost: ${fromNano(fees[i])} TON
            `;
        }*/
        toPrint += `
          TOTAL
            Sent for deposit: ${fromNano(totalAdded)} + ${fromNano(gasAttached * BigInt(wallets.length))} TON
            Balance decrease: ${fromNano(totalDiff)} TON
            Deposited: ${fromNano(totalAdded)} TON
            Average Deposits cost: ${fromNano(totalFee/5n)} TON
        `;
        console.log(toPrint);
    }

    describe('Deposit Optimistic', () => {
        beforeAll(deployAll);

        it('5 new wallets', async () => {
            await deposit5Optimistic("5 WITH NEW WALLETS (OPTIMISTIC)");
        });

        it('5 existing wallets', async () => {
            await deposit5Optimistic("5 WITH EXISTING WALLETS (OPTIMISTIC)")
        });

        it('5 new but first rotates the round', async () => {
            await blockchain.loadFrom(normalState);
            newVset();
            toElections();
            await deposit5Optimistic("5 WITH NEW WALLETS, FIRST ROTATES (OPTIMISTIC)");
        });

        it('5 times from the same wallet', async () => {
            await blockchain.loadFrom(normalState);
            wallets = [wallets[0], wallets[0], wallets[0], wallets[0], wallets[0]];
            await deposit5Optimistic("5 FROM THE SAME WALLET (OPTIMISTIC)");
        });
    });

    optimistic = false;
    describe('Deposit Normal', () => {
        beforeAll(deployAll);
        it('5 new wallets', async () => {
            await deposit5("5 WITH NEW WALLETS (NORMAL)");
        });
        it('5 existing wallets', async () => {
            await deposit5("5 WITH EXISTING WALLETS (NORMAL)")
        });
        it('5 new but first rotates the round', async () => {
            await blockchain.loadFrom(normalState);
            newVset();
            toElections();
            await deposit5("5 WITH NEW WALLETS, FIRST ROTATES (NORMAL)");
        });
    });

    optimistic = true;
    nftDistribution = true;
    describe('Deposit Optimistic NFT', () => {
        beforeAll(deployAll);
        it('5 new wallets', async () => {
            await deposit5Optimistic("5 WITH NEW WALLETS (NFT)");
        });

        it('5 existing wallets', async () => {
            await deposit5Optimistic("5 WITH EXISTING WALLETS (NFT)")
        });

        it('5 new but first rotates the round', async () => {
            await blockchain.loadFrom(normalState);
            newVset();
            toElections();
            await deposit5Optimistic("5 WITH NEW WALLETS, FIRST ROTATES (NFT)");
        });

        it('5 times from the same wallet', async () => {
            await blockchain.loadFrom(normalState);
            wallets = [wallets[0], wallets[0], wallets[0], wallets[0], wallets[0]];
            await deposit5Optimistic("5 FROM THE SAME WALLET (NFT)");
        });

    });
});

