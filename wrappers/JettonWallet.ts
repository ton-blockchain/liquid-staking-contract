import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano, TupleReader } from 'ton-core';
import { JettonWalletConfig, JettonData, DaoData, jettonWalletConfigToCell, JettonWallet as BasicJettonWallet } from '../contracts/jetton_dao/wrappers/JettonWallet';


export class JettonWallet extends BasicJettonWallet {
    async sendBurnWithParams(provider: ContractProvider, via: Sender, value: bigint,
                          jetton_amount: bigint,
                          responseAddress:Address,
                          requestImmediateWithdrawal:boolean,
                          fillOrKill:boolean) {
        let customPayload = beginCell()
           .storeUint(Number(requestImmediateWithdrawal), 1)
           .storeUint(Number(fillOrKill), 1).endCell();
        return this.sendBurn(provider, via, value, jetton_amount, responseAddress,
                             customPayload);

    }
}
