import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from 'ton-core';
import { DAOJettonMinter } from './DAOJettonMinter';
import {JettonMinter as AwaitedJettonMinter} from '../contracts/awaited_minter/wrappers/JettonMinter';


export type PoolConfig = {
  pool_jetton: Address;
  pool_jetton_supply: bigint;
  
  sudoer: Address;
  governor: Address;
  interest_manager: Address;
  halter: Address;
  consigliere: Address;
  approver: Address;
  
  controller_code: Cell;
  awaited_jetton_wallet_code: Cell;
  pool_jetton_wallet_code: Cell;
  payout_minter_code: Cell;
  vote_keeper_code: Cell;
  
};

export function poolConfigToCell(config: PoolConfig): Cell {
    let emptyRoundData = beginCell()
                             .storeUint(0, 1) // empty dict
                             .storeUint(0, 32) // round_id
                             .storeUint(0, 32) // active lenders
                             .storeCoins(0) // lended
                             .storeCoins(0) // returned
                             .storeUint(0, 1) // profit sign
                             .storeCoins(0) // profit
                         .endCell();

    let mintersData = beginCell()
                          .storeAddress(config.pool_jetton)
                          .storeCoins(config.pool_jetton_supply)
                          .storeUint(0, 1) // no awaited_jetton_minter
                          .storeUint(0, 1) // no awaited_ton_minter
                      .endCell();
    let roles = beginCell()
                   .storeAddress(config.sudoer)
                   .storeUint(0, 48) // sudoer set at
                   .storeAddress(config.governor)
                   .storeAddress(config.interest_manager)
                   .storeRef(
                       beginCell()
                         .storeAddress(config.halter)
                         .storeAddress(config.consigliere)
                         .storeAddress(config.approver)
                       .endCell()
                   )
                .endCell();
    let codes = beginCell()
                    .storeRef(config.controller_code)
                    .storeRef(config.awaited_jetton_wallet_code)
                    .storeRef(config.pool_jetton_wallet_code)
                    .storeRef(
                      beginCell()
                        .storeRef(config.payout_minter_code)
                        .storeRef(config.vote_keeper_code)
                      .endCell()
                    )
                .endCell();
    return beginCell()
              .storeUint(0, 8) // state NORMAL
              .storeCoins(0) // total_balance
              .storeUint(100, 18) // interest_rate
              .storeUint(0, 256) // saved_validator_set_hash
              .storeUint(65536, 32) // conversion_ratio
              .storeRef(
                beginCell()
                  .storeRef(emptyRoundData)
                  .storeRef(emptyRoundData)
                .endCell()
              )
              .storeCoins(100 * 1000000000)
              .storeCoins(1000000 * 1000000000)
              .storeUint(3, 8)
              .storeRef(mintersData)
              .storeRef(roles)
              .storeRef(codes)
           .endCell();
}

export class Pool implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new Pool(address);
    }

    static createFromConfig(config: PoolConfig, code: Cell, workchain = 0) {
        const data = poolConfigToCell(config);
        const init = { code, data };
        return new Pool(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(0, 32) // op
                     .storeUint(0, 64) // query id
                  .endCell(),
        });
    }

    async sendDeposit(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(0x4ee5, 32) // op
                     .storeUint(1, 64) // query id
                  .endCell(),
        });
    }









    async getAwaitedJettonMinter(provider: ContractProvider) {
        let res = await provider.get('get_current_round_awaited_jetton_minter', []);
        let minter = res.stack.readAddress();
        return AwaitedJettonMinter.createFromAddress(minter);
    }
    async getAwaitedTonMinter(provider: ContractProvider) {
        let res = await provider.get('get_current_round_awaited_ton_minter', []);
        let minter = res.stack.readAddress();
        return AwaitedJettonMinter.createFromAddress(minter);
    }
}
