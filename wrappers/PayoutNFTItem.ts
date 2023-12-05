import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from '@ton/core';
import { Op } from './PayoutNFTCollection';

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

    async sendBurn(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            value: value,
            body: beginCell()
                    .storeUint(Op.burn, 32)
                    .storeUint(0, 64) // op, queryId
                  .endCell()
        });
    }

    async getNFTData(provider: ContractProvider) {
        const { stack } = await provider.get('get_nft_data', []);
        const inited = stack.readBoolean();
        const index = stack.readNumber();
        const collection = stack.readAddress();
        const owner = stack.readAddress();
        const content = stack.readCell();
        return { inited, index, collection, owner, content };
    }

    async getBillAmount(provider: ContractProvider) {
        // bill amount stored in a content cell like coins
        const { content } = await this.getNFTData(provider);
        const cs = content.beginParse();
        return cs.loadCoins();
    }
}
