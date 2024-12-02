import { Address, Cell, toNano, beginCell } from '@ton/core';
import { Pool, dataToFullConfig, poolFullConfigToCell } from '../wrappers/Pool';
import { PoolState } from "../PoolConstants";
import { JettonMinter as DAOJettonMinter, jettonContentToCell } from '../contracts/jetton_dao/wrappers/JettonMinter';
import { compile, NetworkProvider, sleep } from '@ton/blueprint';
import { JettonWallet as PoolJettonWallet } from '../wrappers/JettonWallet';
import { Controller } from '../wrappers/Controller';
import { Librarian, LibrarianConfig } from '../wrappers/Librarian';
import { Executor } from '../wrappers/SudoerExecutor';

import { Conf, Op } from "../PoolConstants";

const waitForTransaction = async (provider:NetworkProvider, address:Address,
                                  action:string = "transaction",
                                  curTxLt:string | null = null,
                                  maxRetry:number = 15,
                                  interval:number=1000) => {
    let done  = false;
    let count = 0;
    const ui  = provider.ui();
    let blockNum = (await provider.api().getLastBlock()).last.seqno;
    if(curTxLt == null) {
        let initialState = await provider.api().getAccount(blockNum, address);
        let lt = initialState?.account?.last?.lt;
        curTxLt = lt ? lt : null;
    }
    do {
        ui.write(`Awaiting ${action} completion (${++count}/${maxRetry})`);
        await sleep(interval);
        let newBlockNum = (await provider.api().getLastBlock()).last.seqno;
        if (blockNum == newBlockNum) {
            continue;
        }
        blockNum = newBlockNum;
        const curState = await provider.api().getAccount(blockNum, address);
        if(curState?.account?.last !== null){
            done = curState?.account?.last?.lt !== curTxLt;
        }
    } while(!done && count < maxRetry);
    return done;
}

export async function run(provider: NetworkProvider) {

    const sender   = provider.sender();
    const admin:Address = sender.address!;

    const pool_code = await compile('Pool');
    const executor_code = await compile('SudoerExecutor');

    const poolAddress = Address.parse("EQCu_j-5niSEIN_R3qJMWvcjKSdpBJOFz1sJE9JXt549GL42");
    const pool = provider.open(Pool.createFromAddress(poolAddress));

    let initialData = await pool.getFullDataRaw();
    let governor = initialData.governor;

    let executorConfig = {
            mode: 0,
            governance: governor,
            pool: pool.address,
            action: beginCell()
                     .storeUint(Op.sudo.upgrade, 32)
                     .storeUint(1, 64) // query id
                     .storeMaybeRef(null)
                     .storeMaybeRef(pool_code)
                     .storeMaybeRef(null)
                  .endCell(),
    };
    let executor = provider.open(Executor.createFromConfig(executorConfig, executor_code));
    await executor.sendDeploy(provider.sender(), toNano("0.1"));

}
