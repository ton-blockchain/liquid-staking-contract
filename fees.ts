/*
 * https://github.com/ton-community/ton/blob/v12.3.3/src/block/fees.ts
 * Actualized to the current ton-core types
 * Currently only message related function
*/

import { Cell, Slice, Message, loadMessageRelaxed, Dictionary  } from 'ton-core';

export type MsgPrices = ReturnType<typeof configParseMsgPrices>

//
// Source: https://github.com/ton-foundation/ton/blob/ae5c0720143e231c32c3d2034cfe4e533a16d969/crypto/block/transaction.cpp#L425
//

/*
export function computeStorageFees(data: {
    now: number
    lastPaid: number
    storagePrices: StoragePrices[]
    storageStat: { cells: number, bits: number, publicCells: number }
    special: boolean
    masterchain: boolean
}) {
    const {
        lastPaid,
        now,
        storagePrices,
        storageStat,
        special,
        masterchain
    } = data;
    if (now <= lastPaid || storagePrices.length === 0 || now < storagePrices[0].utime_since.toNumber() || special) {
        return new BN(0);
    }
    let upto = Math.max(lastPaid, storagePrices[0].utime_since.toNumber());
    let total = new BN(0);
    for (let i = 0; i < storagePrices.length && upto < now; i++) {
        let valid_until = (i < storagePrices.length - 1 ? Math.min(now, storagePrices[i + 1].utime_since.toNumber()) : now);
        let payment = new BN(0);
        if (upto < valid_until) {
            let delta = valid_until - upto;
            payment = payment.add(new BN(storageStat.cells).mul(masterchain ? storagePrices[i].mc_cell_price_ps : storagePrices[i].cell_price_ps));
            payment = payment.add(new BN(storageStat.bits).mul(masterchain ? storagePrices[i].mc_bit_price_ps : storagePrices[i].bit_price_ps));
            payment = payment.mul(new BN(delta));
        }
        upto = valid_until;
        total = total.add(payment);
    }

    return shr16ceil(total);
}
*/

//
// Source: https://github.com/ton-foundation/ton/blob/ae5c0720143e231c32c3d2034cfe4e533a16d969/crypto/block/transaction.cpp#L1218
//


export const configParseMsgPrices = (sc: Slice) => {

    let magic = sc.loadUint(8);

    if(magic != 0xea) {
        throw Error("Invalid message prices magic number!");
    }
    return {
        lumpPrice:sc.loadUintBig(64),
        bitPrice: sc.loadUintBig(64),
        cellPrice: sc.loadUintBig(64),
        ihrPriceFactor: sc.loadUintBig(32),
        firstFrac: sc.loadUintBig(16),
        nextFrac:  sc.loadUintBig(16)
    };
}

export const getMsgPrices = (configRaw: Cell, workchain: 0 | -1 ) => {

    const config = configRaw.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());

    const prices = config.get(25 + workchain);

    if(prices === undefined) {
        throw Error("No prices defined in config");
    }

    return configParseMsgPrices(prices.beginParse());
}

export function computeFwdFees(msgPrices: MsgPrices, cells: bigint, bits: bigint) {
    return msgPrices.lumpPrice + (shr16ceil((msgPrices.bitPrice * bits)
         + (msgPrices.cellPrice * cells))
    );
}

//
// Source: https://github.com/ton-foundation/ton/blob/ae5c0720143e231c32c3d2034cfe4e533a16d969/crypto/block/transaction.cpp#L761
//

/*
export function computeGasPrices(gasUsed: BN, prices: { flatLimit: BN, flatPrice: BN, price: BN }) {
    if (gasUsed.lte(prices.flatLimit)) {
        return prices.flatPrice;
    } else {
        //  td::rshift(gas_price256 * (gas_used - cfg.flat_gas_limit), 16, 1) + cfg.flat_gas_price
        return prices.flatPrice.add(prices.price.mul(gasUsed.sub(prices.flatLimit)).shrn(16));
    }
}
*/

//
// Source: https://github.com/ton-foundation/ton/blob/ae5c0720143e231c32c3d2034cfe4e533a16d969/crypto/block/transaction.cpp#L530
//

export function computeExternalMessageFees(msgPrices: MsgPrices, cell: Cell) {

    // Collect stats
    let storageStats = collectCellStats(cell, true);

    return computeFwdFees(msgPrices, BigInt(storageStats.cells), BigInt(storageStats.bits));
}

export function computeMessageForwardFees(msgPrices: MsgPrices, msg: Message) {
    // let msg = loadMessageRelaxed(cell.beginParse());
    let storageStats: { bits: number, cells: number } = { bits: 0, cells: 0 };

    // Init
    if (msg.init) {
        const code = collectCellStats(msg.init.code as Cell);
        const data = collectCellStats(msg.init.data as Cell);
        storageStats.bits  += code.bits + data.bits;
        storageStats.cells += 2 + code.cells + data.cells;
    }

    // Body
    let bc    = collectCellStats(msg.body, true);
    storageStats.bits += bc.bits;
    storageStats.cells += bc.cells;

    // NOTE: Extra currencies are ignored for now

    let fees = computeFwdFees(msgPrices, BigInt(storageStats.cells), BigInt(storageStats.bits));
    let res  = (fees * msgPrices.firstFrac) >> BigInt(16);
    let remaining = fees - res;
    return { fees: res, remaining };
}

export function collectCellStats(cell: Cell, skipRoot: boolean = false): { bits: number, cells: number } {
    let bits  = skipRoot ? 0 : cell.bits.length;
    let cells = skipRoot ? 0 : 1;
    for (let ref of cell.refs) {
        let r = collectCellStats(ref);
        cells += r.cells;
        bits += r.bits;
    }
    return { bits, cells };
}

function shr16ceil(src: bigint) {
    let rem = src % BigInt(65536);
    let res = src >> BigInt(16);
    if (rem != BigInt(0)) {
        res += BigInt(1);
    }
    return res;
}
