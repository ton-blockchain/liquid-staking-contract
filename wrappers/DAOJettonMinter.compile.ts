import { CompilerConfig, compile as compileFunc } from '@ton/blueprint';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const compile: CompilerConfig = {
    lang: 'func',
    preCompileHook: async () => {
        await compileFunc('DAOJettonWallet');
        await compileFunc('VotingResults');
    },
    targets: ['contracts/auto/voting-results-code.func',
              'contracts/auto/dao-jetton-wallet-code.func',
              'contracts/jetton_dao/contracts/dao-decisions-filter.func',
              'contracts/dao_params.func',
              'contracts/jetton_dao/contracts/jetton-minter.func'],
};
