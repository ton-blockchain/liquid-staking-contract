import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from 'ton-core';

export const Op = {
    nft_transfer: 0x5fcc3d14,
    jetton_transfer: 0xf8a7ea5,
    ownership_assigned: 0x05138d91,
    excesses: 0xd53276db,
};

export type PayoutItemConfig = {
    index: bigint
    admin: Address
};

export function itemConfigToCell(config: PayoutItemConfig): Cell {
    return beginCell()
             .storeBit(false)
             .storeAddress(config.admin)
             .storeUint(config.index, 64)
           .endCell();
}

export class PayoutItem implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new PayoutItem(address);
    }
    static createFromConfig(config: PayoutItemConfig, code: Cell, workchain = 0) {
        const data = itemConfigToCell(config);
        const init = { code, data };
        return new PayoutItem(contractAddress(workchain, init), init);
    }

    async send(provider: ContractProvider, via: Sender, value: bigint, body: Cell) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: body,
        });
    }

    async getNFTData(provider: ContractProvider) {
        const { stack } = await provider.get('get_nft_data', []);
        const inited = stack.readBoolean();
        const index = stack.readNumber();
        const collection = stack.readAddress();
        const owner = stack.readAddress();
        return { inited, index, collection, owner };
    }

}
