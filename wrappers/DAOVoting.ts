import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from 'ton-core';


export type VotingConfig = {master: Address, voting_id:bigint};
export class Voting implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static votingConfigToCell(conf:VotingConfig) {
        return beginCell().storeBit(false).storeAddress(conf.master).storeUint(conf.voting_id, 64).endCell();
    }
    static createFromAddress(address: Address) {
        return new Voting(address);
    }

/*
    return (init, executed,
            dao_address, initiator,
            voting_id, expiration_date, voting_type,
            ;; proposal
            minimal_execution_amount, message, description,
            voted_for, voted_against);
*/
    async getData(provider: ContractProvider) {
        let res = await provider.get('get_voting_data', []);
        let init = res.stack.readBoolean();
        let executed = res.stack.readBoolean();
        let daoAddress = res.stack.readAddress();
        let initiator = res.stack.readAddress();
        let votingId = res.stack.readBigNumber();
        let expirationDate = res.stack.readBigNumber();
        let votingType = res.stack.readBigNumber();
        let minAmount = res.stack.readBigNumber();
        let message = res.stack.readCellOpt();
        let description = res.stack.readString();
        let votedFor = res.stack.readBigNumber();
        let votedAgainst = res.stack.readBigNumber();
        return {
            init, executed,
            daoAddress, initiator,
            votingId, expirationDate, votingType,
            minAmount, message, description,
            votedFor, votedAgainst,
        };
    }

    static createFromConfig(conf:VotingConfig, code:Cell, workchain = 0) {
        const data = Voting.votingConfigToCell(conf);
        const init = {code, data};
        return new Voting(contractAddress(workchain, init), init);
    }

    static endVotingMessage(query_id:bigint = 0n) {
        return beginCell().storeUint(0x66173a45, 32).storeUint(query_id, 64).endCell();
    }

    async sendEndVoting(provider: ContractProvider, via: Sender, value:bigint=toNano('0.5')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Voting.endVotingMessage(),
            value
        });
    }
/*
(init, dao_address, voting_id, expiration_date, voting_type,
            proposal, wallet_code,
            voted_for, voted_against,
            executed, initiator);
*/
    async getFullData(provider: ContractProvider) {
        let res = await provider.get('get_full_voting_data', []);
        let init = res.stack.readBoolean();
        let daoAddress = res.stack.readAddress();
        let votingId = res.stack.readBigNumber();
        let expirationDate = res.stack.readBigNumber();
        let votingType = res.stack.readBigNumber();
        let proposal = res.stack.readCell();
        let walletCode = res.stack.readCell();
        let votedFor = res.stack.readBigNumber();
        let votedAgainst = res.stack.readBigNumber();
        let executed = res.stack.readBoolean();
        let initiator = res.stack.readAddress();
        return {
            init,
            daoAddress,
            votingId,
            expirationDate,
            votingType,
            proposal,
            walletCode,
            votedFor,
            votedAgainst,
            executed,
            initiator,
        };
    }

    static createProposalBody(minimal_execution_amount:bigint, forwardMsg:Cell, description: string = "Sample description") {

        return beginCell().storeCoins(minimal_execution_amount).storeMaybeRef(forwardMsg).storeStringTail(description).endCell();
    }

}
