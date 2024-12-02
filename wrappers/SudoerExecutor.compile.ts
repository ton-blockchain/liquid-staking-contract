import { CompilerConfig } from '@ton/blueprint';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const compile: CompilerConfig = {
    lang: 'func',
    targets: ['contracts/utils/sudoer_safe_executor.func']
};
