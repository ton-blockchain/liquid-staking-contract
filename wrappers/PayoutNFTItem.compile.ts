import { CompilerConfig } from '@ton-community/blueprint';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const compile: CompilerConfig = {
    lang: 'func',
    preCompileHook: async () => {
        const path_to_head = (await readFile(path.join(__dirname, '..', '.git', 'HEAD'), "utf-8")).split(": ")[1].trim();
        const head = await readFile(path.join(__dirname, '..', '.git', path_to_head), "utf-8");

        const auto = path.join(__dirname, '..', 'contracts', 'auto');
        await mkdir(auto, { recursive: true });
        await writeFile(path.join(auto, 'git-hash.func'), `const int git_hash = 0x${head.trim()};`);
    },
    targets: ['contracts/versioning.func',
              'contracts/payout_nft/nft-item.func'],
    postCompileHook: async (code) => {
        const auto = path.join(__dirname, '..', 'contracts', 'auto');
        await mkdir(auto, { recursive: true });
        await writeFile(path.join(auto, 'payout-nft-item-code.func'), `cell nft_item_code() asm "B{${code.toBoc().toString('hex')}} B>boc PUSHREF";`);
    }
};
