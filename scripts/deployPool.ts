import { toNano } from 'ton-core';
import { Pool } from '../wrappers/Pool';
import { compile, NetworkProvider } from '@ton-community/blueprint';

export async function run(provider: NetworkProvider) {
    const pool = provider.open(Pool.createFromConfig({}, await compile('Pool')));

    await pool.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(pool.address);

    // run methods on `pool`
}
