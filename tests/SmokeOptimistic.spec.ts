import { Blockchain, SandboxContract, TreasuryContract } from '@ton-community/sandbox';
import { Cell, toNano, Dictionary, beginCell } from 'ton-core';
import { Pool } from '../wrappers/Pool';
import { Controller } from '../wrappers/Controller';
import { DAOJettonMinter, jettonContentToCell } from '../wrappers/DAOJettonMinter';
import {JettonWallet as PoolJettonWallet } from '../contracts/jetton_dao/wrappers/JettonWallet';
import {JettonWallet as DepositWallet} from '../contracts/awaited_minter/wrappers/JettonWallet';
import {JettonWallet as WithdrawalWallet} from '../contracts/awaited_minter/wrappers/JettonWallet';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';

const loadConfig = (config:Cell) => {
          return config.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());
        };

describe('Pool', () => {
    let pool_code: Cell;
    let controller_code: Cell;
    let payout_minter_code: Cell;
    let payout_wallet_code: Cell;

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
        payout_minter_code = await compile('PayoutMinter');
        payout_wallet_code = await compile('PayoutWallet');

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

    let prevWallet: SandboxContract<DepositWallet>;
    it('should deposit', async () => {
        //await blockchain.setVerbosityForAddress(pool.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
        const depositResult = await pool.sendDeposit(deployer.getSender(), toNano('10'));
        let myPoolJettonWalletAddress = await poolJetton.getWalletAddress(deployer.address);
        let myPoolJettonWallet = blockchain.openContract(PoolJettonWallet.createFromAddress(myPoolJettonWalletAddress));


        expect(depositResult.transactions).toHaveTransaction({
            from: myPoolJettonWallet.address,
            on: deployer.address,
            op: 0x7362d09c, // excesses
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
            from: pool.address,
            on: deployer.address,
            op: 0x31777cdc, // excesses
            success: true,
        });

    });
});
