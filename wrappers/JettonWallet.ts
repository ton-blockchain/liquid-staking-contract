import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano, TupleReader } from 'ton-core';
import { JettonWalletConfig, JettonData, DaoData, jettonWalletConfigToCell, JettonWallet as BasicJettonWallet } from '../contracts/jetton_dao/wrappers/JettonWallet';


export class JettonWallet extends BasicJettonWallet {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {
        super(address, init);
    }
    static createFromAddress(address: Address) {
        return new JettonWallet(address);
    }
    async sendBurnWithParams(provider: ContractProvider, via: Sender, value: bigint,
                          jetton_amount: bigint,
                          responseAddress:Address,
                          waitTillRoundEnd:boolean, // opposite of request_immediate_withdrawal
                          fillOrKill:boolean) {
        let customPayload = beginCell()
           .storeUint(Number(waitTillRoundEnd), 1)
           .storeUint(Number(fillOrKill), 1).endCell();
        return this.sendBurn(provider, via, value, jetton_amount, responseAddress,
                             customPayload);

    }
}
