import { CompilerConfig, compile as compileFunc } from '@ton/blueprint';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const compile: CompilerConfig = {
    targets: ['contracts/jetton_dao/contracts/vote-keeper.func'],
    postCompileHook: async (code) => {
        const auto = path.join(__dirname, '..', 'contracts', 'auto');
        await mkdir(auto, { recursive: true });
        await writeFile(path.join(auto, 'dao-vote-keeper-code.func'), `cell vote_keeper_code() asm "B{${code.toBoc().toString('hex')}} B>boc PUSHREF";`);
    }
};
