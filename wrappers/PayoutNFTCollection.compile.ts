import { CompilerConfig } from '@ton-community/blueprint';
import { compile as compileFunc } from '@ton-community/blueprint';

export const compile: CompilerConfig = {
    lang: 'func',
    preCompileHook: async () => {
        await compileFunc('PayoutNFTItem');
    },
    targets: [ 'contracts/auto/payout-nft-item-code.func',
               'contracts/payout_nft/nft-collection.func'],
};
