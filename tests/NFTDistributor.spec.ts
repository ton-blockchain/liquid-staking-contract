import { Blockchain, SandboxContract, TreasuryContract, BlockchainSnapshot } from '@ton-community/sandbox';
import { Address, Cell, toNano, Dictionary, beginCell } from 'ton-core';
import { PayoutCollection, Errors } from '../wrappers/PayoutNFTCollection';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { randomAddress } from '@ton-community/test-utils';
import { getRandomInt, getRandomTon } from '../utils'

describe('Distributor NFT Collection', () => {
    let collectionCode: Cell;
    let snapshots: Map<string, BlockchainSnapshot>
    let loadSnapshot: (snap: string) => Promise<void>;
    let collection: SandboxContract<PayoutCollection>
    let deployer: SandboxContract<TreasuryContract>;
    let notDeployer: SandboxContract<TreasuryContract>;
    let blockchain: Blockchain;
    let totalBill: bigint;
    let shares: Map<Address, bigint>;

    beforeAll(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury("deployer");
        notDeployer = await blockchain.treasury("notDeployer");
        collectionCode = await compile('PayoutNFTCollection');
        let config = {
            admin: deployer.address,
            content: Cell.EMPTY
        }
        collection = blockchain.openContract(PayoutCollection.createFromConfig(config, collectionCode));
        loadSnapshot = async (name: string) => {
          const shot = snapshots.get(name);
          if(!shot)
            throw(Error(`Can't find snapshot ${name}\nCheck tests execution order`));
          await blockchain.loadFrom(shot);
        }
    });

    describe("Distributing TONs", () => {
        const initDistribution = {
            active: false,
            isJetton: false,
            volume: 0n,
        }

        beforeAll(async () => {
            snapshots = new Map<string, BlockchainSnapshot>();
            shares = new Map<Address, bigint>();
            totalBill = 0n;
            for (let addr of [deployer.address, notDeployer.address, randomAddress()]) {
                const share = getRandomTon(1, 100);
                totalBill += share;
                shares.set(addr, share);
            }
        });


        it('should not deploy (init) not from admin', async () => {
            const deployResult = await collection.sendDeploy(notDeployer.getSender(), initDistribution, toNano("0.5"));
            expect(deployResult.transactions).toHaveTransaction({
                to: collection.address,
                success: false,
                exitCode: Errors.unauthorized_init
            });
            snapshots.set("uninitialized", blockchain.snapshot());
        });

        it("should deploy collection with ton distribution", async () => {
            await loadSnapshot("uninitialized");
            const deployResult = await collection.sendDeploy(deployer.getSender(), initDistribution, toNano("1"));
            expect(deployResult.transactions).toHaveTransaction({
                to: collection.address,
                success: true,
                endStatus: 'active'
            });
            snapshots.set("initialized", blockchain.snapshot());
        });
        it("should mint NFT", async () => {
            await loadSnapshot("initialized");
            for (let [addr, share] of shares) {
                const mintResult = await collection.sendMint(deployer.getSender(), addr, share);
                expect(mintResult.transactions).toHaveTransaction({
                    to: collection.address,
                    success: true,
                    outMessagesCount: 1
                });
            }
            snapshots.set("minted", blockchain.snapshot());
        });
        it("should not mint not from admin", async () => {
            await loadSnapshot("initialized");
            const mintResult = await collection.sendMint(notDeployer.getSender(), randomAddress(), getRandomTon(1, 100));
            expect(mintResult.transactions).toHaveTransaction({
                to: collection.address,
                success: false,
                exitCode: Errors.unauthorized_mint_request
            });
        });
    });
});
