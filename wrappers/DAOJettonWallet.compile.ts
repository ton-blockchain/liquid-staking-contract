import { CompilerConfig, compile as compileFunc } from '@ton-community/blueprint';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const compile: CompilerConfig = {
    lang: 'func',
    preCompileHook: async () => {
        await compileFunc('DAOVoteKeeper');
    },
    targets: ['contracts/auto/dao-vote-keeper-code.func',
              'contracts/jetton_dao/contracts/jetton-wallet.func'],

    postCompileHook: async (code) => {
        const auto = path.join(__dirname, '..', 'contracts', 'auto');
        await mkdir(auto, { recursive: true });
        await writeFile(path.join(auto, 'dao-jetton-wallet-code.func'), `cell jetton_wallet_code() asm "B{${code.toBoc().toString('hex')}} B>boc PUSHREF";`);
    }
};
