import { Address, toNano, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from 'ton-core';


export type ControllerConfig = {

  controllerId: number;
  validator: Address;
  pool: Address;
  governor: Address;
  approver: Address;
  halter: Address;
  
};

export function controllerConfigToCell(config: ControllerConfig): Cell {
    return beginCell()
              .storeUint(0, 8)   // state NORMAL
              .storeUint(0, 1)   // approved
              .storeCoins(0)     // stake_amount_sent
              .storeUint(0, 48)  // stake_at
              .storeUint(0, 256) // saved_validator_set_hash
              .storeUint(0, 8)   // validator_set_changes_count
              .storeUint(0, 48)  // validator_set_change_time
              .storeUint(0, 48)  // stake_held_for
              .storeCoins(0)     // borrowed_amount
              .storeUint(0, 48)  // borrowing_time
              .storeUint(0, 2)   // sudoer addr_none
              .storeUint(0, 48)  // sudoer_set_at
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

    async sendDeploy(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            value: toNano('20000'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(0xd372158c, 32) // op = top up
                     .storeUint(0, 64) // query id
                  .endCell(),
        });
    }

    async sendApprove(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            value: toNano('0.1'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(0x7b4b42e6, 32) // op
                     .storeUint(1, 64) // query id
                  .endCell(),
        });
    }

    async sendLoanRequest(provider: ContractProvider, via: Sender, minLoan: bigint, maxLoan: bigint, maxInterest: bigint) {
        await provider.internal(via, {
            value: toNano('0.5'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(0x452f7112, 32) // op = controller::send_request_loan
                     .storeUint(1, 64) // query id
                     .storeCoins(minLoan)
                     .storeCoins(maxLoan)
                     .storeUint(maxInterest, 16)
                  .endCell(),
        });
    }
    async sendReturnUnusedLoan(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            value: toNano('0.5'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(0xed7378a6, 32) // op
                     .storeUint(1, 64) // query id
                  .endCell(),
        });
    }
}
