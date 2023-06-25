import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano, TupleBuilder, Dictionary, DictionaryValue } from 'ton-core';

import { JettonMinter as AwaitedJettonMinter} from '../contracts/awaited_minter/wrappers/JettonMinter';

import { Conf, Op, PoolState } from "../PoolConstants";

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
type RoundData = {borrowers: Cell | null, roundId: number,
                                  activeBorrowers: bigint, borrowed: bigint,
                                  expected: bigint, returned: bigint,
                                  profit: bigint};

type State = typeof PoolState.NORMAL | typeof PoolState.REPAYMENT_ONLY;
export type PoolFullConfig = {
  state: State;
  halted: boolean;
  totalBalance: bigint;
  poolJetton: Address;
  poolJettonSupply: bigint;
  depositMinter: Address | null;
  requestedForDeposit: bigint | null;
  withdrawalMinter: Address | null;
  requestedForWithdrawal: bigint | null;
  interestRate: number;
  optimisticDepositWithdrawals: boolean;
  depositsOpen: boolean;
  savedValidatorSetHash: bigint;
  currentRound: RoundData;
  prevRound: RoundData;

  minLoanPerValidator: bigint;
  maxLoanPerValidator: bigint;

  governanceFee: number;

  sudoer: Address;
  sudoerSetAt: number;
  governor: Address;
  governorUpdateAfter: number;
  interest_manager: Address;
  halter: Address;
  approver: Address;

  controller_code: Cell;
  pool_jetton_wallet_code: Cell;
  payout_minter_code: Cell;
};

export type PoolData = Awaited<ReturnType<InstanceType<typeof Pool>['getFullData']>>;

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
                   .storeUint(0xffffffffffff, 48) // givernor update after
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
              .storeInt(0n, 1) // halted?
              .storeCoins(0) // total_balance
              .storeRef(mintersData)
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
              .storeCoins(100 * 1000000000) // min_loan_per_validator
              .storeCoins(1000000 * 1000000000) // max_loan_per_validator
              .storeUint(655, 16) // governance fee
              .storeRef(roles)
              .storeRef(codes)
           .endCell();
}

export function dataToFullConfig(data: PoolData) : PoolFullConfig {
  /*
   * I know we could use Object.keys/Object.assign kind of magic.
   * But i feel like it should be explicit for easier TS
   * level debug if any fields of either type changes.
   * Let's do it dumb and reliable way
   */
  return {
    state: data.state as (0 | 1),
    halted: data.halted,
    totalBalance: data.totalBalance,
    poolJetton: data.poolJettonMinter,
    poolJettonSupply: data.poolJettonSupply,
    depositMinter: data.depositPayout,
    requestedForDeposit: data.requestedForDeposit,
    withdrawalMinter: data.withdrawalPayout,
    requestedForWithdrawal: data.requestedForWithdrawal,
    interestRate: data.interestRate,
    optimisticDepositWithdrawals: data.optimisticDepositWithdrawals,
    depositsOpen: data.depositsOpen,
    savedValidatorSetHash: data.savedValidatorSetHash,
    currentRound: data.currentRound,
    prevRound: data.previousRound,
    minLoanPerValidator: data.minLoan,
    maxLoanPerValidator: data.maxLoan,
    governanceFee: data.governanceFee,
    sudoer: data.sudoer,
    sudoerSetAt: data.sudoerSetAt,
    governor: data.governor,
    interest_manager: data.interestManager,
    halter: data.halter,
    approver: data.approver,
    controller_code: data.controllerCode,
    pool_jetton_wallet_code: data.jettonWalletCode,
    payout_minter_code: data.payoutMinterCode,
    governorUpdateAfter: 0xffffffffffff
  };
}

export function poolFullConfigToCell(config: PoolFullConfig): Cell {
    let abs = (x:bigint) => { return x < 0n ? -x : x };
    let serializeRoundData = (round: RoundData) => beginCell()
                             .storeMaybeRef(round.borrowers)
                             .storeUint(round.roundId, 32) // round_id
                             .storeUint(round.activeBorrowers, 32) // active borrowers
                             .storeCoins(round.borrowed) // borrowed
                             .storeCoins(round.expected) // expected
                             .storeCoins(round.returned) // returned
                             .storeUint(Number(round.profit < 0), 1) // profit sign
                             .storeCoins(abs(round.profit)) // profit
                         .endCell();

    let mintersData = beginCell()
                          .storeAddress(config.poolJetton)
                          .storeCoins(config.poolJettonSupply);
    if(config.depositMinter) {
      mintersData = mintersData.storeUint(1, 1)
                               .storeUint(0, 1)
                               .storeAddress(config.depositMinter!)
                               .storeCoins(config.requestedForDeposit!);
    } else {
      mintersData = mintersData.storeUint(0, 1);
    }
    if(config.withdrawalMinter) {
      mintersData = mintersData.storeUint(1, 1)
                               .storeBit(0)
                               .storeAddress(config.withdrawalMinter!)
                               .storeCoins(config.requestedForWithdrawal!);
    } else {
      mintersData = mintersData.storeUint(0, 1);
    }
    let minters:Cell = mintersData.endCell();
    let roles = beginCell()
                   .storeAddress(config.sudoer)
                   .storeUint(config.sudoerSetAt, 48) // sudoer set at
                   .storeAddress(config.governor)
                   .storeUint(config.governorUpdateAfter, 48) // givernor update after
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
              .storeUint(config.state, 8) // state NORMAL
              .storeBit(config.halted) // halted?
              .storeCoins(config.totalBalance) // total_balance
              .storeRef(minters)
              .storeUint(config.interestRate, 16) // minimal interest_rate
              .storeBit(config.optimisticDepositWithdrawals) // optimistic_deposit_withdrawals
              .storeBit(config.depositsOpen) // deposits_open?
              .storeUint(config.savedValidatorSetHash, 256) // saved_validator_set_hash
              .storeRef(
                beginCell()
                  .storeRef(serializeRoundData(config.currentRound))
                  .storeRef(serializeRoundData(config.prevRound))
                .endCell()
              )
              .storeCoins(config.minLoanPerValidator) // min_loan_per_validator
              .storeCoins(config.maxLoanPerValidator) // max_loan_per_validator
              .storeUint(config.governanceFee, 16) // governance fee
              .storeRef(roles)
              .storeRef(codes)
           .endCell();
}

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
                     .storeUint(Op.pool.touch, 32) // op = touch
                     .storeUint(0, 64) // query id
                  .endCell(),
        });
    }

    async sendRequestControllerDeploy(provider: ContractProvider, via: Sender, value: bigint, controllerId: number) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(Op.pool.deploy_controller, 32) // op = pool::deploy_controller
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
                     .storeUint(Op.pool.deposit, 32) // op = pool::deposit
                     .storeUint(1, 64) // query id
                  .endCell(),
        });
   }
    async sendSetDepositSettings(provider: ContractProvider, via: Sender, value: bigint, optimistic: Boolean, depositOpen: Boolean) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(Op.governor.set_deposit_settings, 32) // op = setDepositSettings
                     .storeUint(1, 64) // query id
                     .storeUint(Number(optimistic), 1)
                     .storeUint(Number(depositOpen), 1)
                  .endCell(),
        });
    }

    async sendTouch(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            value: toNano('0.1'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(Op.pool.touch, 32) // op = touch
                     .storeUint(1, 64) // query id
                  .endCell(),
        });
    }


    async sendUpgrade(provider: ContractProvider, via: Sender,
                      data: Cell | null, code: Cell | null, afterUpgrade: Cell | null) {
        //upgrade#96e7f528 query_id:uint64
        //data:(Maybe ^Cell) code:(Maybe ^Cell) after_upgrade:(Maybe ^Cell) = InternalMsgBody;

        await provider.internal(via, {
            value: toNano('0.5'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(Op.sudo.upgrade, 32) // op = touch
                     .storeUint(1, 64) // query id
                     .storeMaybeRef(data)
                     .storeMaybeRef(code)
                     .storeMaybeRef(afterUpgrade)
                  .endCell(),
        });
    }

    async sendSetGovernorFee(provider: ContractProvider, via: Sender, newFee: number, value: bigint = toNano("0.1")) {
        await provider.internal(via, {
            value, sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                    .storeUint(Op.governor.set_governance_fee, 32)
                    .storeUint(1, 64)
                    .storeUint(newFee, 16)
                  .endCell(),
        });
    }

    // Get methods
    /*
    async getDepositPayout(provider: ContractProvider) {
        let res = await provider.get('get_current_round_deposit_payout', []);
        let minter = res.stack.readAddress();
        return AwaitedJettonMinter.createFromAddress(minter);
    }
    async getWithdrawalPayout(provider: ContractProvider) {
        let res = await provider.get('get_current_round_withdrawal_payout', []);
        let minter = res.stack.readAddress();
        return AwaitedJettonMinter.createFromAddress(minter);
    }
    */
    async getDepositMinter(provider: ContractProvider) {
        let res = await this.getFullData(provider);
        return AwaitedJettonMinter.createFromAddress(res.depositPayout!);
    }

    async getWithdrawalMinter(provider: ContractProvider) {
        let res = await this.getFullData(provider);
        return AwaitedJettonMinter.createFromAddress(res.withdrawalPayout!);
    }
    async getFinanceData(provider: ContractProvider) {
        return await this.getFullData(provider);
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
        let res = await this.getFullData(provider);
        return res.currentRound.roundId;
    }
    async getBorrowersDict(provider: ContractProvider, previous=false) {
       let res = await this.getFullData(provider);
       let borrowers = res.currentRound.borrowers;
        if(previous) {
           borrowers = res.previousRound.borrowers;
        }
        if (borrowers == null) {
            return Dictionary.empty();
        }
        const dict = Dictionary.loadDirect(Dictionary.Keys.BigInt(256), BorrowerDiscriptionValue, borrowers.asSlice());
        return dict;
    }

    async getMinMaxLoanPerValidator(provider: ContractProvider) {
        let res = await this.getFullData(provider);
        return {min: res.minLoan, max: res.maxLoan};
    }


    async getFullData(provider: ContractProvider) {
        let { stack } = await provider.get('get_pool_full_data', []);
        let state = stack.readNumber() as State;
        let halted = stack.readBoolean();
        let totalBalance = stack.readBigNumber();
        let interestRate = stack.readNumber();
        let optimisticDepositWithdrawals = stack.readBoolean();
        let depositsOpen = stack.readBoolean();
        let savedValidatorSetHash = stack.readBigNumber();

        let prv = stack.readTuple();
        let prvBorrowers = prv.readCellOpt();
        let prvRoundId = prv.readNumber();
        let prvActiveBorrowers = prv.readBigNumber();
        let prvBorrowed = prv.readBigNumber();
        let prvExpected = prv.readBigNumber();
        let prvReturned = prv.readBigNumber();
        let prvProfit = prv.readBigNumber();
        let previousRound = {
          borrowers: prvBorrowers,
          roundId: prvRoundId,
          activeBorrowers: prvActiveBorrowers,
          borrowed: prvBorrowed,
          expected: prvExpected,
          returned: prvReturned,
          profit: prvProfit
        };

        let cur = stack.readTuple();
        let curBorrowers = cur.readCellOpt();
        let curRoundId = cur.readNumber();
        let curActiveBorrowers = cur.readBigNumber();
        let curBorrowed = cur.readBigNumber();
        let curExpected = cur.readBigNumber();
        let curReturned = cur.readBigNumber();
        let curProfit = cur.readBigNumber();
        let currentRound = {
          borrowers: curBorrowers,
          roundId: curRoundId,
          activeBorrowers: curActiveBorrowers,
          borrowed: curBorrowed,
          expected: curExpected,
          returned: curReturned,
          profit: curProfit
        };

        let minLoan = stack.readBigNumber();
        let maxLoan = stack.readBigNumber();
        let governanceFee = stack.readNumber();


        let poolJettonMinter = stack.readAddress();
        let poolJettonSupply = stack.readBigNumber();

        let depositPayout = stack.readAddressOpt();
        let requestedForDeposit = stack.readBigNumber();

        let withdrawalPayout = stack.readAddressOpt();
        let requestedForWithdrawal = stack.readBigNumber();

        let sudoer = stack.readAddress();
        let sudoerSetAt = stack.readNumber();

        let governor = stack.readAddress();
        let interestManager = stack.readAddress();
        let halter = stack.readAddress();
        let approver = stack.readAddress();

        let controllerCode = stack.readCell();
        let jettonWalletCode = stack.readCell();
        let payoutMinterCode = stack.readCell();

        let projectedPoolSupply = stack.readBigNumber();
        let projectedTotalBalance = stack.readBigNumber();

        return {
            state, halted,
            totalBalance, interestRate,
            optimisticDepositWithdrawals, depositsOpen,
            savedValidatorSetHash,

            previousRound, currentRound,

            minLoan, maxLoan,
            governanceFee,

            poolJettonMinter, poolJettonSupply, supply:poolJettonSupply,
            depositPayout, requestedForDeposit,
            withdrawalPayout, requestedForWithdrawal,

            sudoer, sudoerSetAt,
            governor,
            interestManager,
            halter,
            approver,

            controllerCode,
            jettonWalletCode,
            payoutMinterCode,
            projectedPoolSupply,
            projectedTotalBalance
        };
    }

}
