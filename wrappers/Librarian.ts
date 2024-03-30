import { Address, toNano, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, Message, storeMessage } from 'ton-core';


export type LibrarianConfig = {
  librarianId: bigint;
};

export function librarianConfigToCell(config: LibrarianConfig): Cell {
    return beginCell()
              .storeUint(config.librarianId, 32)
           .endCell();
}
export class Librarian implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY
        });
    }

    static createFromAddress(address: Address) {
        return new Librarian(address);
    }

    static createFromConfig(config: LibrarianConfig, code: Cell, workchain = -1) {
        const data = librarianConfigToCell(config);
        const init = { code, data };
        return new Librarian(contractAddress(workchain, init), init);
    }

    async sendAddLibrary(provider: ContractProvider, via: Sender, code:Cell, value:bigint = toNano('250')) {
        await provider.internal(via, {
            value: value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                     .storeUint(0x7f567a32, 32) // op = top up
                     .storeUint(0, 64) // query id
                     .storeUint(2000, 32) // max_cells
                     .storeRef(code)
                  .endCell(),
        });
    }
}
