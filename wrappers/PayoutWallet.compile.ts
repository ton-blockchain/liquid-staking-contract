import { CompilerConfig, compile as compileFunc } from '@ton/blueprint';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const compile: CompilerConfig = {
    targets: ['contracts/awaited_minter/contracts/jetton-wallet.func'],
    postCompileHook: async (code) => {
        const auto = path.join(__dirname, '..', 'contracts', 'auto');
        await mkdir(auto, { recursive: true });
        await writeFile(path.join(auto, 'payout-jetton-wallet-code.func'), `cell jetton_wallet_code() asm "B{${code.toBoc().toString('hex')}} B>boc PUSHREF";`);
    }
};
