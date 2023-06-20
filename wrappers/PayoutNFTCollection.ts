import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano, TupleBuilder } from 'ton-core';

// storage scheme
// storage#_ issued_bills:Coins
//           admin:MsgAddress
//           distribution:^Cell
//           collection_content:^Cell
//           ^[
//                next_item_index:uint64
//                prev:MsgAddress current:MsgAddress next:MsgAddress
//                next_state_init:^Cell
//            ]
//           = Storage;

export type PayoutCollectionConfig = {
    admin: Address
    content: Cell
};

export type Distribution = {
    active: boolean
    isJetton: boolean
    volume: bigint
    myJettonWallet?: Address
}

export const Op = {
    nft_transfer: 0x5fcc3d14,
    jetton_transfer: 0xf8a7ea5,
    ownership_assigned: 0x05138d91,
    excesses: 0xd53276db,
    get_static_data: 0x2fcb26a2,
    report_static_data: 0x8b771735,
    get_royalty_params: 0x693d3950,
    report_royalty_params: 0xa8cb00ad,
    burn: 0xf127fe4e,
    burn_notification: 0xed58b0b2,
    init_nft: 0x132f9a45,
    init_collection: 0xf5aa8943,
    distributed_asset: 0xdb3b8abd,
    start_distribution: 0x1140a64f,
    transfer_notification: 0x7362d09c,
    mint_nft: 0x1674b0a0
};

export const Errors = {
    unauthorized: 401,
    no_forward_payload: 708,
    not_enough_tons: 402,
    unauthorized_init: 0xffff,
    unknown_opcode: 406,
    wrong_chain: 333,

    burn_before_distribution: 66,
    need_init: 67,
    distribution_already_started: 68,
    cannot_distribute_jettons: 69,
    cannot_distribute_tons: 70,
    unknown_jetton_wallet: 71,
    mint_after_distribution_start: 72,
    unauthorized_mint_request: 73,
    unauthorized_burn_notification: 74,
    discovery_fee_not_matched: 75,
    unauthorized_change_admin_request: 76,
    unauthorized_change_content_request: 77,
    unauthorized_change_distibutor_request: 78,
    unauthorized_transfer_source: 79,
    unauthorized_start_request: 80,
    wallet_balance_below_min: 81,
}


export function payoutCollectionConfigToCell(config: PayoutCollectionConfig): Cell {
    return beginCell()
                      .storeCoins(0)
                      .storeAddress(config.admin)
                      .storeMaybeRef(null) // no dsitribution data on init
                      .storeRef(config.content)
           .endCell();
}

export function packDistribution(distribution: Distribution) {
    const c = beginCell()
        .storeBit(distribution.active)
        .storeBit(distribution.isJetton)
        .storeCoins(distribution.volume)
    if (distribution.isJetton) {
        c.storeAddress(distribution.myJettonWallet!)
    }
    return c.endCell();
}

export class PayoutCollection implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new PayoutCollection(address);
    }

    static createFromConfig(config: PayoutCollectionConfig, code: Cell, workchain = 0) {
        const data = payoutCollectionConfigToCell(config);
        const init = { code, data };
        return new PayoutCollection(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, distribution: Distribution, value: bigint) {
        if (distribution.active) {
            throw new Error('Distribution should be not active');
        }
        const distributionCell = packDistribution(distribution);
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                    .storeUint(Op.init_collection, 32).storeUint(0, 64)
                    .storeRef(distributionCell)
                  .endCell(),
        });
    }

    static mintMessage(to: Address, weight: bigint, queryId: bigint = 0n) {
        return beginCell().storeUint(Op.mint_nft, 32).storeUint(queryId, 64) // op, queryId
                          .storeAddress(to).storeCoins(weight)
               .endCell();
    }

    async sendMint(provider: ContractProvider, via: Sender, to: Address, weight: bigint, value: bigint = toNano("0.5"), queryId: bigint = 0n) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: PayoutCollection.mintMessage(to, weight, queryId),
            value: value,
        });
    }

    async send(provider: ContractProvider, via: Sender, value: bigint, body: Cell) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: body,
        });
    }

    static startDistributionMessage(queryId: bigint = 0n) {
        return beginCell().storeUint(0x1140a64f, 32).storeUint(queryId, 64) // op, queryId
                                .endCell()
    }
    async sendStartDistribution(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: PayoutCollection.startDistributionMessage()
        });
    }

    async getDistribution(provider: ContractProvider): Promise<Distribution> {
        let res = await provider.get('get_distribution_data', []);
        let distribution = res.stack.readCell().beginParse();
        let active = distribution.loadBit();
        let isJetton = distribution.loadBit();
        return {
            active,
            isJetton,
            volume: distribution.loadCoins(),
            myJettonWallet: isJetton ? distribution.loadAddress() : undefined,
        }
    }

    async getCollectionData(provider: ContractProvider) {
        let { stack } = await provider.get('get_collection_data', []);
        let nextItemIndex = stack.readBigNumber();
        let collectionContent = stack.readCell();
        let admin = stack.readAddress();
        return { nextItemIndex, collectionContent, admin }
    }

    async getNFTAddress(provider: ContractProvider, index: bigint) {
        const args = new TupleBuilder()
        args.writeNumber(index)
        const { stack } = await provider.get('get_nft_address_by_index', args.build());
        return stack.readAddress();
    }

    async getTotalBill(provider: ContractProvider) {
        const { stack } = await provider.get('get_issued_bills', []);
        return stack.readBigNumber();
    }
}
