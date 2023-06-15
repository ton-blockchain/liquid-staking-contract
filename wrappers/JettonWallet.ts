import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano, TupleReader } from 'ton-core';
import { Voting } from './Voting';

export type JettonWalletConfig = {};

export type JettonData = {
    balance: bigint,
    ownerAddress: Address,
    masterAdderss: Address,
    walletCode: Cell,
};

export type DaoData = JettonData & {
   locked: bigint,
   lockExpiration: number
}

export function jettonWalletConfigToCell(config: JettonWalletConfig): Cell {
    return beginCell().endCell();
}

export class JettonWallet implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new JettonWallet(address);
    }

    static createFromConfig(config: JettonWalletConfig, code: Cell, workchain = 0) {
        const data = jettonWalletConfigToCell(config);
        const init = { code, data };
        return new JettonWallet(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async getJettonBalance(provider: ContractProvider) {
        let state = await provider.getState();
        if (state.state.type !== 'active') {
            return 0n;
        }
        let res = await provider.get('get_wallet_data', []);
        return res.stack.readBigNumber();
    }
    static transferMessage(jetton_amount: bigint, to: Address,
                           responseAddress:Address,
                           customPayload: Cell | null,
                           forward_ton_amount: bigint,
                           forwardPayload: Cell | null) {
        return beginCell().storeUint(0xf8a7ea5, 32).storeUint(0, 64) // op, queryId
                          .storeCoins(jetton_amount).storeAddress(to)
                          .storeAddress(responseAddress)
                          .storeMaybeRef(customPayload)
                          .storeCoins(forward_ton_amount)
                          .storeMaybeRef(forwardPayload)
               .endCell();
    }
    async sendTransfer(provider: ContractProvider, via: Sender,
                              value: bigint,
                              jetton_amount: bigint, to: Address,
                              responseAddress:Address,
                              customPayload: Cell | null,
                              forward_ton_amount: bigint,
                              forwardPayload: Cell | null) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonWallet.transferMessage(jetton_amount, to, responseAddress, customPayload, forward_ton_amount, forwardPayload),
            value:value
        });

    }
    /*
      burn#595f07bc query_id:uint64 amount:(VarUInteger 16)
                    response_destination:MsgAddress custom_payload:(Maybe ^Cell)
                    = InternalMsgBody;
    */
    static burnMessage(jetton_amount: bigint,
                       responseAddress:Address,
                       customPayload: Cell | null) {
        return beginCell().storeUint(0x595f07bc, 32).storeUint(0, 64) // op, queryId
                          .storeCoins(jetton_amount).storeAddress(responseAddress)
                          .storeMaybeRef(customPayload)
               .endCell();
    }

    async sendBurn(provider: ContractProvider, via: Sender, value: bigint,
                          jetton_amount: bigint,
                          responseAddress:Address,
                          customPayload: Cell | null) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonWallet.burnMessage(jetton_amount, responseAddress, customPayload),
            value:value
        });

    }
    /*
      withdraw_tons#107c49ef query_id:uint64 = InternalMsgBody;
    */
    static withdrawTonsMessage() {
        return beginCell().storeUint(0x6d8e5e3c, 32).storeUint(0, 64) // op, queryId
               .endCell();
    }

    async sendWithdrawTons(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonWallet.withdrawTonsMessage(),
            value:toNano('0.1')
        });

    }
    /*
      withdraw_jettons#10 query_id:uint64 wallet:MsgAddressInt amount:Coins = InternalMsgBody;
    */
    static withdrawJettonsMessage(from:Address, amount:bigint) {
        return beginCell().storeUint(0x768a50b2, 32).storeUint(0, 64) // op, queryId
                          .storeAddress(from)
                          .storeCoins(amount)
                          .storeMaybeRef(null)
               .endCell();
    }

    async sendWithdrawJettons(provider: ContractProvider, via: Sender, from:Address, amount:bigint) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonWallet.withdrawJettonsMessage(from, amount),
            value:toNano('0.1')
        });

    }

    /*
      vote query_id:uint64 voting_address:MsgAddressInt expiration_date:uint48 vote:Bool need_confirmation:Bool = InternalMsgBody;
    */
    static voteMessage(voting_address:Address, expiration_date:bigint, vote:boolean, need_confirmation:boolean = false) {
        return beginCell().storeUint(0x69fb306c, 32).storeUint(0, 64) // op, queryId
                          .storeAddress(voting_address)
                          .storeUint(expiration_date, 48)
                          .storeBit(vote)
                          .storeBit(need_confirmation)
               .endCell();
    }

    async sendVote(provider: ContractProvider, via: Sender, voting_address:Address, expiration_date:bigint, vote:boolean, need_confirmation:boolean = false) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonWallet.voteMessage(voting_address, expiration_date, vote, need_confirmation),
            value:toNano('0.1')
        });
    }

    static createVotingMessageThroughWallet(expiration_date: bigint, minimal_execution_amount:bigint, payload:Cell, query_id: bigint = 0n, description: string = "Sample description") {
        return beginCell().storeUint(0x318eff17, 32)
                          .storeUint(query_id,64)
                          .storeUint(expiration_date, 48)
                          .storeRef(Voting.createProposalBody(minimal_execution_amount, payload, description))
               .endCell();
    }

    async sendCreateVotingThroughWallet(provider: ContractProvider, via:Sender, expiration_date: bigint, minimal_execution:bigint, proposal:Cell, value:bigint = toNano('0.1'), query_id: bigint = 0n,  description: string = "Sample description") {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            value,
            body: JettonWallet.createVotingMessageThroughWallet(expiration_date, minimal_execution, proposal, query_id, description)
        });
    }

    async getVotedWeight(provider: ContractProvider, voting_id:bigint, expiration_date:bigint) {
        let state = await provider.getState();
        if (state.state.type !== 'active') {
            return 0n;
        }
        let res = await provider.get('get_voted_weight', [{ type: 'int', value: voting_id}, { type: 'int', value: expiration_date}]);
        return res.stack.readBigNumber();
    }
    async getVoteKeeperAddress(provider: ContractProvider, voting_address:Address): Promise<Address> {
        const res = await provider.get('get_vote_keeper_address', [{ type: 'slice', cell: beginCell().storeAddress(voting_address).endCell() }])
        return res.stack.readAddress()
    }

    private unpackJettonData(stack:TupleReader): JettonData {
        return {
            balance: stack.readBigNumber(),
            ownerAddress: stack.readAddress(),
            masterAdderss: stack.readAddress(),
            walletCode: stack.readCell(),
        };
    } 

    async getJettonData(provider: ContractProvider): Promise<JettonData> {
        const res = await provider.get('get_wallet_data', []);
        return this.unpackJettonData(res.stack);
    }

    async getDaoData(provider: ContractProvider): Promise<DaoData> {
        const res = await provider.get('get_dao_wallet_data', []);
        return {
            ...this.unpackJettonData(res.stack),
            locked: res.stack.readBigNumber(),
            lockExpiration: res.stack.readNumber()
        };
    }

    async getLockedBalance(provider: ContractProvider): Promise<bigint> {
        return (await this.getDaoData(provider)).locked;
    }

    async getTotalBalance(provider: ContractProvider): Promise<bigint> {
        const res = await this.getDaoData(provider);

        return res.locked + res.balance;
    }
}
