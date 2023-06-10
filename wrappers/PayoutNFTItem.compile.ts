import { CompilerConfig } from '@ton-community/blueprint';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const compile: CompilerConfig = {
    lang: 'func',
    targets: ['contracts/payout_nft/nft-item.func'],
    postCompileHook: async (code) => {
        const auto = path.join(__dirname, '..', 'contracts', 'auto');
        await mkdir(auto, { recursive: true });
        await writeFile(path.join(auto, 'payout-nft-item-code.func'), `cell nft_item_code() asm "B{${code.toBoc().toString('hex')}} B>boc PUSHREF";`);
    }
};
