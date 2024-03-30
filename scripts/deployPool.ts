import { Address, Cell, toNano, beginCell } from 'ton-core';
import { Pool, dataToFullConfig, poolFullConfigToCell } from '../wrappers/Pool';
import { PoolState } from "../PoolConstants";
import { JettonMinter as DAOJettonMinter, jettonContentToCell } from '../contracts/jetton_dao/wrappers/JettonMinter';
import { compile, NetworkProvider, sleep } from '@ton-community/blueprint';
import {JettonWallet as PoolJettonWallet } from '../wrappers/JettonWallet';
import { Controller } from '../wrappers/Controller';
import { Librarian, LibrarianConfig } from '../wrappers/Librarian';


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

    const librarian_code = await compile('Librarian');
    const pool_code = await compile('Pool');
    const controller_code = await compile('Controller');

    const payout_collection = await compile('PayoutNFTCollection');

    const dao_minter_code = await compile('DAOJettonMinter');
    let dao_wallet_code_raw = await compile('DAOJettonWallet');
    const dao_vote_keeper_code = await compile('DAOVoteKeeper');
    const dao_voting_code = await compile('DAOVoting');

    let lib_prep = beginCell().storeUint(2,8).storeBuffer(dao_wallet_code_raw.hash()).endCell();
    const dao_wallet_code = new Cell({ exotic:true, bits: lib_prep.bits, refs:lib_prep.refs});

    const content = jettonContentToCell({type:1,uri:"https://gist.githubusercontent.com/EmelyanenkoK/cf435a18de72141c236218cbf3ce1102/raw/dc723a2ac22717ef0101e8a3d58b14e311d6c1c7/tuna.json?v=2"});

    const minter  = DAOJettonMinter.createFromConfig({
                                                  admin,
                                                  content,
                                                  voting_code:dao_voting_code},
                                                  dao_minter_code);
    let poolFullConfig = {
          state: PoolState.NORMAL as (0 | 1),
          halted: false, // not halted
          totalBalance: 0n,
          poolJetton : minter.address,
          poolJettonSupply : 0n,

          // empty deposits/withdrawals
          depositMinter: null,
          requestedForDeposit: null,
          withdrawalMinter: null,
          requestedForWithdrawal: null,

          // To set X% APY without compound one need to calc
          // (X/100) * (round_seconds/year_seconds) * (2**24)
          interestRate: 1830,
          optimisticDepositWithdrawals: false,
          depositsOpen: true,

          savedValidatorSetHash: 0n,
          currentRound: {borrowers: null, roundId: 0,
                         activeBorrowers: 0n, borrowed: 0n,
                         expected: 0n, returned: 0n,
                         profit: 0n},
          prevRound: {borrowers: null, roundId: 0,
                      activeBorrowers: 0n, borrowed: 0n,
                      expected: 0n, returned: 0n,
                      profit: 0n},

          minLoanPerValidator: toNano('10000'),
          maxLoanPerValidator: toNano('700000'),

          // To set X% put X*(2**24) here
          governanceFee: 2516582,

          sudoer : Address.parse("EQDIeMe7NaJ_tvSMmv_sc--fYie_qUtXTKZgqD7h63JgwLtv"),
          sudoerSetAt: 0,
          governor : Address.parse("EQDYosEog79D4wBvk5QTBhsaXN1yrj96yhop1UYtQZaRwU5w"),
          governorUpdateAfter: 0xffffffffffff,
          interest_manager : Address.parse("EQBhTMRnu4ZpYvNuv7E7S_T6eOQQhxLLY5jFsJ9su1N8L8E9"),
          halter : Address.parse("EQDzykJAVXoLdBT7gpJuk7taV1t47uviG1TkQUCCZQp4fD3S"),
          approver : Address.parse("EQAWPbtEv-ol2HUv26cBUDFRvcSDhRRVxmrnYgXVYf2Y2Aoc"),

          controller_code : controller_code,
          pool_jetton_wallet_code : dao_wallet_code,
          payout_minter_code : payout_collection,
          vote_keeper_code : dao_vote_keeper_code,
    };

    //deploy or use existing librarian
    //const librarian = provider.open(Librarian.createFromConfig({librarianId:0n}, librarian_code));
    //console.log("Librarian address:", librarian.address);
    //await librarian.sendDeploy(provider.sender(), toNano("1"));
    //await waitForTransaction(provider, librarian.address, "Librarian deploy");
    const librarian = provider.open(Librarian.createFromAddress(Address.parse("Ef9ymVquxBIMq3rheG_AzE4WQ7bUGQptF151_yJoEwVyJPZi")));
    await librarian.sendAddLibrary(provider.sender(), dao_wallet_code_raw);
    await waitForTransaction(provider, librarian.address, "dao_wallet_code_raw registering");

    const pool = provider.open(Pool.createFromFullConfig(poolFullConfig, pool_code));

    // Deployment scheme:
    // 1. Deploy DAO Minter with wallet as admin
    // 2. Deploy Pool with DAO Minter as main jetton minter (all other roles set to wallet)
    // 3. Transfer adminship of DAO Minter to Pool

    const poolJetton = provider.open(minter);
    await poolJetton.sendDeploy(provider.sender(), toNano("0.1"));
    await provider.waitForDeploy(poolJetton.address);
    await pool.sendDeploy(provider.sender(), toNano("11"));
    await provider.waitForDeploy(pool.address);
    await poolJetton.sendChangeAdmin(provider.sender(), pool.address);
    await waitForTransaction(provider, poolJetton.address, "transfer adminship of DAO Minter to Pool");

    // Pool can start in pessimistic mode an switch during the round
    /*await pool.sendDeposit(provider.sender(), toNano("2"));
    await waitForTransaction(provider, pool.address, "pessimistic deposit");
    await pool.sendDeposit(provider.sender(), toNano("3"));
    await waitForTransaction(provider, pool.address, "pessimistic deposit 2");
    */
    await pool.sendSetDepositSettings(provider.sender(), toNano("1"), true, true);
    await waitForTransaction(provider, pool.address, "set optimistic deposit settings");

    await pool.sendDeposit(provider.sender(), toNano("100"));
    await waitForTransaction(provider, pool.address, "optimistic deposit");
    await pool.sendDonate(provider.sender(), toNano("1")); //compensate round finalize fee
    await waitForTransaction(provider, pool.address, "donation");
    await pool.sendDeposit(provider.sender(), toNano("100"));
    await waitForTransaction(provider, pool.address, "optimistic deposit 2");

    // For manual pool rotation
    //await pool.sendTouch(provider.sender());

    // For manual controller managing
    //let controller = provider.open(Controller.createFromAddress(Address.parse(" ==INSERT HERE== ")));
    //await controller.sendUpdateHash(provider.sender());
    //await controller.sendApprove(provider.sender());
    //await controller.sendTopUp(provider.sender(), toNano('10000'));

    // For governor
    //await pool.sendSetRoles(provider.sender(), null, Address.parse(" ==INSERT HERE== "), null)
    //await pool.sendSetInterest(provider.sender(), 0.0005);

    // For user
    //let userWallet = provider.open(PoolJettonWallet.createFromAddress(Address.parse(" ==INSERT HERE== ")));
    //await userWallet.sendBurnWithParams(provider.sender(), toNano("1.0"), toNano("100000"), sender.address!, false, false);
    //await new Promise(f => setTimeout(f, 10000));
    //await userWallet.sendTransfer(provider.sender(), toNano("1.0"), toNano("2"), Address.parse(" ==INSERT HERE== "), sender.address!, null, toNano("0.8"), null);

    // For sudoer
    /*
    // How to "safely" update pool data:
    // It is expedient to halt before and unhalt after
    let fullData = await pool.getFullDataRaw();
    let newPoolConfig = dataToFullConfig(fullData);
    //update data here
    newPoolConfig.controller_code = controller_code;
    newPoolConfig.payout_minter_code = payout_collection;
    let storage = poolFullConfigToCell(newPoolConfig);
    await pool.sendUpgrade(provider.sender(), storage, pool_code, null);
    */



}
