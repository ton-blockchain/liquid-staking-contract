import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, TupleBuilder, Dictionary, DictionaryValue } from 'ton-core';
import { JettonMinter as DAOJettonMinter } from '../contracts/jetton_dao/wrappers/JettonMinter';
import { JettonMinter as AwaitedJettonMinter} from '../contracts/awaited_minter/wrappers/JettonMinter';


export type PoolConfig = {
  pool_jetton: Address;
  pool_jetton_supply: bigint;
  optimistic_deposit_withdrawals: bigint;
  
  sudoer: Address;
  governor: Address;
  interest_manager: Address;
  halter: Address;
  consigliere: Address;
  approver: Address;
  
  controller_code: Cell;
  payout_wallet_code?: Cell;
  pool_jetton_wallet_code: Cell;
  payout_minter_code: Cell;
  vote_keeper_code: Cell;
};

export type BorrowerDiscription = {
    borrowed: bigint,
    accounted_interest: bigint
}

export const BorrowerDiscriptionValue: DictionaryValue<BorrowerDiscription> = {
	serialize: (src, builder) => {
        builder.storeCoins(src.borrowed);
        builder.storeCoins(src.accounted_interest);
	},
	parse: (src) => {
        return {
            borrowed: src.loadCoins(),
            accounted_interest: src.loadCoins()
        }
	}
}

export function poolConfigToCell(config: PoolConfig): Cell {
    let emptyRoundData = beginCell()
                             .storeUint(0, 1) // empty dict
                             .storeUint(0, 32) // round_id
                             .storeUint(0, 32) // active borrowers
                             .storeCoins(0) // borrowed
                             .storeCoins(0) // expected
                             .storeCoins(0) // returned
                             .storeUint(0, 1) // profit sign
                             .storeCoins(0) // profit
                         .endCell();

    let mintersData = beginCell()
                          .storeAddress(config.pool_jetton)
                          .storeCoins(config.pool_jetton_supply)
                          .storeUint(0, 1) // no deposit_minter
                          .storeUint(0, 1) // no withdrawal_minter
                      .endCell();
    let roles = beginCell()
                   .storeAddress(config.sudoer)
                   .storeUint(0, 48) // sudoer set at
                   .storeAddress(config.governor)
                   .storeAddress(config.interest_manager)
                   .storeRef(
                       beginCell()
                         .storeAddress(config.halter)
                         .storeAddress(config.approver)
                       .endCell()
                   )
                .endCell();
    let codes = beginCell()
                    .storeRef(config.controller_code)
                    .storeRef(config.pool_jetton_wallet_code)
                    .storeRef(config.payout_minter_code)
                .endCell();
    return beginCell()
              .storeUint(0, 8) // state NORMAL
              .storeCoins(0) // total_balance
              .storeUint(100, 16) // minimal interest_rate
              .storeInt(config.optimistic_deposit_withdrawals, 1) // optimistic_deposit_withdrawals
              .storeInt(-1n, 1) // deposits_open?
              .storeUint(0, 256) // saved_validator_set_hash
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
            //TODO make proper init message
                     .storeUint(0x7247e7a5, 32) // op = unhalt
                     .storeUint(0, 64) // query id
                     .storeUint(0, 8) // query id
                  .endCell(),
        });
    }

    async sendRequestControllerDeploy(provider: ContractProvider, via: Sender, value: bigint, controllerId: number) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(0xdf108122, 32) // op = pool::deploy_controller
                     .storeUint(0, 64) // query id
                     .storeUint(controllerId, 32) // controller_id
                  .endCell(),
        });
    }

    async sendDeposit(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(0x47d54391, 32) // op = pool::deposit
                     .storeUint(1, 64) // query id
                  .endCell(),
        });
    }









    async getDepositPayout(provider: ContractProvider) {
        let res = await provider.get('get_current_round_deposit_payout', []);
        let minter = res.stack.readAddress();
        return AwaitedJettonMinter.createFromAddress(minter);
    }
    async getDepositMinter(provider: ContractProvider) {
        return this.getDepositPayout(provider);
    }
    async getWithdrawalPayout(provider: ContractProvider) {
        let res = await provider.get('get_current_round_withdrawal_payout', []);
        let minter = res.stack.readAddress();
        return AwaitedJettonMinter.createFromAddress(minter);
    }
    async getWithdrawalMinter(provider: ContractProvider) {
        return this.getWithdrawalPayout(provider);
    }
    async getFinanceData(provider: ContractProvider) {
        let { stack } = await provider.get('get_finance_data', []);
        let totalBalance = stack.readBigNumber();
        let supply = stack.readBigNumber();
        let requestedForDeposit = stack.readBigNumber();
        let requestedForWithdrawal = stack.readBigNumber();
        stack.readCell();
        let interestRate = stack.readNumber();
        return {totalBalance, supply, requestedForDeposit, requestedForWithdrawal, interestRate};
    }
    async getMinMaxLoanPerValidator(provider: ContractProvider) {
        let { stack } = await provider.get('get_min_max_loan_per_validator', []);
        let min = stack.readBigNumber();
        let max = stack.readBigNumber();
        return {min, max};
    }
    async getLoan(provider: ContractProvider, controllerId: number, validator: Address, previous=false) {
        const args = new TupleBuilder();
        args.writeNumber(controllerId);
        args.writeAddress(validator);
        args.writeBoolean(previous);
        let { stack } = await provider.get('get_loan', args.build());
        return {
            borrowed: stack.readBigNumber(),
            interestAmount: stack.readBigNumber(),
        }
    }
    async getRoundId(provider: ContractProvider) {
        let { stack } = await provider.get('get_round_index', []);
        return stack.readNumber();
    }
    async getBorrowersDict(provider: ContractProvider, previous=false) {
        const args = new TupleBuilder();
        args.writeBoolean(previous);
        let { stack } = await provider.get('get_borrowers_dict', args.build());
        if (stack.peek().type == 'null')
            return Dictionary.empty();
        const dict = Dictionary.loadDirect(Dictionary.Keys.BigInt(256), BorrowerDiscriptionValue, stack.readCell().asSlice());
        return dict;
    }
}
