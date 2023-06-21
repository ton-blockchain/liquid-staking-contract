import { Blockchain, SandboxContract, TreasuryContract } from '@ton-community/sandbox';
import { Cell, toNano, Dictionary, beginCell } from 'ton-core';
import { Pool } from '../wrappers/Pool';
import { Controller } from '../wrappers/Controller';
import { JettonMinter as DAOJettonMinter, jettonContentToCell } from '../contracts/jetton_dao/wrappers/JettonMinter';
import { JettonWallet as PoolJettonWallet } from '../wrappers/JettonWallet';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { Conf, Op } from "../PoolConstants";

const loadConfig = (config:Cell) => {
          return config.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());
        };

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

    beforeAll(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer', {balance: toNano("1000000000")});

        payout_collection = await compile('PayoutNFTCollection');

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
              consigliere : deployer.address,
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

});
