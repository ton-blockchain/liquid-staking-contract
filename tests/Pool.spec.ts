import { Blockchain, SandboxContract } from '@ton-community/sandbox';
import { Cell, toNano } from 'ton-core';
import { Pool } from '../wrappers/Pool';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';

describe('Pool', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('Pool');
    });

    let blockchain: Blockchain;
    let pool: SandboxContract<Pool>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        pool = blockchain.openContract(Pool.createFromConfig({}, code));

        const deployer = await blockchain.treasury('deployer');

        const deployResult = await pool.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and pool are ready to use
    });
});
