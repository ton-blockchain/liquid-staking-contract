import { Address, toNano, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, Message, storeMessage } from '@ton/core';


export type ExecutorConfig = {
  mode: number;
  governance: Address;
  pool: Address;
  action: Cell;
};

export function executorConfigToCell(config: ExecutorConfig): Cell {
    return beginCell()
            .storeUint(config.mode, 8)
            .storeAddress(config.governance)
            .storeAddress(config.pool)
            .storeRef(config.action)
        .endCell();

}
export class Executor implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY
        });
    }

    static createFromAddress(address: Address) {
        return new Executor(address);
    }

    static createFromConfig(config: ExecutorConfig, code: Cell, workchain = 0) {
        const data = executorConfigToCell(config);
        const init = { code, data };
        return new Executor(contractAddress(workchain, init), init);
    }

    async sendExecute(provider: ContractProvider, via: Sender, value:bigint = toNano('1')) {
        await provider.internal(via, {
            value: value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(0, 32) // op = comment
                     .storeStringTail("execute")
                  .endCell(),
        });
    }

    async getData(provider: ContractProvider) {
        const { stack } = await provider.get("get_full_executor_data", [])
        const mode = stack.readNumber();
        const governance = stack.readAddress();
        const pool = stack.readAddress();
        const action = stack.readCell();
        const parsed_action = stack.readTuple();
        return {mode, governance, pool, action, parsed_action};
    }
}
