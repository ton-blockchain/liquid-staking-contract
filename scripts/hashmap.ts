import { beginCell, Dictionary, Address } from 'ton-core';
import { NetworkProvider } from '@ton-community/blueprint';
import { randomAddress } from "@ton-community/test-utils";

const MAX_DEPTH = 12;

function findCommon(s1: string, s2: string): number {
    let i = 0;
    while (i < s1.length && s1[i] === s2[i])
        i++;
    return i;
}

export async function run(provider: NetworkProvider) {
    const dict = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Bool());

    const testValues = splitAddresses(MAX_DEPTH);
    for (let i = 0; i < testValues.length; i++) {
      const addr = testValues[i];
      const key = BigInt('0x' + addr.hash.toString('hex'));
      dict.set(key, true);
    }
    const c = beginCell().storeDictDirect(dict).endCell();
    console.log("Dict depth:", c.depth());
    console.log("Expected depth:", MAX_DEPTH);
    if (c.depth() !== MAX_DEPTH) console.log("❌ Depth mismatch");
    else console.log("✅ Depth match");
}
