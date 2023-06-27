import { Blockchain, SandboxContract, TreasuryContract, BlockchainSnapshot, printTransactionFees, prettyLogTransactions } from '@ton-community/sandbox';
import { Cell, toNano, fromNano, beginCell, Address, Dictionary } from 'ton-core';
import { Pool } from '../wrappers/Pool';
import { Controller } from '../wrappers/Controller';
import { JettonMinter as DAOJettonMinter, jettonContentToCell } from '../contracts/jetton_dao/wrappers/JettonMinter';
import { JettonWallet as PoolJettonWallet } from '../wrappers/JettonWallet';
import { setConsigliere } from '../wrappers/PayoutMinter.compile';
import { getElectionsConf, getVset, loadConfig, packValidatorsSet } from "../wrappers/ValidatorUtils";
import '@ton-community/test-utils';
import { readFileSync } from 'fs';
import { compile } from '@ton-community/blueprint';

// TODO: something strange with 'first rotates the round' tests.
// do we actually need them?

export function readCompiled(name: string): Cell {
    const filename = 'build/' + name + '.compiled.json';
    return Cell.fromBoc(Buffer.from(JSON.parse(readFileSync(filename, 'utf8')).hex, 'hex'))[0];
}

describe('Withdraw Fees Printer', () => {
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
    let notDeployer: SandboxContract<TreasuryContract>;
    let wallets: SandboxContract<TreasuryContract>[];

    let optimistic = false;
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

    async function deposit5 () {
        const poolBalanceBefore = (await pool.getFinanceData()).totalBalance;
        const depositAmount = toNano(100);
        const gasAttached = toNano(1);

        // deposit from all wallets
        wallets.forEach(async (wallet) => await pool.sendDeposit(wallet.getSender(), depositAmount + gasAttached));
        newVset();
        toElections();
        await pool.sendTouch(deployer.getSender());
        const poolBalanceAfter = (await pool.getFinanceData()).totalBalance;
        const totalAdded = poolBalanceAfter - poolBalanceBefore;
        expect(totalAdded).toBe(depositAmount * BigInt(wallets.length));
    }

    async function deployAll () {
        blockchain = await Blockchain.create();
        blockchain.now = 100;

        deployer = await blockchain.treasury("deployer");
        notDeployer = await blockchain.treasury("notDeployer");

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
        controller_code = await compile('Controller');

        dao_minter_code = await compile('DAOJettonMinter');
        let dao_wallet_code_raw = await compile('DAOJettonWallet');
        dao_vote_keeper_code = await compile('DAOVoteKeeper');
        dao_voting_code = await compile('DAOVoting');

        //TODO add instead of set
        const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
        _libs.set(BigInt(`0x${dao_wallet_code_raw.hash().toString('hex')}`), dao_wallet_code_raw);
        const libs = beginCell().storeDictDirect(_libs).endCell();
        blockchain.libs = libs;
        let lib_prep = beginCell().storeUint(2,8).storeBuffer(dao_wallet_code_raw.hash()).endCell();
        dao_wallet_code = new Cell({ exotic:true, bits: lib_prep.bits, refs:lib_prep.refs});

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
        await deposit5();
        newVset();
        toElections();
        await pool.sendTouch(deployer.getSender());
        normalState = blockchain.snapshot();
    }

    async function withdraw5 (header: string, waitTillRoundEnd: boolean = false, fillOrKill: boolean = false) {
        const poolBalanceBefore = (await pool.getFinanceData()).totalBalance;
        const gasAttached = toNano(1);

        // withdraw from all wallets
        let jAmounts: bigint[] = [];
        let balancesBefore: bigint[] = [];
        let withdrawals: bigint[] = [];
        // want here to withdraw 100% of all deposits
        let jSupply = (await poolJetton.getJettonData()).totalSupply;
        let poolData = (await pool.getFullData());

        for (let i = 0; i < wallets.length; i++) {
            balancesBefore.push(await wallets[i].getBalance());
            let myPoolJettonWalletAddress = await poolJetton.getWalletAddress(wallets[i].address);
            let myPoolJettonWallet = blockchain.openContract(PoolJettonWallet.createFromAddress(myPoolJettonWalletAddress));
            const jettonAmount = await myPoolJettonWallet.getJettonBalance();
            jAmounts.push(jettonAmount);
            const res = await myPoolJettonWallet.sendBurnWithParams(wallets[i].getSender(), gasAttached, jettonAmount, wallets[i].address, waitTillRoundEnd, fillOrKill);
            if(waitTillRoundEnd) { // next round ratio
              withdrawals.push(jettonAmount * poolData.projectedTotalBalance / poolData.projectedPoolSupply);
            } else { // this round ratio
              withdrawals.push(jettonAmount * poolData.totalBalance / poolData.supply);
            }
            // // take incoming distributed amount with unknown source from transactions
            // expect(res.transactions).toHaveTransaction({
            //     to: wallets[i].address,
            //     value: (x) => { if (x) { withdrawals.push(x); return true } else return false },
            // });
        }

        newVset();
        toElections();
        const rotateResult = await pool.sendTouch(notDeployer.getSender());
        //printTransactionFees(rotateResult.transactions);
        let serviceFees = 0n;
        expect(rotateResult.transactions).not.toHaveTransaction({
            from: pool.address,
            to: deployer.address,
            value: (x) => {serviceFees += x!; return false},
        });

        let toPrint = `     ${header}\n`;
        for (let i = 0; i < wallets.length; i++) {

            const balanceAfter = await wallets[i].getBalance();
            const received = balanceAfter - balancesBefore[i];
            const cost = withdrawals[i] - received;
            toPrint += `
               #${i + 1}
                Sent to burn: ${fromNano(gasAttached)} TON
                Pool jettons burned: ${fromNano(jAmounts[i])} / ${fromNano(jSupply)}
                Balance increase: ${fromNano(received)} TON
                Withdrawed amount: ${fromNano(withdrawals[i])} TON
                Withdrawal cost is ${fromNano(cost)} TON
           `;
        }

        const poolBalanceAfter = (await pool.getFinanceData()).totalBalance;
        const totalWithdrawn = poolBalanceBefore - poolBalanceAfter;

        toPrint += `
          TOTAL
            Total withdrawn: ${fromNano(totalWithdrawn)} TON
            Service fees: ${fromNano(serviceFees)} TON
        `;
        console.log(toPrint);
    }
/*
    describe('Withdraw Normal', () => {
        beforeAll(deployAll);
        it('5 new wallets', async () => {
            await withdraw5('5 WITH NEW WALLETS (NORMAL)');
        });
        it('5 new but first rotates the round', async () => {
            await blockchain.loadFrom(normalState);
            newVset();
            toElections();
            await withdraw5("5 WITH NEW WALLETS, FIRST ROTATES (NORMAL)");
        });
    });
*/
    nftDistribution = true;
    optimistic = false;
    describe('Withdraw Optimistic', () => {
        beforeAll(deployAll);
        it('5 new wallets', async () => {
            await withdraw5('5 WITH NEW WALLETS (OPTIMISTIC)');
        });
        it('5 new but first rotates the round', async () => {
            await blockchain.loadFrom(normalState);
            newVset();
            toElections();
            await withdraw5("5 WITH NEW WALLETS, FIRST ROTATES (OPTIMISTIC)");
        });
    });
    optimistic = true;
    describe('Withdraw Optimistic NFT', () => {
        beforeAll(deployAll);
        it('5 new wallets', async () => {
            await withdraw5('5 WITH NEW WALLETS (NFT)');
        });
        it('5 new but wait till round end', async () => {
            await blockchain.loadFrom(normalState);
            newVset();
            toElections();
            await withdraw5("5 WITH NEW WALLETS, FIRST ROTATES (NFT)", true);
        });
    });
});

