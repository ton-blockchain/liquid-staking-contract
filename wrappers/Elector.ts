import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, toNano, Sender, SendMode, Tuple, TupleReader } from "ton-core";
import { LispList, bigint2buff, buff2bigint } from "../utils";
import { signData, loadConfig } from "./ValidatorUtils";

export class Participant {
    constructor(readonly id: bigint,
                readonly stake: bigint,
                readonly max_factor: number,
                readonly address: Address,
                readonly adnl: bigint
               ) { }
    static fromReader(rdr: TupleReader) {
        const id = rdr.readBigNumber();
        const data = rdr.readTuple();
        return new Participant(id,
                               data.readBigNumber(),
                               data.readNumber(),
                               new Address(-1, bigint2buff(data.readBigNumber())),
                               data.readBigNumber()
                              );
    }
}
export class Elector implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell, special:{tick:boolean, tock:boolean} }) {}

    static createFromAddress(address: Address) {
        return new Elector(address);
    }

    static createFromConfig(address: Address, code: Cell, config: Cell) {
       const confDict = loadConfig(config);
       const data = beginCell()
                     .storeMaybeRef(null) 
                     .storeMaybeRef(null)
                     .storeMaybeRef(null)
                     .storeCoins(0)
                     .storeUint(buff2bigint(confDict.get(34)!.hash()), 256)
                    .endCell();
        const init = {code, data, special:{tick: true, tock:true}};

        return new Elector(address, init);
    }

    static newStakeMessage(src: Address,
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
                           .storeUint(buff2bigint(public_key), 256)
                           .storeUint(stake_at, 32)
                           .storeUint(max_factor, 32)
                           .storeUint(adnl_address, 256)
                           .storeRef(signature)
                .endCell();
    }


    async sendNewStake(provider: ContractProvider,
                       via: Sender,
                       value: bigint,
                       src: Address,
                       public_key: Buffer,
                       private_key: Buffer,
                       stake_at: number | bigint,
                       max_factor: number = 1 << 16,
                       adnl_address: bigint = 0n,
                       query_id:bigint | number = 1) {
        await provider.internal(via,{
            value, 
            body: Elector.newStakeMessage(src,
                                          public_key,
                                          private_key,
                                          stake_at,
                                          max_factor,
                                          adnl_address,
                                          query_id),
            sendMode: SendMode.PAY_GAS_SEPARATELY
        });
    }

    async getActiveElectionId(provider: ContractProvider) {
        const { stack } = await provider.get('active_election_id', [])
        return stack.readNumber()
    }

    async getStake(provider: ContractProvider, validator_key: Buffer) {
        const { stack } = await provider.get('participates_in', [
            { type: 'int', value: BigInt('0x'+ validator_key.toString('hex')) }
        ])
        return stack.readBigNumber();
    }

    async getReturnedStake(provider: ContractProvider, wallet:Address) {
        const { stack} = await provider.get('compute_returned_stake', [{
            type: 'int', value: buff2bigint(wallet.hash)
        }]);
        return stack.readBigNumber();
    }

    async getParticipantListExtended(provider: ContractProvider) {
        const { stack } = await provider.get('participant_list_extended', []);
        return {
            elect_at: stack.readNumber(),
            elect_close: stack.readNumber(),
            min_stake: stack.readBigNumber(),
            total_stake: stack.readBigNumber(),
            list: new LispList(stack.readTupleOpt(), Participant).toArray(),
            failed: stack.readBoolean(),
            finished: stack.readBoolean()
        };
    }
}
