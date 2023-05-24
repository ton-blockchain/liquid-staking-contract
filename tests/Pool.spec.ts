import { Blockchain, SandboxContract, TreasuryContract } from '@ton-community/sandbox';
import { Cell, toNano, Dictionary, beginCell } from 'ton-core';
import { Pool } from '../wrappers/Pool';
import { Controller } from '../wrappers/Controller';
import { DAOJettonMinter, jettonContentToCell } from '../wrappers/DAOJettonMinter';
import {JettonWallet as PoolJettonWallet } from '../contracts/jetton_dao/wrappers/JettonWallet';
import {JettonWallet as AwaitedJettonWallet} from '../contracts/awaited_minter/wrappers/JettonWallet';
import {JettonWallet as AwaitedTonWallet} from '../contracts/awaited_minter/wrappers/JettonWallet';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';

const loadConfig = (config:Cell) => {
          return config.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());
        };

describe('Pool', () => {
    let pool_code: Cell;
    let controller_code: Cell;
    let awaited_minter_code: Cell;
    let awaited_wallet_code: Cell;

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
        pool_code = await compile('Pool');
        controller_code = await compile('Controller');
        awaited_minter_code = await compile('AwaitedJettonMinter');
        awaited_wallet_code = await compile('AwaitedJettonWallet');

        dao_minter_code = await compile('DAOJettonMinter');
        dao_wallet_code = await compile('DAOJettonWallet');
        dao_vote_keeper_code = await compile('DAOVoteKeeper');
        dao_voting_code = await compile('DAOVoting');

        blockchain = await Blockchain.create();

        deployer = await blockchain.treasury('deployer', {balance: toNano("1000000000")});

        const content = jettonContentToCell({type:1,uri:"https://example.com/1.json"});
        poolJetton  = blockchain.openContract(DAOJettonMinter.createFromConfig({
                                                  admin:deployer.address,
                                                  content,
                                                  wallet_code:dao_wallet_code,
                                                  voting_code:dao_voting_code,
                                                  vote_keeper_code:dao_vote_keeper_code},
                                                  dao_minter_code));
        let poolConfig = {
              pool_jetton : poolJetton.address,
              pool_jetton_supply : 0n,

              sudoer : deployer.address,
              governor : deployer.address,
              interest_manager : deployer.address,
              halter : deployer.address,
              consigliere : deployer.address,
              approver : deployer.address,

              controller_code : controller_code,
              awaited_jetton_wallet_code : awaited_wallet_code,
              pool_jetton_wallet_code : dao_wallet_code,
              payout_minter_code : awaited_minter_code,
              vote_keeper_code : dao_vote_keeper_code,
        };

        pool = blockchain.openContract(Pool.createFromConfig(poolConfig, pool_code));
        let controllerConfig = {
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
        const controllerDeployResult = await pool.sendRequestControllerDeploy(deployer.getSender(), toNano('100000'));
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

    let prevWallet: SandboxContract<AwaitedJettonWallet>;
    it('should deposit', async () => {
        //await blockchain.setVerbosityForAddress(pool.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
        const depositResult = await pool.sendDeposit(deployer.getSender(), toNano('10'));
        let awaitedJettonMinter = blockchain.openContract(await pool.getAwaitedJettonMinter());
        let myAwaitedJettonWallet = await awaitedJettonMinter.getWalletAddress(deployer.address);
        prevWallet = blockchain.openContract(AwaitedJettonWallet.createFromAddress(myAwaitedJettonWallet));
        expect(depositResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: pool.address,
            success: true,
        });
        expect(depositResult.transactions).toHaveTransaction({
            from: myAwaitedJettonWallet,
            on: deployer.address,
            op: 0x7362d09c, // transfer notification
            success: true,
        });
        expect(depositResult.transactions).toHaveTransaction({
            on: awaitedJettonMinter.address,
            op: 0xf5aa8943, // init
            deploy: true,
            success: true,
        });

        const deposit2Result = await pool.sendDeposit(deployer.getSender(), toNano('10'));
        expect(deposit2Result.transactions).not.toHaveTransaction({
            on: awaitedJettonMinter.address,
            op: 0xf5aa8943, // init
        });
        expect(deposit2Result.transactions).toHaveTransaction({
            from: myAwaitedJettonWallet,
            on: deployer.address,
            op: 0x7362d09c, // transfer notification
            success: true,
        });
    });

    it('should rotate round', async () => {

        let prevAwaitedJettonMinter = blockchain.openContract(await pool.getAwaitedJettonMinter());
        //await blockchain.setVerbosityForAddress(prevAwaitedJettonMinter.address, {blockchainLogs:true, vmLogs: 'vm_logs'});

        const confDict = loadConfig(blockchain.config);
        confDict.set(34, beginCell().storeUint(0x12, 8).storeUint(0, 32).storeUint(0xffffffff, 32).endCell());
        blockchain.setConfig(beginCell().storeDictDirect(confDict).endCell());


        const depositResult = await pool.sendDeposit(deployer.getSender(), toNano('1.05'));

        let awaitedJettonMinter = blockchain.openContract(await pool.getAwaitedJettonMinter());
        let myAwaitedJettonWallet = await awaitedJettonMinter.getWalletAddress(deployer.address);
        expect(depositResult.transactions).toHaveTransaction({
            on: prevAwaitedJettonMinter.address,
            success: true,
        });
        expect(depositResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: pool.address,
            success: true,
        });
        expect(depositResult.transactions).toHaveTransaction({
            from: myAwaitedJettonWallet,
            on: deployer.address,
            op: 0x7362d09c, // transfer notification
            success: true,
        });
        expect(depositResult.transactions).toHaveTransaction({
            on: awaitedJettonMinter.address,
            op: 0xf5aa8943, // init
            deploy: true,
            success: true,
        });
        expect(depositResult.transactions).toHaveTransaction({
            on: poolJetton.address,
            success: true,
            op:0x1674b0a0 //mint
        });
        let payoutJettonWalletAddress = await poolJetton.getWalletAddress(prevAwaitedJettonMinter.address);

        expect(depositResult.transactions).toHaveTransaction({
            on: payoutJettonWalletAddress,
            from: poolJetton.address,
            success: true,
        });
    });

    it('should pay out jettons', async () => {
        //await blockchain.setVerbosityForAddress(pool.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
        const awJettonAmount = await prevWallet.getJettonBalance();
        const burnResult = await prevWallet.sendBurn(deployer.getSender(), toNano('1.0'), awJettonAmount, deployer.address, null);
        let myPoolJettonWalletAddress = await poolJetton.getWalletAddress(deployer.address);
        let myPoolJettonWallet = blockchain.openContract(PoolJettonWallet.createFromAddress(myPoolJettonWalletAddress));


        expect(burnResult.transactions).toHaveTransaction({
            from: myPoolJettonWallet.address,
            on: deployer.address,
            op: 0xd53276db, // excesses
            success: true,
        });

    });

    it('should withdraw', async () => {
        //await blockchain.setVerbosityForAddress(pool.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
        let myPoolJettonWalletAddress = await poolJetton.getWalletAddress(deployer.address);
        let myPoolJettonWallet = blockchain.openContract(PoolJettonWallet.createFromAddress(myPoolJettonWalletAddress));
        const jettonAmount = await myPoolJettonWallet.getJettonBalance();

        const burnResult = await myPoolJettonWallet.sendBurn(deployer.getSender(), toNano('1.0'), jettonAmount, deployer.address, null);


        expect(burnResult.transactions).toHaveTransaction({
            //from: myAwaitedTonWallet.address,
            on: deployer.address,
            op: 0x7362d09c, // excesses
            success: true,
        });

    });

    it('should pay out tons', async () => {

        let awaitedTonMinter = blockchain.openContract(await pool.getAwaitedTonMinter());
        let myAwaitedTonWalletAddress = await awaitedTonMinter.getWalletAddress(deployer.address);
        let myAwaitedTonWallet = blockchain.openContract(AwaitedTonWallet.createFromAddress(myAwaitedTonWalletAddress));

        // rotate round another time
        const confDict = loadConfig(blockchain.config);
        confDict.set(34, beginCell().storeUint(0x12, 8).storeUint(0, 32).storeUint(0xffffffef, 32).endCell());
        blockchain.setConfig(beginCell().storeDictDirect(confDict).endCell());
        //touch pool to trigger rotate
        //await blockchain.setVerbosityForAddress(pool.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
        const roundRotateResult = await pool.sendDeposit(deployer.getSender(), toNano('1000000'));

        expect(roundRotateResult.transactions).toHaveTransaction({
            from: pool.address,
            on: awaitedTonMinter.address,
            op: 0x1140a64f, // start_distribution
            success: true,
        });

        const jettonAmount = await myAwaitedTonWallet.getJettonBalance();
        const burnResult = await myAwaitedTonWallet.sendBurn(deployer.getSender(), toNano('1.0'), jettonAmount, deployer.address, null);


        expect(burnResult.transactions).toHaveTransaction({
            //from: myAwaitedTonWallet.address,
            on: deployer.address,
            op: 0xdb3b8abd, // distribution
            success: true,
        });

    });

    it('should lend money', async () => {
        // rotate round another time
        const confDict = loadConfig(blockchain.config);
        confDict.set(34, beginCell().storeUint(0x12, 8).storeUint(0, 32).storeUint(Math.floor(Date.now() / 1000)+ 10000, 32).endCell());
        blockchain.setConfig(beginCell().storeDictDirect(confDict).endCell());
        //touch pool to trigger rotate
        //await blockchain.setVerbosityForAddress(pool.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
        const secondDeposit = await pool.sendDeposit(deployer.getSender(), toNano('1000000'));

        const controllerDeployResult = await controller.sendLoanRequest(deployer.getSender(), toNano('1000'), toNano('10000'), 1000n);
        expect(controllerDeployResult.transactions).toHaveTransaction({
                         from: deployer.address,
                         to: controller.address,
                         success: true,
        });
        expect(controllerDeployResult.transactions).toHaveTransaction({
                         from: controller.address,
                         to: pool.address,
                         success: true,
        });
        expect(controllerDeployResult.transactions).toHaveTransaction({
                         from: pool.address,
                         to: controller.address,
                         success: true,
                         op:0x1690c604
        });

    });



    it('controller should return money to pool', async () => {

        const confDict = loadConfig(blockchain.config);
        confDict.set(34, beginCell().storeUint(0x12, 8).storeUint(Math.floor(Date.now() / 1000)+ 12000, 32).storeUint(Math.floor(Date.now() / 1000)+ 20000, 32).endCell());
        blockchain.setConfig(beginCell().storeDictDirect(confDict).endCell());

        //await blockchain.setVerbosityForAddress(pool.address, {blockchainLogs:true, vmLogs: 'vm_logs'});

        const controllerDeployResult = await controller.sendReturnUnusedLoan(deployer.getSender());

        expect(controllerDeployResult.transactions).toHaveTransaction({
                         from: deployer.address,
                         to: controller.address,
                         success: true,
        });
        expect(controllerDeployResult.transactions).toHaveTransaction({
                         from: controller.address,
                         to: pool.address,
                         op:0xdfdca27b,
                         success: true,
        });

    });
});
