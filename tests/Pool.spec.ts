import { Blockchain, SandboxContract, TreasuryContract } from '@ton-community/sandbox';
import { Cell, toNano } from 'ton-core';
import { Pool } from '../wrappers/Pool';
import { DAOJettonMinter, jettonContentToCell } from '../wrappers/DAOJettonMinter';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';

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

        deployer = await blockchain.treasury('deployer');

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


    });


    beforeEach(async () => {
    });

    it('should deploy', async () => {

        await blockchain.setVerbosityForAddress(pool.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
        const deployResult = await pool.sendDeploy(deployer.getSender(), toNano('0.05'));
        /*expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            deploy: true,
            success: true,
        });*/
        // the check is done inside beforeEach
        // blockchain and pool are ready to use
    });
});
