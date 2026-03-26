import { ContractFactory, ContractTransactionResponse } from "ethers";
import type { Signer, AddressLike, ContractDeployTransaction, ContractRunner } from "ethers";
import type { NonPayableOverrides } from "../../../common";
import type { EvaluatorRegistry, EvaluatorRegistryInterface } from "../../../contracts/core/EvaluatorRegistry";
type EvaluatorRegistryConstructorParams = [signer?: Signer] | ConstructorParameters<typeof ContractFactory>;
export declare class EvaluatorRegistry__factory extends ContractFactory {
    constructor(...args: EvaluatorRegistryConstructorParams);
    getDeployTransaction(_protocolToken: AddressLike, overrides?: NonPayableOverrides & {
        from?: string;
    }): Promise<ContractDeployTransaction>;
    deploy(_protocolToken: AddressLike, overrides?: NonPayableOverrides & {
        from?: string;
    }): Promise<EvaluatorRegistry & {
        deploymentTransaction(): ContractTransactionResponse;
    }>;
    connect(runner: ContractRunner | null): EvaluatorRegistry__factory;
    static readonly bytecode = "0x60a060405268056bc75e2d63100000600155600280546001600160401b03191662093a80179055348015610031575f80fd5b506040516113453803806113458339810160408190526100509161014b565b60017f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f0055338061009a57604051631e4fbdf760e01b81525f60048201526024015b60405180910390fd5b6100a3816100fc565b506001600160a01b0381166100eb5760405163eac0d38960e01b815260206004820152600d60248201526c383937ba37b1b7b62a37b5b2b760991b6044820152606401610091565b6001600160a01b0316608052610178565b5f80546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b5f6020828403121561015b575f80fd5b81516001600160a01b0381168114610171575f80fd5b9392505050565b6080516111a06101a55f395f818161015f015281816103e401528181610a290152610c6801526111a05ff3fe608060405234801561000f575f80fd5b5060043610610111575f3560e01c80637a7664601161009e578063abca6de51161006e578063abca6de51461028d578063c07d40d0146102af578063deac361a146102b8578063f2fde38b146102cb578063f7eef6e4146102de575f80fd5b80637a766460146102215780638da5cb5b14610257578063a2bef17a14610267578063a694fc3a1461027a575f80fd5b80632406d001116100e45780632406d001146101945780632e17de78146101a75780633df395a3146101ba57806366e305fd146101d4578063715018a614610219575f80fd5b806302fb4d851461011557806314ad240e1461012a5780631a465fe11461015a5780631ef9176a14610181575b5f80fd5b610128610123366004611017565b6102e6565b005b61013d61013836600461103f565b6104aa565b6040516001600160a01b0390911681526020015b60405180910390f35b61013d7f000000000000000000000000000000000000000000000000000000000000000081565b61012861018f366004611056565b610795565b6101286101a236600461103f565b610812565b6101286101b536600461103f565b610906565b60025461013d90600160401b90046001600160a01b031681565b6102096101e2366004611056565b6001600160a01b03165f90815260036020526040902060020154600160401b900460ff1690565b6040519015158152602001610151565b610128610aae565b61024961022f366004611056565b6001600160a01b03165f9081526003602052604090205490565b604051908152602001610151565b5f546001600160a01b031661013d565b610128610275366004611076565b610ac1565b61012861028836600461103f565b610b5f565b61029762278d0081565b6040516001600160401b039091168152602001610151565b61024960015481565b600254610297906001600160401b031681565b6101286102d9366004611056565b610cea565b600454610249565b600254600160401b90046001600160a01b0316331461031f57604051630ece3e3d60e31b81523360048201526024015b60405180910390fd5b610327610d24565b6001600160a01b0382165f908152600360205260409020805482111561036d5780546040516333667e8360e11b8152610316918491600401918252602082015260400190565b81815f015f82825461037f91906110b0565b90915550506002810154600160401b900460ff1680156103a157506001548154105b156103ce576103b38160010154610d3f565b6002810180545f600184015568ffffffffffffffffff191690555b604051630852cd8d60e31b8152600481018390527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316906342966c68906024015f604051808303815f87803b15801561042d575f80fd5b505af115801561043f573d5f803e3d5ffd5b505082546040516001600160a01b03871693507f73e6b8bfc9c447f06664eee059dfc08cbba545e94f3d6554c8d486e85aab3d56925061048791868252602082015260400190565b60405180910390a2506104a660015f8051602061114b83398151915255565b5050565b6002545f90600160401b90046001600160a01b031633146104e057604051630ece3e3d60e31b8152336004820152602401610316565b6004545f81900361050457604051630526f30160e51b815260040160405180910390fd5b6002545f9061051c906001600160401b0316426110c9565b90505f805b838110156105cd57826001600160401b031660035f60048481548110610549576105496110f0565b5f9182526020808320909101546001600160a01b031683528201929092526040019020600201546001600160401b0316116105c55760035f60048381548110610594576105946110f0565b5f9182526020808320909101546001600160a01b031683528201929092526040019020546105c29083611104565b91505b600101610521565b50805f036105ee57604051630526f30160e51b815260040160405180910390fd5b604080514460208201529081018690524260608083019190915233901b6bffffffffffffffffffffffff191660808201525f908290609401604051602081830303815290604052805190602001205f1c6106489190611117565b90505f805b8581101561072e57846001600160401b031660035f60048481548110610675576106756110f0565b5f9182526020808320909101546001600160a01b031683528201929092526040019020600201546001600160401b0316116107265760035f600483815481106106c0576106c06110f0565b5f9182526020808320909101546001600160a01b031683528201929092526040019020546106ee9083611104565b915081831015610726576004818154811061070b5761070b6110f0565b5f918252602090912001546001600160a01b0316965061072e565b60010161064d565b506001600160a01b03861661075657604051630526f30160e51b815260040160405180910390fd5b6040516001600160a01b0387169088907f50a93d710505e6f207121334c60e2a4c6312fdbae71f879f5abee6488e20b131905f90a35050505050919050565b61079d610e0d565b6001600160a01b0381166107e15760405163eac0d38960e01b815260206004820152600a6024820152693537b126b0b730b3b2b960b11b6044820152606401610316565b600280546001600160a01b03909216600160401b0268010000000000000000600160e01b0319909216919091179055565b61081a610e0d565b805f0361083a57604051631f2a200560e01b815260040160405180910390fd5b60018054908290555f5b6004548110156108c8575f60048281548110610862576108626110f0565b5f9182526020808320909101546001600160a01b0316808352600390915260409091208054919250908511156108ba5761089b83610d3f565b6002810180545f600184015568ffffffffffffffffff191690556108c1565b8260010192505b5050610844565b60408051838152602081018590527f33938c8d900451f6890cdb2657a550bc246f7fc4454d335fad7f51b02097997e910160405180910390a1505050565b61090e610d24565b805f0361092e57604051631f2a200560e01b815260040160405180910390fd5b335f908152600360205260409020805482111561096b5780546040516322df051360e11b8152610316918491600401918252602082015260400190565b80545f9061097a9084906110b0565b6002830154909150600160401b900460ff16801561099757505f81115b80156109a4575060015481105b156109d057600154604051630cf4398f60e01b8152610316918391600401918252602082015260400190565b8082556002820154600160401b900460ff1680156109ef575060015481105b15610a1c57610a018260010154610d3f565b6002820180545f600185015568ffffffffffffffffff191690555b610a506001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000163385610e39565b815460405133917f7fc4727e062e336010f2c282598ef5f14facb3de68cf8195c2f23e1454b2b74e91610a8b91878252602082015260400190565b60405180910390a25050610aab60015f8051602061114b83398151915255565b50565b610ab6610e0d565b610abf5f610e73565b565b610ac9610e0d565b62278d006001600160401b0382161115610b0a576040516325d4015f60e21b81526001600160401b038216600482015262278d006024820152604401610316565b6002805467ffffffffffffffff19166001600160401b0383169081179091556040519081527fe49d75f07bb63967b52ee54efb53d7bcb36091cde81d37569d7dcb0d3a9c76959060200160405180910390a150565b610b67610d24565b805f03610b8757604051631f2a200560e01b815260040160405180910390fd5b335f908152600360205260408120805490918391839190610ba9908490611104565b90915550506002810154600160401b900460ff16158015610bcd5750600154815410155b15610c5b57600281018054600160401b68ff0000000000000000198216811783556004805460018087019190915568ffffffffffffffffff19909316426001600160401b031617909117909255815490810182555f919091527f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b018054336001600160a01b03199091161790555b610c906001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016333085610ec2565b805460405133917f1449c6dd7851abc30abf37f57715f492010519147cc2652fbc38202c18a6ee9091610ccb91868252602082015260400190565b60405180910390a250610aab60015f8051602061114b83398151915255565b610cf2610e0d565b6001600160a01b038116610d1b57604051631e4fbdf760e01b81525f6004820152602401610316565b610aab81610e73565b610d2c610efe565b60025f8051602061114b83398151915255565b6004545f90610d50906001906110b0565b9050808214610dd8575f60048281548110610d6d57610d6d6110f0565b5f91825260209091200154600480546001600160a01b039092169250829185908110610d9b57610d9b6110f0565b5f91825260208083209190910180546001600160a01b0319166001600160a01b039485161790559290911681526003909152604090206001018290555b6004805480610de957610de9611136565b5f8281526020902081015f1990810180546001600160a01b03191690550190555050565b5f546001600160a01b03163314610abf5760405163118cdaa760e01b8152336004820152602401610316565b610e468383836001610f2d565b610e6e57604051635274afe760e01b81526001600160a01b0384166004820152602401610316565b505050565b5f80546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b610ed0848484846001610f8f565b610ef857604051635274afe760e01b81526001600160a01b0385166004820152602401610316565b50505050565b5f8051602061114b83398151915254600203610abf57604051633ee5aeb560e01b815260040160405180910390fd5b60405163a9059cbb60e01b5f8181526001600160a01b038616600452602485905291602083604481808b5af1925060015f51148316610f83578383151615610f77573d5f823e3d81fd5b5f873b113d1516831692505b60405250949350505050565b6040516323b872dd60e01b5f8181526001600160a01b038781166004528616602452604485905291602083606481808c5af1925060015f51148316610feb578383151615610fdf573d5f823e3d81fd5b5f883b113d1516831692505b604052505f60605295945050505050565b80356001600160a01b0381168114611012575f80fd5b919050565b5f8060408385031215611028575f80fd5b61103183610ffc565b946020939093013593505050565b5f6020828403121561104f575f80fd5b5035919050565b5f60208284031215611066575f80fd5b61106f82610ffc565b9392505050565b5f60208284031215611086575f80fd5b81356001600160401b038116811461106f575f80fd5b634e487b7160e01b5f52601160045260245ffd5b818103818111156110c3576110c361109c565b92915050565b6001600160401b038281168282160390808211156110e9576110e961109c565b5092915050565b634e487b7160e01b5f52603260045260245ffd5b808201808211156110c3576110c361109c565b5f8261113157634e487b7160e01b5f52601260045260245ffd5b500690565b634e487b7160e01b5f52603160045260245ffdfe9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00a2646970667358221220952e51af095ac9c7493f69ba5d99182e1048847d44eb0796cf784beb19e7158c64736f6c63430008180033";
    static readonly abi: readonly [{
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "_protocolToken";
            readonly type: "address";
        }];
        readonly stateMutability: "nonpayable";
        readonly type: "constructor";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "requested";
            readonly type: "uint256";
        }, {
            readonly internalType: "uint256";
            readonly name: "available";
            readonly type: "uint256";
        }];
        readonly name: "InsufficientStake";
        readonly type: "error";
    }, {
        readonly inputs: readonly [];
        readonly name: "NoEligibleEvaluators";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "caller";
            readonly type: "address";
        }];
        readonly name: "OnlyJobManager";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "owner";
            readonly type: "address";
        }];
        readonly name: "OwnableInvalidOwner";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "account";
            readonly type: "address";
        }];
        readonly name: "OwnableUnauthorizedAccount";
        readonly type: "error";
    }, {
        readonly inputs: readonly [];
        readonly name: "ReentrancyGuardReentrantCall";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "token";
            readonly type: "address";
        }];
        readonly name: "SafeERC20FailedOperation";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "requested";
            readonly type: "uint256";
        }, {
            readonly internalType: "uint256";
            readonly name: "available";
            readonly type: "uint256";
        }];
        readonly name: "SlashExceedsStake";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "uint64";
            readonly name: "proposed";
            readonly type: "uint64";
        }, {
            readonly internalType: "uint64";
            readonly name: "maximum";
            readonly type: "uint64";
        }];
        readonly name: "WarmupPeriodTooLong";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "remaining";
            readonly type: "uint256";
        }, {
            readonly internalType: "uint256";
            readonly name: "minimum";
            readonly type: "uint256";
        }];
        readonly name: "WouldDropBelowMinimum";
        readonly type: "error";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "string";
            readonly name: "paramName";
            readonly type: "string";
        }];
        readonly name: "ZeroAddress";
        readonly type: "error";
    }, {
        readonly inputs: readonly [];
        readonly name: "ZeroAmount";
        readonly type: "error";
    }, {
        readonly anonymous: false;
        readonly inputs: readonly [{
            readonly indexed: true;
            readonly internalType: "uint256";
            readonly name: "jobId";
            readonly type: "uint256";
        }, {
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "evaluator";
            readonly type: "address";
        }];
        readonly name: "EvaluatorAssigned";
        readonly type: "event";
    }, {
        readonly anonymous: false;
        readonly inputs: readonly [{
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "evaluator";
            readonly type: "address";
        }, {
            readonly indexed: false;
            readonly internalType: "uint256";
            readonly name: "amount";
            readonly type: "uint256";
        }, {
            readonly indexed: false;
            readonly internalType: "uint256";
            readonly name: "remainingStake";
            readonly type: "uint256";
        }];
        readonly name: "EvaluatorSlashed";
        readonly type: "event";
    }, {
        readonly anonymous: false;
        readonly inputs: readonly [{
            readonly indexed: false;
            readonly internalType: "uint256";
            readonly name: "oldMinimum";
            readonly type: "uint256";
        }, {
            readonly indexed: false;
            readonly internalType: "uint256";
            readonly name: "newMinimum";
            readonly type: "uint256";
        }];
        readonly name: "MinEvaluatorStakeUpdated";
        readonly type: "event";
    }, {
        readonly anonymous: false;
        readonly inputs: readonly [{
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "previousOwner";
            readonly type: "address";
        }, {
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "newOwner";
            readonly type: "address";
        }];
        readonly name: "OwnershipTransferred";
        readonly type: "event";
    }, {
        readonly anonymous: false;
        readonly inputs: readonly [{
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "evaluator";
            readonly type: "address";
        }, {
            readonly indexed: false;
            readonly internalType: "uint256";
            readonly name: "amount";
            readonly type: "uint256";
        }, {
            readonly indexed: false;
            readonly internalType: "uint256";
            readonly name: "newTotal";
            readonly type: "uint256";
        }];
        readonly name: "Staked";
        readonly type: "event";
    }, {
        readonly anonymous: false;
        readonly inputs: readonly [{
            readonly indexed: true;
            readonly internalType: "address";
            readonly name: "evaluator";
            readonly type: "address";
        }, {
            readonly indexed: false;
            readonly internalType: "uint256";
            readonly name: "amount";
            readonly type: "uint256";
        }, {
            readonly indexed: false;
            readonly internalType: "uint256";
            readonly name: "newTotal";
            readonly type: "uint256";
        }];
        readonly name: "Unstaked";
        readonly type: "event";
    }, {
        readonly anonymous: false;
        readonly inputs: readonly [{
            readonly indexed: false;
            readonly internalType: "uint64";
            readonly name: "newPeriod";
            readonly type: "uint64";
        }];
        readonly name: "WarmupPeriodUpdated";
        readonly type: "event";
    }, {
        readonly inputs: readonly [];
        readonly name: "MAX_WARMUP_PERIOD";
        readonly outputs: readonly [{
            readonly internalType: "uint64";
            readonly name: "";
            readonly type: "uint64";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "jobId";
            readonly type: "uint256";
        }];
        readonly name: "assignEvaluator";
        readonly outputs: readonly [{
            readonly internalType: "address";
            readonly name: "assigned";
            readonly type: "address";
        }];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "getEvaluatorCount";
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
            readonly name: "evaluator";
            readonly type: "address";
        }];
        readonly name: "getStake";
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
            readonly name: "evaluator";
            readonly type: "address";
        }];
        readonly name: "isEligible";
        readonly outputs: readonly [{
            readonly internalType: "bool";
            readonly name: "";
            readonly type: "bool";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "jobManager";
        readonly outputs: readonly [{
            readonly internalType: "address";
            readonly name: "";
            readonly type: "address";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "minEvaluatorStake";
        readonly outputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "";
            readonly type: "uint256";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "owner";
        readonly outputs: readonly [{
            readonly internalType: "address";
            readonly name: "";
            readonly type: "address";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "protocolToken";
        readonly outputs: readonly [{
            readonly internalType: "contract ProtocolToken";
            readonly name: "";
            readonly type: "address";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "renounceOwnership";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "_jobManager";
            readonly type: "address";
        }];
        readonly name: "setJobManager";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "newMinimum";
            readonly type: "uint256";
        }];
        readonly name: "setMinEvaluatorStake";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "uint64";
            readonly name: "newPeriod";
            readonly type: "uint64";
        }];
        readonly name: "setWarmupPeriod";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "evaluator";
            readonly type: "address";
        }, {
            readonly internalType: "uint256";
            readonly name: "amount";
            readonly type: "uint256";
        }];
        readonly name: "slash";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "amount";
            readonly type: "uint256";
        }];
        readonly name: "stake";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "newOwner";
            readonly type: "address";
        }];
        readonly name: "transferOwnership";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "uint256";
            readonly name: "amount";
            readonly type: "uint256";
        }];
        readonly name: "unstake";
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
        readonly type: "function";
    }, {
        readonly inputs: readonly [];
        readonly name: "warmupPeriod";
        readonly outputs: readonly [{
            readonly internalType: "uint64";
            readonly name: "";
            readonly type: "uint64";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }];
    static createInterface(): EvaluatorRegistryInterface;
    static connect(address: string, runner?: ContractRunner | null): EvaluatorRegistry;
}
export {};
//# sourceMappingURL=EvaluatorRegistry__factory.d.ts.map