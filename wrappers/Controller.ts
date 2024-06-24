import { Address, toNano, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, Message, storeMessage } from '@ton/core';
import { buff2bigint } from '../utils';
import { signData } from "./ValidatorUtils";
import { Conf, Op } from "../PoolConstants";


export type ControllerConfig = {
  controllerId: number;
  validator: Address;
  pool: Address;
  governor: Address;
  approver: Address;
  halter: Address;
};

export type ApproveOptions = {
    startPriorElectionsEnd: number,
    allocation: bigint,
    profitShare: number
};

export function controllerConfigToCell(config: ControllerConfig): Cell {
    return beginCell()
              .storeUint(0, 8)   // state NORMAL
              .storeInt(0n, 1)   // halted?
              .storeInt(0n, 1)   // approved?
              .storeCoins(0)     // stake_amount_sent
              .storeUint(0, 48)  // stake_at
              .storeUint(0, 128) // saved_validator_set_hash
              .storeUint(0, 8)   // validator_set_changes_count
              .storeUint(0, 48)  // validator_set_change_time
              .storeUint(0, 48)  // stake_held_for
              .storeCoins(0)     // borrowed_amount
              .storeUint(0, 48)  // borrowing_time
              .storeUint(0, 2)   // sudoer addr_none
              .storeUint(0, 48)  // sudoer_set_at
              .storeUint(0, 24)  // max_expected_interest
              .storeUint(0, 48)  // allowed_borrow_start_prior_elections_end
              .storeUint(0, 24)  // approver_set_profit_share
              .storeUint(0, 24)  // acceptable_profit_share
              .storeCoins(0)     // allocation
              .storeRef(
                  beginCell()
                  .storeUint(config.controllerId, 32)
                  .storeAddress(config.validator)
                  .storeAddress(config.pool)
                  .storeAddress(config.governor)
                  .storeRef(
                    beginCell()
                        .storeAddress(config.approver)
                        .storeAddress(config.halter)
                    .endCell()
                  )
                  .endCell()
              )
           .endCell();
}

export class Controller implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new Controller(address);
    }

    static createFromConfig(config: ControllerConfig, code: Cell, workchain = -1) {
        const data = controllerConfigToCell(config);
        const init = { code, data };
        return new Controller(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value:bigint = toNano('2000')) {
        await provider.internal(via, {
            value: value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(Op.controller.top_up, 32) // op = top up
                     .storeUint(0, 64) // query id
                  .endCell(),
        });
    }

    async sendTopUp(provider: ContractProvider, via: Sender, value:bigint = toNano('2000')) {
        await provider.internal(via, {
            value: value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(Op.controller.top_up, 32) // op = top up
                     .storeUint(0, 64) // query id
                  .endCell(),
        });
    }

    static creditMessage(credit:bigint, query_id:number | bigint = 0) {
        return beginCell().storeUint(Op.controller.credit, 32)
                          .storeUint(query_id, 64)
                          .storeCoins(credit)
               .endCell();
    }

    async sendCredit(provider: ContractProvider,
                     via: Sender,
                     credit:bigint,
                     value:bigint = toNano('0.1'),
                     query_id?: number | bigint) {
        await provider.internal(via, {
            value: value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Controller.creditMessage(credit, query_id)
        });
    }

    static requestLoanMessage(min_loan: bigint,
                              max_loan: bigint,
                              max_interest: number,
                              acceptable_profit_share: number = 0,
                              query_id: bigint | number = 0) {

        const ds = beginCell().storeUint(Op.controller.send_request_loan, 32)
                              .storeUint(query_id, 64)
                              .storeCoins(min_loan)
                              .storeCoins(max_loan)
                              .storeUint(max_interest, 24)
        if(acceptable_profit_share > 0) {
            ds.storeUint(acceptable_profit_share, 24);
        }
        return ds.endCell();
    }
    async sendRequestLoan(provider: ContractProvider,
                          via: Sender,
                          min_loan: bigint,
                          max_loan: bigint,
                          max_interest: number,
                          acceptable_profit_share: number = 0,
                          value: bigint = toNano('1'),
                          query_id: bigint | number = 0) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Controller.requestLoanMessage(min_loan, max_loan, max_interest, acceptable_profit_share, query_id)
        });
    }

    static approveSimpleMessage(approve: boolean, query_id: bigint | number = 0) {
        const op = approve ? Op.controller.approve : Op.controller.disapprove;

        return beginCell()
                .storeUint(op, 32)
                .storeUint(query_id, 64)
               .endCell();
    }
    async sendApprove(provider: ContractProvider, via: Sender, approve: boolean = true, amount: bigint = toNano('0.1'), query_id: bigint | number = 0) {
        // dissaprove support
        const op = approve ? Op.controller.approve : Op.controller.disapprove;

        await provider.internal(via, {
            value: amount,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Controller.approveSimpleMessage(approve, query_id)
        });
    }

    static approveExtendedMessage(opts: ApproveOptions, query_id: bigint | number = 0) {
        return beginCell()
                .storeUint(Op.controller.approve_extended, 32)
                .storeUint(query_id, 64)
                .storeUint(opts.startPriorElectionsEnd, 48)
                .storeCoins(opts.allocation)
                .storeUint(opts.profitShare, 24)
               .endCell();
    }

    async sendApproveExtended(provider: ContractProvider, via: Sender,
                              opts: ApproveOptions, value: bigint = toNano('0.1'), query_id: bigint | number = 0) {
        await provider.internal(via, {
            value,
            body: Controller.approveExtendedMessage(opts, query_id),
            sendMode: SendMode.PAY_GAS_SEPARATELY
        });
    }

    static updateHashMessage(query_id: bigint | number = 0) {
        return beginCell().storeUint(Op.controller.update_validator_hash, 32)
                          .storeUint(query_id, 64)
               .endCell();
    }

    async sendUpdateHash(provider: ContractProvider,
                         via: Sender,
                         value: bigint = toNano('1'),
                         query_id: bigint | number = 0) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Controller.updateHashMessage()
        });
    }

    async sendReturnUnusedLoan(provider: ContractProvider, via: Sender, value:bigint = toNano('0.5')) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(Op.controller.return_unused_loan, 32) // op
                     .storeUint(1, 64) // query id
                  .endCell(),
        });
    }
    async sendReturnAvailableFunds(provider: ContractProvider, via: Sender, value:bigint = toNano('0.2')) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                    .storeUint(Op.governor.return_available_funds, 32)
                    .storeUint(0, 64)
                  .endCell()
        });
    }
    static validatorWithdrawMessage(amount: bigint, query_id: bigint | number = 0) {
        return beginCell().storeUint(Op.controller.withdraw_validator, 32)
                          .storeUint(query_id, 64)
                          .storeCoins(amount)
               .endCell();
    }

    async sendValidatorWithdraw(provider: ContractProvider, via: Sender, amount: bigint, query_id: bigint | number = 0) {
        await provider.internal(via, {
            value: toNano('10'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Controller.validatorWithdrawMessage(amount, query_id)
        });
    }

    static newStakeMessage(stake_val: bigint,
                           src: Address,
                           public_key: Buffer,
                           private_key: Buffer,
                           stake_at: number | bigint,
                           max_factor: number,
                           adnl_address: bigint,
                           query_id:bigint | number = 1) {

        const signCell = beginCell().storeUint(0x654c5074, 32)
                                    .storeUint(stake_at, 32)
                                    .storeUint(max_factor, 32)
                                    .storeUint(buff2bigint(src.hash), 256)
                                    .storeUint(adnl_address, 256)
                         .endCell()

        const signature = signData(signCell, private_key);

        return  beginCell().storeUint(0x4e73744b, 32)
                           .storeUint(query_id, 64)
                           .storeCoins(stake_val)
                           .storeUint(buff2bigint(public_key), 256)
                           .storeUint(stake_at, 32)
                           .storeUint(max_factor, 32)
                           .storeUint(adnl_address, 256)
                           .storeRef(signature)
                .endCell();
    }


    async sendNewStake(provider: ContractProvider,
                       via: Sender,
                       stake_val: bigint,
                       public_key: Buffer,
                       private_key: Buffer,
                       stake_at: number | bigint,
                       max_factor: number = 1 << 16,
                       adnl_address: bigint = 0n,
                       query_id:bigint | number = 1,
                       value: bigint = Conf.electorOpValue) {
        await provider.internal(via,{
            value,
            body: Controller.newStakeMessage(stake_val,
                                             this.address,
                                             public_key,
                                             private_key,
                                             stake_at,
                                             max_factor,
                                             adnl_address,
                                             query_id),
            sendMode: SendMode.PAY_GAS_SEPARATELY
        });
    }

	  static recoverStakeMessage(query_id: bigint | number = 0) {
	      return beginCell().storeUint(Op.controller.recover_stake, 32).storeUint(query_id, 64).endCell();
	  }

	  async sendRecoverStake(provider: ContractProvider, via: Sender, value:bigint = Conf.electorOpValue, query_id: bigint | number = 0) {
	      await provider.internal(via, {
	          body: Controller.recoverStakeMessage(query_id),
	          sendMode: SendMode.PAY_GAS_SEPARATELY,
	          value
        });
	  }

    async sendSetSudoer(provider: ContractProvider, via: Sender, sudoer: Address, value: bigint = toNano('1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            value,
            body: beginCell().storeUint(Op.governor.set_sudoer, 32)
                             .storeUint(1, 64)
                             .storeAddress(sudoer)
                  .endCell()
        });
    }

    async sendSudoMsg(provider: ContractProvider, via: Sender, mode:number, msg: Message, query_id: bigint | number = 0) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            value : toNano('1'),
            body: beginCell().storeUint(Op.sudo.send_message, 32)
                             .storeUint(query_id, 64)
                             .storeUint(mode, 8)
                             .storeRef(beginCell().store(storeMessage(msg)).endCell())
                  .endCell()
        });
    }

    async sendHaltMessage(provider: ContractProvider, via: Sender, query_id: bigint | number = 0) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            value: toNano('1'),
            body: beginCell().storeUint(Op.halter.halt, 32)
                             .storeUint(query_id, 64)
                  .endCell()
        });
    }

    async sendUnhalt(provider: ContractProvider, via: Sender, query_id: bigint | number = 0) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            value: toNano('1'),
            body: beginCell().storeUint(Op.governor.unhalt, 32)
                             .storeUint(query_id, 64)
                  .endCell()
        });
    }

    // Get methods
    async getControllerData(provider: ContractProvider) {
        const {stack} = await provider.get('get_validator_controller_data', []);
        return {
            state: stack.readNumber(),
            halted: stack.readBoolean(),
            approved: stack.readBoolean(),
            stakeSent: stack.readBigNumber(),
            stakeAt: stack.readNumber(),
            validatorSetHash: stack.readBigNumber(),
            validatorSetChangeCount: stack.readNumber(),
            validatorSetChangeTime: stack.readNumber(),
            stakeHeldFor: stack.readNumber(),
            interest: stack.readNumber(),
            allowedBorrowStartPriorElectionsEnd: stack.readNumber(),
            approverSetProfitShare: stack.readNumber(),
            acceptableProfitShare: stack.readNumber(),
            allocation: stack.readBigNumber(),
            borrowedAmount: stack.readBigNumber(),
            borrowingTime: stack.readNumber(),
            validator: stack.readAddress(),
            pool: stack.readAddress(),
            sudoer: stack.readAddressOpt()
        };
    }
    async getValidatorAmount(provider: ContractProvider) {
        const res = await this.getControllerData(provider);
        const state = await provider.getState();
        return state.balance - res.borrowedAmount;
    }

    async getMaxPunishment(provider: ContractProvider, stake:bigint) {
        const {stack} = await provider.get('get_max_punishment', [{type:"int", value:stake}]);
        return stack.readBigNumber();
    }

    async getBalanceForLoan(provider: ContractProvider, credit:bigint, interest:bigint | number) {
        const {stack} = await provider.get('required_balance_for_loan', [
            {type: "int", value: credit},
            {type: "int", value: BigInt(interest)}
        ]);
        return stack.readBigNumber();
    }

    async getRequestWindow(provider: ContractProvider) {
        const { stack } = await provider.get("request_window_time", [])
        return {
            since: stack.readNumber(),
            until: stack.readNumber()
        };
    }
}
