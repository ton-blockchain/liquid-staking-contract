import { toNano } from 'ton-core';
import { Pool } from '../wrappers/Pool';
import { compile, NetworkProvider } from '@ton-community/blueprint';

export async function run(provider: NetworkProvider) {

    const pool_code = await compile('Pool');

    const awaited_minter_code = await compile('AwaitedMinterWallet');
    const awaited_wallet_code = await compile('AwaitedJettonWallet');

    const dao_minter_code = await compile('DAOJettonMinter');
    const dao_wallet_code = await compile('DAOJettonWallet');
    const dao_voting_code = await compile('DAOVoting');
    const dao_vote_keeper_code = await compile('DAOVoteKeeper');
    
    // Deployment scheme:
    // 1. Deploy DAO Minter with wallet as admin
    // 2. Deploy Pool with DAO Minter as main jetton minter (all other roles set to wallet)
    // 3. Transfer adminship of DAO Minter to Pool

    /*const pool = provider.open(Pool.createFromConfig({}, pool_code));

    await pool.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(pool.address);
    */
    // run methods on `pool`
}
