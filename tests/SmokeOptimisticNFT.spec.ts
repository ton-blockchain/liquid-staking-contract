import { Blockchain, SandboxContract, TreasuryContract, prettyLogTransactions } from '@ton/sandbox';
import { Cell, toNano, Dictionary, beginCell } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { Controller } from '../wrappers/Controller';
import { JettonMinter as DAOJettonMinter, jettonContentToCell } from '../contracts/jetton_dao/wrappers/JettonMinter';
import { JettonWallet as PoolJettonWallet } from '../wrappers/JettonWallet';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { Conf, Op } from "../PoolConstants";
import { getElectionsConf, getVset, loadConfig, packValidatorsSet } from "../wrappers/ValidatorUtils";


describe('Pool', () => {
    let pool_code: Cell;
    let controller_code: Cell;
    let payout_collection: Cell;

    let dao_minter_code: Cell;
    let dao_wallet_code: Cell;
    let dao_vote_keeper_code: Cell;
    let dao_voting_code: Cell;

    let blockchain: Blockchain;
    let pool: SandboxContract<Pool>;
    let controller: SandboxContract<Controller>;
    let poolJetton: SandboxContract<DAOJettonMinter>;
    let deployer: SandboxContract<TreasuryContract>;

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

    beforeAll(async () => {
        blockchain = await Blockchain.create();
        blockchain.now = 100;
        deployer = await blockchain.treasury('deployer', {balance: toNano("1000000000")});

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
                                                  voting_code:dao_voting_code},
                                                  dao_minter_code));
        let poolConfig = {
              pool_jetton : poolJetton.address,
              pool_jetton_supply : 0n,
              optimistic_deposit_withdrawals: -1n,

              sudoer : deployer.address,
              governor : deployer.address,
              interest_manager : deployer.address,
              halter : deployer.address,
              approver : deployer.address,

              controller_code : controller_code,
              pool_jetton_wallet_code : dao_wallet_code,
              payout_minter_code : payout_collection,
              vote_keeper_code : dao_vote_keeper_code,
        };

        pool = blockchain.openContract(Pool.createFromConfig(poolConfig, pool_code));
        let controllerConfig = {
          controllerId:0,
          validator: deployer.address,
          pool: pool.address,
          governor: deployer.address,
          approver: deployer.address,
          halter: deployer.address,
        };
        controller = blockchain.openContract(Controller.createFromConfig(controllerConfig, controller_code));
    });


    beforeEach(async () => {
    });

    it('should deploy', async () => {

        //await blockchain.setVerbosityForAddress(pool.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
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
    });

    it('should deposit', async () => {
        //await blockchain.setVerbosityForAddress(pool.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
        const depositResult = await pool.sendDeposit(deployer.getSender(), toNano('10'));
        let myPoolJettonWalletAddress = await poolJetton.getWalletAddress(deployer.address);
        let myPoolJettonWallet = blockchain.openContract(PoolJettonWallet.createFromAddress(myPoolJettonWalletAddress));


        expect(depositResult.transactions).toHaveTransaction({
            from: myPoolJettonWallet.address,
            on: deployer.address,
            op: Op.jetton.transfer_notification,
            success: true,
        });
    });

    it('should withdraw', async () => {
        //await blockchain.setVerbosityForAddress(pool.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
        let myPoolJettonWalletAddress = await poolJetton.getWalletAddress(deployer.address);
        let myPoolJettonWallet = blockchain.openContract(PoolJettonWallet.createFromAddress(myPoolJettonWalletAddress));
        const jettonAmount = await myPoolJettonWallet.getJettonBalance();

        const burnResult = await myPoolJettonWallet.sendBurnWithParams(deployer.getSender(), toNano('1.0'), jettonAmount, deployer.address, false, false);

        expect(burnResult.transactions).toHaveTransaction({
            from: pool.address,
            on: deployer.address,
            op: Op.pool.withdrawal,
            success: true,
        });

    });


    it('should withdraw with different params', async () => {
        //await blockchain.setVerbosityForAddress(pool.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
         const depositResult = await pool.sendDeposit(deployer.getSender(), toNano('10'));
         let myPoolJettonWalletAddress = await poolJetton.getWalletAddress(deployer.address);
         let myPoolJettonWallet = blockchain.openContract(PoolJettonWallet.createFromAddress(myPoolJettonWalletAddress));

         let oldJettonAmount = await myPoolJettonWallet.getJettonBalance();
         let withdrawalAmount = toNano('1.0');
         let oldBalance = (await blockchain.getContract(deployer.address)).balance;

         // immediate withdrawal, fill or kill = false
         let burnResult = await myPoolJettonWallet.sendBurnWithParams(deployer.getSender(), toNano('1.0'), withdrawalAmount, deployer.address, false, false);
         expect(burnResult.transactions).toHaveTransaction({
            on: pool.address,
            success: true,
         });
         expect((await blockchain.getContract(deployer.address)).balance - oldBalance > toNano('0.9')).toBeTruthy();
         expect(oldJettonAmount - await myPoolJettonWallet.getJettonBalance()).toEqual(withdrawalAmount);

         oldJettonAmount = await myPoolJettonWallet.getJettonBalance();
         oldBalance = (await blockchain.getContract(deployer.address)).balance;

         // immediate withdrawal, fill or kill = true
         burnResult = await myPoolJettonWallet.sendBurnWithParams(deployer.getSender(), toNano('1.0'), withdrawalAmount, deployer.address, false, true);
         expect(burnResult.transactions).toHaveTransaction({
            on: pool.address,
            success: true,
         });
         expect((await blockchain.getContract(deployer.address)).balance - oldBalance > toNano('0.9')).toBeTruthy();
         expect(oldJettonAmount - await myPoolJettonWallet.getJettonBalance()).toEqual(withdrawalAmount);

         oldJettonAmount = await myPoolJettonWallet.getJettonBalance();
         oldBalance = (await blockchain.getContract(deployer.address)).balance;

         // wait till the end withdrawal, fill or kill = false
         burnResult = await myPoolJettonWallet.sendBurnWithParams(deployer.getSender(), toNano('1.0'), withdrawalAmount, deployer.address, true, false);
         expect(burnResult.transactions).toHaveTransaction({
            on: pool.address,
            success: true,
         });
         expect((await blockchain.getContract(deployer.address)).balance - oldBalance < 0n).toBeTruthy();
         expect(oldJettonAmount - await myPoolJettonWallet.getJettonBalance()).toEqual(withdrawalAmount);

         oldJettonAmount = await myPoolJettonWallet.getJettonBalance();
         oldBalance = (await blockchain.getContract(deployer.address)).balance;

         // wait till the end withdrawal, fill or kill = true
         // contradicting options, burn should be reverted
         burnResult = await myPoolJettonWallet.sendBurnWithParams(deployer.getSender(), toNano('1.0'), withdrawalAmount, deployer.address, true, true);
         expect(burnResult.transactions).toHaveTransaction({
            on: pool.address,
            success: true
         });
         expect((await blockchain.getContract(deployer.address)).balance - oldBalance < 0n).toBeTruthy();
         expect(oldJettonAmount - await myPoolJettonWallet.getJettonBalance()).toEqual(0n);

         oldJettonAmount = await myPoolJettonWallet.getJettonBalance();
         oldBalance = (await blockchain.getContract(deployer.address)).balance;

    });

    it('should not withdraw zero optimistically', async () => {
         newVset();
         //await blockchain.setVerbosityForAddress(pool.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
         let depositResult = await pool.sendDeposit(deployer.getSender(), toNano('10'));
         let myPoolJettonWalletAddress = await poolJetton.getWalletAddress(deployer.address);
         let myPoolJettonWallet = blockchain.openContract(PoolJettonWallet.createFromAddress(myPoolJettonWalletAddress));

         let oldJettonAmount = await myPoolJettonWallet.getJettonBalance();
         let withdrawalAmount = 1n;
         let oldBalance = (await blockchain.getContract(deployer.address)).balance;

         // rate is lower than 1, burning 1nanoJetton leads to issuing zero nanoTONs
         let burnResult = await myPoolJettonWallet.sendBurnWithParams(deployer.getSender(), toNano('1.0'), withdrawalAmount, deployer.address, false, false);
         expect(burnResult.transactions).toHaveTransaction({
            on: deployer.address,
            op: Op.jetton.transfer_notification,
         });
         expect(burnResult.transactions).not.toHaveTransaction({
            on: deployer.address,
            op: Op.pool.withdrawal,
         });
         // 1 nanoTON deposit -> ~1 nanoJetton issuing, should pass
         depositResult = await pool.sendDeposit(deployer.getSender(), toNano('1') + 1n);
         expect(depositResult.transactions).toHaveTransaction({
            on: pool.address,
            success: true,
         });
    });

    it('should not withdraw zero through NFT', async () => {
         newVset();

         //await blockchain.setVerbosityForAddress(pool.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
         let depositResult = await pool.sendDeposit(deployer.getSender(), toNano('10'));
         let myPoolJettonWalletAddress = await poolJetton.getWalletAddress(deployer.address);
         let myPoolJettonWallet = blockchain.openContract(PoolJettonWallet.createFromAddress(myPoolJettonWalletAddress));

         let oldJettonAmount = await myPoolJettonWallet.getJettonBalance();
         let withdrawalAmount = 0n;
         let oldBalance = (await blockchain.getContract(deployer.address)).balance;

         // rate is lower than 1, burning 1nanoJetton leads to issuing zero nanoTONs
         let burnResult = await myPoolJettonWallet.sendBurnWithParams(deployer.getSender(), toNano('1.0'), withdrawalAmount, deployer.address, true, false);
         expect(burnResult.transactions).toHaveTransaction({
            on: deployer.address,
            op: Op.jetton.transfer_notification,
         });
         expect(burnResult.transactions).not.toHaveTransaction({
            on: deployer.address,
            op: Op.nft.ownership_assigned,
         });
         // 1 nanoTON deposit -> ~1 nanoJetton issuing, should pass
         depositResult = await pool.sendDeposit(deployer.getSender(), toNano('1') + 1n);
         expect(depositResult.transactions).toHaveTransaction({
            on: deployer.address,
            op: Op.jetton.transfer_notification,
         });
    });

    it('should not deposit zero optimistically', async () => {
         newVset();
         let myPoolJettonWalletAddress = await poolJetton.getWalletAddress(deployer.address);
         let myPoolJettonWallet = blockchain.openContract(PoolJettonWallet.createFromAddress(myPoolJettonWalletAddress));
         await pool.sendDonate(deployer.getSender(), toNano('1000'));
         // now rate is higher than 1, opposite situation
         let burnResult = await myPoolJettonWallet.sendBurnWithParams(deployer.getSender(), toNano('1.0'), 1n, deployer.address, false, false);
         expect(burnResult.transactions).toHaveTransaction({
            on: pool.address,
            success: true,
         });
         let depositResult = await pool.sendDeposit(deployer.getSender(), toNano('1') + 1n);
         expect(depositResult.transactions).toHaveTransaction({
            on: pool.address,
            success: false,
         });
    });



});
