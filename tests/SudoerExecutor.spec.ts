import { Blockchain, SandboxContract, TreasuryContract, RemoteBlockchainStorage, wrapTonClient4ForRemote } from '@ton/sandbox';
import { Address, Cell, toNano, Dictionary, beginCell } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { Executor } from '../wrappers/SudoerExecutor';
import { compile } from '@ton/blueprint';
import { Conf, Op } from "../PoolConstants";
import '@ton/test-utils';
import { TonClient4 } from "@ton/ton";

import { JettonMinter as DAOJettonMinter, jettonContentToCell } from '../contracts/jetton_dao/wrappers/JettonMinter';
import { JettonWallet as PoolJettonWallet } from '../wrappers/JettonWallet';

const loadConfig = (config:Cell) => {
          return config.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());
        };

const LAST_BLOCK = 35737001;
const LAST_TESTNET_BLOCK = 16432928;
const INITIAL_TIME = 1706449794;

describe('Executor', () => {


    let pool_code: Cell;
    let executor_code: Cell;

    let blockchain: Blockchain;
    let executor: SandboxContract<Executor>;


    let deployer: SandboxContract<TreasuryContract>;
    let governance: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<TreasuryContract>; // TODO make real pool contract

    beforeAll(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        governance = await blockchain.treasury('governance');
        pool = await blockchain.treasury('pool');

        pool_code = await compile('Pool');
        executor_code = await compile('SudoerExecutor');
    });

    beforeEach(async () => {
    });

    it('should deploy', async () => {
        let executorConfig = {
            mode: 0,
            governance: governance.address,
            pool: pool.address,
            action: beginCell()
                     .storeUint(Op.sudo.upgrade, 32)
                     .storeUint(1, 64) // query id
                     .storeMaybeRef(null)
                     .storeMaybeRef(null)
                     .storeMaybeRef(null)
                  .endCell(),
        };
        executor = blockchain.openContract(Executor.createFromConfig(executorConfig, executor_code));
        const executorDeployResult = await executor.sendDeploy(deployer.getSender(), toNano('11'));
        expect(executorDeployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: executor.address,
            deploy: true,
            //success: true,
        });
    });



});

describe('should work on testnet pool', () => {

    interface ActiveAccount { type: "active"; codeHash: string; dataHash: string; };

    let api: TonClient4;
    let emulator: Blockchain;

    let pool_code: Cell;
    let executor_code: Cell;


    let pool: SandboxContract<Pool>;
    let executor: SandboxContract<Executor>;
    let deployer: SandboxContract<TreasuryContract>;
    let poolJetton: SandboxContract<DAOJettonMinter>;

    const poolAddress = Address.parse("EQCu_j-5niSEIN_R3qJMWvcjKSdpBJOFz1sJE9JXt549GL42");

    let getContractCode = async (address: Address) => {
                  const smc = await emulator.getContract(address);
                  if(!smc.account.account)
                    throw("Account not found")
                  if(smc.account.account.storage.state.type != "active" )
                    throw("Atempting to get code on inactive account");
                  if(!smc.account.account.storage.state.state.code)
                    throw("Code is not present");
                  return smc.account.account.storage.state.state.code;
                }

    beforeAll(async () => {

        pool_code = await compile('Pool');
        executor_code = await compile('SudoerExecutor');

        let networkEndpoint = 'https://testnet-v4.tonhubapi.com';
        api = new TonClient4({ endpoint: networkEndpoint, timeout: 15000});
        emulator = await Blockchain.create({
                    storage: new RemoteBlockchainStorage(wrapTonClient4ForRemote(api))
                });
        emulator.now = INITIAL_TIME;


        const dao_wallet_code_raw = await compile('DAOJettonWallet');
        const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
        _libs.set(BigInt(`0x${dao_wallet_code_raw.hash().toString('hex')}`), dao_wallet_code_raw);
        const libs = beginCell().storeDictDirect(_libs).endCell();
        emulator.libs = libs;

        //for some reason emulator.sender doesn't allow to deploy contracts
        deployer = await emulator.treasury('deployer');

        pool = emulator.openContract(Pool.createFromAddress(poolAddress));
        let initialData = await pool.getFullData();
        poolJetton = emulator.openContract(DAOJettonMinter.createFromAddress(initialData.poolJettonMinter));
        expect((await getContractCode(pool.address)).hash().toString('base64')
               ==
               pool_code.hash().toString('base64')
               ).not.toBeTruthy();

    });
    it("should upgrade", async () => {

        let initialData = await pool.getFullData();

        let executorConfig = {
            mode: 0,
            governance: initialData.governor,
            pool: pool.address,
            action: beginCell()
                     .storeUint(Op.sudo.upgrade, 32)
                     .storeUint(1, 64) // query id
                     .storeMaybeRef(null)
                     .storeMaybeRef(pool_code)
                     .storeMaybeRef(null)
                  .endCell(),
        };
        executor = emulator.openContract(Executor.createFromConfig(executorConfig, executor_code));
        const executorDeployResult = await executor.sendDeploy(deployer.getSender(), toNano('1'));
        expect(executorDeployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: executor.address,
            deploy: true,
        });

        let newSudoerResult = await pool.sendSetSudoer(emulator.sender(initialData.governor), executor.address);
        expect(newSudoerResult.transactions).toHaveTransaction({
            from: initialData.governor,
            to: pool.address,
            success: true,
        });

        emulator.now = INITIAL_TIME + 86400 * 2;

        const executeResult = await executor.sendExecute(emulator.sender(initialData.governor));
        expect(executeResult.transactions).toHaveTransaction({
            from: initialData.governor,
            to: executor.address,
            success: true,
        });
        expect(executeResult.transactions).toHaveTransaction({
            from: executor.address,
            to: pool.address,
            success: true,
        });
        expect((await getContractCode(pool.address)).hash().toString('base64')
               ==
               pool_code.hash().toString('base64')
               ).toBeTruthy();
    });

    it("should deposit after upgrade", async () => {
            let myPoolJettonWalletAddress = await poolJetton.getWalletAddress(deployer.address);
            let myPoolJettonWallet = emulator.openContract(PoolJettonWallet.createFromAddress(myPoolJettonWalletAddress));

            //await emulator.setVerbosityForAddress(myPoolJettonWalletAddress, {blockchainLogs:true, vmLogs: 'vm_logs'});

            const depositResult = await pool.sendDeposit(deployer.getSender(), toNano('10'));

            expect(depositResult.transactions).toHaveTransaction({
                from: myPoolJettonWallet.address,
                on: deployer.address,
                op: Op.jetton.transfer_notification,
                success: true,
            });
            const jettonAmount = await myPoolJettonWallet.getJettonBalance();
    });

    it('should withdraw after upgrade', async () => {
        let myPoolJettonWalletAddress = await poolJetton.getWalletAddress(deployer.address);
        let myPoolJettonWallet = emulator.openContract(PoolJettonWallet.createFromAddress(myPoolJettonWalletAddress));
        const jettonAmount = await myPoolJettonWallet.getJettonBalance();

        const burnResult = await myPoolJettonWallet.sendBurnWithParams(deployer.getSender(), toNano('1.0'), jettonAmount, deployer.address, false, false);

        expect(burnResult.transactions).toHaveTransaction({
            from: pool.address,
            on: deployer.address,
            op: Op.pool.withdrawal,
            success: true,
        });

    });
});