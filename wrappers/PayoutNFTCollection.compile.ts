import { CompilerConfig } from '@ton/blueprint';
import { compile as compileFunc } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'func',
    preCompileHook: async () => {
        await compileFunc('PayoutNFTItem');
    },
    targets: [ 'contracts/versioning.func',
               'contracts/auto/payout-nft-item-code.func',
               'contracts/payout_nft/nft-collection.func'],
};
