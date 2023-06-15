import { CompilerConfig } from '@ton-community/blueprint';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import fs from 'fs';
import { compile as compileFunc } from '@ton-community/blueprint';
import { Address } from 'ton-core';


export const compile: CompilerConfig = {
    preCompileHook: async () => {
        await compileFunc('PayoutWallet');
        const consigliere_address = path.join(__dirname, '..', 'contracts', 'auto', 'consigliere_address.func');
        if (!fs.existsSync(consigliere_address)) {
          throw new Error('Consigliere address not defined in contracts/auto/consigliere_address.func, use setConsigliere');
        }
    },
    targets: ['contracts/auto/consigliere_address.func',
              'contracts/auto/payout-jetton-wallet-code.func',
              'contracts/awaited_minter/contracts/jetton-minter.func'],
};

export async function setConsigliere(consigliere_address: Address) {
    const auto = path.join(__dirname, '..', 'contracts', 'auto'); //'consigliere_address.func'
    await mkdir(auto, { recursive: true });
    await writeFile(path.join(auto, 'consigliere_address.func'), `const slice consigliere_address = "${consigliere_address.toString()}"a;`);

}