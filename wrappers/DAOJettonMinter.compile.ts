import { CompilerConfig, compile as compileFunc } from '@ton-community/blueprint';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const compile: CompilerConfig = {
    lang: 'func',
    preCompileHook: async () => {
        await compileFunc('DAOJettonWallet');
    },
    targets: ['contracts/auto/dao-jetton-wallet-code.func',
              'contracts/jetton_dao/contracts/jetton-minter.func'],
};
