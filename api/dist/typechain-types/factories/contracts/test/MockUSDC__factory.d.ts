import { ContractFactory, ContractTransactionResponse } from "ethers";
import type { Signer, ContractDeployTransaction, ContractRunner } from "ethers";
import type { NonPayableOverrides } from "../../../common";
import type { MockUSDC, MockUSDCInterface } from "../../../contracts/test/MockUSDC";
type MockUSDCConstructorParams = [signer?: Signer] | ConstructorParameters<typeof ContractFactory>;
export declare class MockUSDC__factory extends ContractFactory {
    constructor(...args: MockUSDCConstructorParams);
    getDeployTransaction(overrides?: NonPayableOverrides & {
        from?: string;
    }): Promise<ContractDeployTransaction>;
    deploy(overrides?: NonPayableOverrides & {
        from?: string;
    }): Promise<MockUSDC & {
        deploymentTransaction(): ContractTransactionResponse;
    }>;
    connect(runner: ContractRunner | null): MockUSDC__factory;
    static readonly bytecode = "0x60803462000321576040906001600160401b0390808301828111828210176200030d578352600d81526020916c26b7b1b5902aa9a21021b7b4b760991b83830152835192848401848110838211176200030d578552600493848152635553444360e01b82820152835190838211620002fa576003928354926001968785811c95168015620002ef575b83861014620002dc578190601f9586811162000289575b50839086831160011462000226575f926200021a575b50505f1982871b1c191690871b1784555b8151948511620002075786548681811c91168015620001fc575b82821014620001e957838111620001a1575b50809285116001146200013757509383949184925f956200012b575b50501b925f19911b1c19161790555b516107329081620003268239f35b015193505f806200010e565b92919084601f198116885f52855f20955f905b898383106200018657505050106200016c575b50505050811b0190556200011d565b01519060f8845f19921b161c191690555f8080806200015d565b8587015189559097019694850194889350908101906200014a565b875f52815f208480880160051c820192848910620001df575b0160051c019087905b828110620001d3575050620000f2565b5f8155018790620001c3565b92508192620001ba565b602288634e487b7160e01b5f525260245ffd5b90607f1690620000e0565b604187634e487b7160e01b5f525260245ffd5b015190505f80620000b5565b90899350601f19831691885f52855f20925f5b878282106200027257505084116200025a575b505050811b018455620000c6565b01515f1983891b60f8161c191690555f80806200024c565b8385015186558d9790950194938401930162000239565b909150865f52835f208680850160051c820192868610620002d2575b918b91869594930160051c01915b828110620002c35750506200009f565b5f81558594508b9101620002b3565b92508192620002a5565b602289634e487b7160e01b5f525260245ffd5b94607f169462000088565b604186634e487b7160e01b5f525260245ffd5b634e487b7160e01b5f52604160045260245ffd5b5f80fdfe6080604090808252600480361015610015575f80fd5b5f3560e01c91826306fdde03146104d757508163095ea7b31461042f57816318160ddd1461041157816323b872dd1461031f578163313ce5671461030457816340c10f191461025f57816370a082311461022957816395d89b411461010a57508063a9059cbb146100da5763dd62ed3e1461008e575f80fd5b346100d657806003193601126100d6576020906100a96105f6565b6100b161060c565b9060018060a01b038091165f5260018452825f2091165f528252805f20549051908152f35b5f80fd5b50346100d657806003193601126100d6576020906101036100f96105f6565b6024359033610622565b5160018152f35b82346100d6575f3660031901126100d6578051905f835460018160011c906001831692831561021f575b602093848410811461020c578388529081156101f0575060011461019c575b505050829003601f01601f191682019267ffffffffffffffff84118385101761018957508291826101859252826105af565b0390f35b604190634e487b7160e01b5f525260245ffd5b5f878152929350837f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b5b8385106101dc5750505050830101848080610153565b8054888601830152930192849082016101c6565b60ff1916878501525050151560051b8401019050848080610153565b602289634e487b7160e01b5f525260245ffd5b91607f1691610134565b82346100d65760203660031901126100d6576020906001600160a01b0361024e6105f6565b165f525f8252805f20549051908152f35b82346100d657806003193601126100d6576102786105f6565b6001600160a01b031691602435919083156102ef57600254908382018092116102dc57505f927fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef9260209260025585855284835280852082815401905551908152a3005b601190634e487b7160e01b5f525260245ffd5b5f602492519163ec442f0560e01b8352820152fd5b82346100d6575f3660031901126100d6576020905160068152f35b9050346100d65760603660031901126100d65761033a6105f6565b61034261060c565b906044359260018060a01b038216805f526001602052855f20335f52602052855f2054915f19831061037d575b602087610103888888610622565b8583106103e55781156103cf5733156103b957505f9081526001602090815286822033835281529086902091859003909155829061010361036f565b6024905f885191634a1406b160e11b8352820152fd5b6024905f88519163e602df0560e01b8352820152fd5b8651637dc7a0d960e11b8152339181019182526020820193909352604081018690528291506060010390fd5b82346100d6575f3660031901126100d6576020906002549051908152f35b82346100d657806003193601126100d6576104486105f6565b6024359033156104c1576001600160a01b03169081156104ab5760209350335f5260018452825f20825f52845280835f205582519081527f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925843392a35160018152f35b8251634a1406b160e11b81525f81860152602490fd5b825163e602df0560e01b81525f81860152602490fd5b83346100d6575f3660031901126100d6575f60035460018160011c90600183169283156105a5575b602093848410811461020c578388529081156101f0575060011461054f57505050829003601f01601f191682019267ffffffffffffffff84118385101761018957508291826101859252826105af565b60035f908152929350837fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b5b8385106105915750505050830101848080610153565b80548886018301529301928490820161057b565b91607f16916104ff565b602080825282518183018190529093925f5b8281106105e257505060409293505f838284010152601f8019910116010190565b8181018601518482016040015285016105c1565b600435906001600160a01b03821682036100d657565b602435906001600160a01b03821682036100d657565b916001600160a01b038084169283156106e457169283156106cc57825f525f60205260405f20549082821061069a5750817fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef92602092855f525f84520360405f2055845f5260405f20818154019055604051908152a3565b60405163391434e360e21b81526001600160a01b03919091166004820152602481019190915260448101829052606490fd5b60405163ec442f0560e01b81525f6004820152602490fd5b604051634b637e8f60e11b81525f6004820152602490fdfea2646970667358221220e66a1908e890b981ee6e659c12d0a0072a804672e486d5458936cb2410009a8c64736f6c63430008180033";
    static readonly abi: readonly [{
        readonly inputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "constructor";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "spender";
            readonly type: "address";
        }, {
            readonly internalType: "uint256";
            readonly name: "allowance";
            readonly type: "uint256";
        }, {
            readonly internalType: "uint256";
            readonly name: "needed";
            readonly type: "uint256";
        }];
        readonly name: "ERC20InsufficientAllowance";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "sender";
            readonly type: "address";
        }, {
            readonly internalType: "uint256";
            readonly name: "balance";
            readonly type: "uint256";
        }, {
            readonly internalType: "uint256";
            readonly name: "needed";
            readonly type: "uint256";
        }];
        readonly name: "ERC20InsufficientBalance";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "approver";
            readonly type: "address";
        }];
        readonly name: "ERC20InvalidApprover";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "receiver";
            readonly type: "address";
        }];
        readonly name: "ERC20InvalidReceiver";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "sender";
            readonly type: "address";
        }];
        readonly name: "ERC20InvalidSender";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "spender";
            readonly type: "address";
        }];
        readonly name: "ERC20InvalidSpender";
        readonly type: "error";
    }, {
        readonly anonymous: false;
        readonly inputs: readonly [{
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "owner";
            readonly type: "address";
        }, {
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "spender";
            readonly type: "address";
        }, {
            readonly indexed: false;
            readonly internalType: "uint256";
            readonly name: "value";
            readonly type: "uint256";
        }];
        readonly name: "Approval";
        readonly type: "event";
    }, {
        readonly anonymous: false;
        readonly inputs: readonly [{
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "from";
            readonly type: "address";
        }, {
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "to";
            readonly type: "address";
        }, {
            readonly indexed: false;
            readonly internalType: "uint256";
            readonly name: "value";
            readonly type: "uint256";
        }];
        readonly name: "Transfer";
        readonly type: "event";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "owner";
            readonly type: "address";
        }, {
            readonly internalType: "address";
            readonly name: "spender";
            readonly type: "address";
        }];
        readonly name: "allowance";
        readonly outputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "";
            readonly type: "uint256";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "spender";
            readonly type: "address";
        }, {
            readonly internalType: "uint256";
            readonly name: "value";
            readonly type: "uint256";
        }];
        readonly name: "approve";
        readonly outputs: readonly [{
            readonly internalType: "bool";
            readonly name: "";
            readonly type: "bool";
        }];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "account";
            readonly type: "address";
        }];
        readonly name: "balanceOf";
        readonly outputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "";
            readonly type: "uint256";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "decimals";
        readonly outputs: readonly [{
            readonly internalType: "uint8";
            readonly name: "";
            readonly type: "uint8";
        }];
        readonly stateMutability: "pure";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "to";
            readonly type: "address";
        }, {
            readonly internalType: "uint256";
            readonly name: "amount";
            readonly type: "uint256";
        }];
        readonly name: "mint";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "name";
        readonly outputs: readonly [{
            readonly internalType: "string";
            readonly name: "";
            readonly type: "string";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "symbol";
        readonly outputs: readonly [{
            readonly internalType: "string";
            readonly name: "";
            readonly type: "string";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "totalSupply";
        readonly outputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "";
            readonly type: "uint256";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "to";
            readonly type: "address";
        }, {
            readonly internalType: "uint256";
            readonly name: "value";
            readonly type: "uint256";
        }];
        readonly name: "transfer";
        readonly outputs: readonly [{
            readonly internalType: "bool";
            readonly name: "";
            readonly type: "bool";
        }];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "from";
            readonly type: "address";
        }, {
            readonly internalType: "address";
            readonly name: "to";
            readonly type: "address";
        }, {
            readonly internalType: "uint256";
            readonly name: "value";
            readonly type: "uint256";
        }];
        readonly name: "transferFrom";
        readonly outputs: readonly [{
            readonly internalType: "bool";
            readonly name: "";
            readonly type: "bool";
        }];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }];
    static createInterface(): MockUSDCInterface;
    static connect(address: string, runner?: ContractRunner | null): MockUSDC;
}
export {};
//# sourceMappingURL=MockUSDC__factory.d.ts.map