import { Address, Tuple, TupleItem, TupleItemInt, TupleReader, toNano } from "ton";
import { Cell, Slice, Sender, SenderArguments, ContractProvider, Message, beginCell, Dictionary, MessageRelaxed, Transaction } from "ton-core";
import { Blockchain, MessageParams, SendMessageResult, SmartContract, SmartContractTransaction } from "@ton-community/sandbox";
import { computeMessageForwardFees, MsgPrices } from "./fees";


const randomAddress = (wc: number = 0) => {
    const buf = Buffer.alloc(32);
    for (let i = 0; i < buf.length; i++) {
        buf[i] = Math.floor(Math.random() * 256);
    }
    return new Address(wc, buf);
};

const differentAddress = (oldAddr:Address) => {

    let newAddr = oldAddr;

    do {
        newAddr = randomAddress(newAddr.workChain);
    } while(newAddr.equals(oldAddr));

    return newAddr;
}

export const getRandom = (min:number, max:number) => {
    return Math.random() * (max - min) + min;
}

enum roundMode {floor, ceil, round};

export const getRandomInt = (min:number, max:number, mode: roundMode = roundMode.floor) => {
    let res = getRandom(min, max);

    if(mode == roundMode.floor) {
        res = Math.floor(res);
    }
    else if(mode == roundMode.ceil) {
        res = Math.ceil(res);
    }
    else {
        res = Math.round(res);
    }

    return res;
}

export const getRandomTon = (min:number, max:number): bigint => {
    return toNano(getRandom(min, max).toFixed(9));
}

export const buff2bigint = (buff: Buffer) : bigint => {
    return BigInt("0x" + buff.toString("hex"));
}

export const bigint2buff = (num:bigint) : Buffer => {
    return Buffer.from(num.toString(16), 'hex')
}

export const computedGeneric = (trans:Transaction) => {
    if(trans.description.type !== "generic")
        throw("Expected generic transaction");
    if(trans.description.computePhase.type !== "vm")
        throw("Compute phase expected")
    return trans.description.computePhase;
};

export const getMsgExcess = (trans:Transaction, msg:Message, value:bigint, msgConf:MsgPrices) => {
  const fwdFees = computeMessageForwardFees(msgConf, msg);
  return value - computedGeneric(trans).gasFees - fwdFees.remaining - fwdFees.fees;
}

export const sendBulkMessage = async (msg: Message,
                                      smc:SmartContract,
                                      count:number,
                                      cb: (res:SmartContractTransaction,n:number) => Promise<void>,
                                      params?: MessageParams )=> {
    for ( let i = 0; i < count; i++ ) {
        await cb(await smc.receiveMessage(msg, params), i);
    }
}


export {
    differentAddress,
};
