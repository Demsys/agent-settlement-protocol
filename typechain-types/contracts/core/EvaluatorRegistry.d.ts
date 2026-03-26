import type { BaseContract, BigNumberish, BytesLike, FunctionFragment, Result, Interface, EventFragment, AddressLike, ContractRunner, ContractMethod, Listener } from "ethers";
import type { TypedContractEvent, TypedDeferredTopicFilter, TypedEventLog, TypedLogDescription, TypedListener, TypedContractMethod } from "../../common";
export interface EvaluatorRegistryInterface extends Interface {
    getFunction(nameOrSignature: "MAX_WARMUP_PERIOD" | "assignEvaluator" | "getEvaluatorCount" | "getStake" | "isEligible" | "jobManager" | "minEvaluatorStake" | "owner" | "protocolToken" | "renounceOwnership" | "setJobManager" | "setMinEvaluatorStake" | "setWarmupPeriod" | "slash" | "stake" | "transferOwnership" | "unstake" | "warmupPeriod"): FunctionFragment;
    getEvent(nameOrSignatureOrTopic: "EvaluatorAssigned" | "EvaluatorSlashed" | "MinEvaluatorStakeUpdated" | "OwnershipTransferred" | "Staked" | "Unstaked" | "WarmupPeriodUpdated"): EventFragment;
    encodeFunctionData(functionFragment: "MAX_WARMUP_PERIOD", values?: undefined): string;
    encodeFunctionData(functionFragment: "assignEvaluator", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "getEvaluatorCount", values?: undefined): string;
    encodeFunctionData(functionFragment: "getStake", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "isEligible", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "jobManager", values?: undefined): string;
    encodeFunctionData(functionFragment: "minEvaluatorStake", values?: undefined): string;
    encodeFunctionData(functionFragment: "owner", values?: undefined): string;
    encodeFunctionData(functionFragment: "protocolToken", values?: undefined): string;
    encodeFunctionData(functionFragment: "renounceOwnership", values?: undefined): string;
    encodeFunctionData(functionFragment: "setJobManager", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "setMinEvaluatorStake", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "setWarmupPeriod", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "slash", values: [AddressLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "stake", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "transferOwnership", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "unstake", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "warmupPeriod", values?: undefined): string;
    decodeFunctionResult(functionFragment: "MAX_WARMUP_PERIOD", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "assignEvaluator", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getEvaluatorCount", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getStake", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "isEligible", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "jobManager", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "minEvaluatorStake", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "owner", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "protocolToken", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "renounceOwnership", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "setJobManager", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "setMinEvaluatorStake", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "setWarmupPeriod", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "slash", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "stake", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "transferOwnership", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "unstake", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "warmupPeriod", data: BytesLike): Result;
}
export declare namespace EvaluatorAssignedEvent {
    type InputTuple = [jobId: BigNumberish, evaluator: AddressLike];
    type OutputTuple = [jobId: bigint, evaluator: string];
    interface OutputObject {
        jobId: bigint;
        evaluator: string;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace EvaluatorSlashedEvent {
    type InputTuple = [
        evaluator: AddressLike,
        amount: BigNumberish,
        remainingStake: BigNumberish
    ];
    type OutputTuple = [
        evaluator: string,
        amount: bigint,
        remainingStake: bigint
    ];
    interface OutputObject {
        evaluator: string;
        amount: bigint;
        remainingStake: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace MinEvaluatorStakeUpdatedEvent {
    type InputTuple = [oldMinimum: BigNumberish, newMinimum: BigNumberish];
    type OutputTuple = [oldMinimum: bigint, newMinimum: bigint];
    interface OutputObject {
        oldMinimum: bigint;
        newMinimum: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace OwnershipTransferredEvent {
    type InputTuple = [previousOwner: AddressLike, newOwner: AddressLike];
    type OutputTuple = [previousOwner: string, newOwner: string];
    interface OutputObject {
        previousOwner: string;
        newOwner: string;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace StakedEvent {
    type InputTuple = [
        evaluator: AddressLike,
        amount: BigNumberish,
        newTotal: BigNumberish
    ];
    type OutputTuple = [
        evaluator: string,
        amount: bigint,
        newTotal: bigint
    ];
    interface OutputObject {
        evaluator: string;
        amount: bigint;
        newTotal: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace UnstakedEvent {
    type InputTuple = [
        evaluator: AddressLike,
        amount: BigNumberish,
        newTotal: BigNumberish
    ];
    type OutputTuple = [
        evaluator: string,
        amount: bigint,
        newTotal: bigint
    ];
    interface OutputObject {
        evaluator: string;
        amount: bigint;
        newTotal: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace WarmupPeriodUpdatedEvent {
    type InputTuple = [newPeriod: BigNumberish];
    type OutputTuple = [newPeriod: bigint];
    interface OutputObject {
        newPeriod: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export interface EvaluatorRegistry extends BaseContract {
    connect(runner?: ContractRunner | null): EvaluatorRegistry;
    waitForDeployment(): Promise<this>;
    interface: EvaluatorRegistryInterface;
    queryFilter<TCEvent extends TypedContractEvent>(event: TCEvent, fromBlockOrBlockhash?: string | number | undefined, toBlock?: string | number | undefined): Promise<Array<TypedEventLog<TCEvent>>>;
    queryFilter<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, fromBlockOrBlockhash?: string | number | undefined, toBlock?: string | number | undefined): Promise<Array<TypedEventLog<TCEvent>>>;
    on<TCEvent extends TypedContractEvent>(event: TCEvent, listener: TypedListener<TCEvent>): Promise<this>;
    on<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, listener: TypedListener<TCEvent>): Promise<this>;
    once<TCEvent extends TypedContractEvent>(event: TCEvent, listener: TypedListener<TCEvent>): Promise<this>;
    once<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, listener: TypedListener<TCEvent>): Promise<this>;
    listeners<TCEvent extends TypedContractEvent>(event: TCEvent): Promise<Array<TypedListener<TCEvent>>>;
    listeners(eventName?: string): Promise<Array<Listener>>;
    removeAllListeners<TCEvent extends TypedContractEvent>(event?: TCEvent): Promise<this>;
    MAX_WARMUP_PERIOD: TypedContractMethod<[], [bigint], "view">;
    assignEvaluator: TypedContractMethod<[
        jobId: BigNumberish
    ], [
        string
    ], "nonpayable">;
    getEvaluatorCount: TypedContractMethod<[], [bigint], "view">;
    getStake: TypedContractMethod<[evaluator: AddressLike], [bigint], "view">;
    isEligible: TypedContractMethod<[evaluator: AddressLike], [boolean], "view">;
    jobManager: TypedContractMethod<[], [string], "view">;
    minEvaluatorStake: TypedContractMethod<[], [bigint], "view">;
    owner: TypedContractMethod<[], [string], "view">;
    protocolToken: TypedContractMethod<[], [string], "view">;
    renounceOwnership: TypedContractMethod<[], [void], "nonpayable">;
    setJobManager: TypedContractMethod<[
        _jobManager: AddressLike
    ], [
        void
    ], "nonpayable">;
    setMinEvaluatorStake: TypedContractMethod<[
        newMinimum: BigNumberish
    ], [
        void
    ], "nonpayable">;
    setWarmupPeriod: TypedContractMethod<[
        newPeriod: BigNumberish
    ], [
        void
    ], "nonpayable">;
    slash: TypedContractMethod<[
        evaluator: AddressLike,
        amount: BigNumberish
    ], [
        void
    ], "nonpayable">;
    stake: TypedContractMethod<[amount: BigNumberish], [void], "nonpayable">;
    transferOwnership: TypedContractMethod<[
        newOwner: AddressLike
    ], [
        void
    ], "nonpayable">;
    unstake: TypedContractMethod<[amount: BigNumberish], [void], "nonpayable">;
    warmupPeriod: TypedContractMethod<[], [bigint], "view">;
    getFunction<T extends ContractMethod = ContractMethod>(key: string | FunctionFragment): T;
    getFunction(nameOrSignature: "MAX_WARMUP_PERIOD"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "assignEvaluator"): TypedContractMethod<[jobId: BigNumberish], [string], "nonpayable">;
    getFunction(nameOrSignature: "getEvaluatorCount"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "getStake"): TypedContractMethod<[evaluator: AddressLike], [bigint], "view">;
    getFunction(nameOrSignature: "isEligible"): TypedContractMethod<[evaluator: AddressLike], [boolean], "view">;
    getFunction(nameOrSignature: "jobManager"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "minEvaluatorStake"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "owner"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "protocolToken"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "renounceOwnership"): TypedContractMethod<[], [void], "nonpayable">;
    getFunction(nameOrSignature: "setJobManager"): TypedContractMethod<[_jobManager: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "setMinEvaluatorStake"): TypedContractMethod<[newMinimum: BigNumberish], [void], "nonpayable">;
    getFunction(nameOrSignature: "setWarmupPeriod"): TypedContractMethod<[newPeriod: BigNumberish], [void], "nonpayable">;
    getFunction(nameOrSignature: "slash"): TypedContractMethod<[
        evaluator: AddressLike,
        amount: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "stake"): TypedContractMethod<[amount: BigNumberish], [void], "nonpayable">;
    getFunction(nameOrSignature: "transferOwnership"): TypedContractMethod<[newOwner: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "unstake"): TypedContractMethod<[amount: BigNumberish], [void], "nonpayable">;
    getFunction(nameOrSignature: "warmupPeriod"): TypedContractMethod<[], [bigint], "view">;
    getEvent(key: "EvaluatorAssigned"): TypedContractEvent<EvaluatorAssignedEvent.InputTuple, EvaluatorAssignedEvent.OutputTuple, EvaluatorAssignedEvent.OutputObject>;
    getEvent(key: "EvaluatorSlashed"): TypedContractEvent<EvaluatorSlashedEvent.InputTuple, EvaluatorSlashedEvent.OutputTuple, EvaluatorSlashedEvent.OutputObject>;
    getEvent(key: "MinEvaluatorStakeUpdated"): TypedContractEvent<MinEvaluatorStakeUpdatedEvent.InputTuple, MinEvaluatorStakeUpdatedEvent.OutputTuple, MinEvaluatorStakeUpdatedEvent.OutputObject>;
    getEvent(key: "OwnershipTransferred"): TypedContractEvent<OwnershipTransferredEvent.InputTuple, OwnershipTransferredEvent.OutputTuple, OwnershipTransferredEvent.OutputObject>;
    getEvent(key: "Staked"): TypedContractEvent<StakedEvent.InputTuple, StakedEvent.OutputTuple, StakedEvent.OutputObject>;
    getEvent(key: "Unstaked"): TypedContractEvent<UnstakedEvent.InputTuple, UnstakedEvent.OutputTuple, UnstakedEvent.OutputObject>;
    getEvent(key: "WarmupPeriodUpdated"): TypedContractEvent<WarmupPeriodUpdatedEvent.InputTuple, WarmupPeriodUpdatedEvent.OutputTuple, WarmupPeriodUpdatedEvent.OutputObject>;
    filters: {
        "EvaluatorAssigned(uint256,address)": TypedContractEvent<EvaluatorAssignedEvent.InputTuple, EvaluatorAssignedEvent.OutputTuple, EvaluatorAssignedEvent.OutputObject>;
        EvaluatorAssigned: TypedContractEvent<EvaluatorAssignedEvent.InputTuple, EvaluatorAssignedEvent.OutputTuple, EvaluatorAssignedEvent.OutputObject>;
        "EvaluatorSlashed(address,uint256,uint256)": TypedContractEvent<EvaluatorSlashedEvent.InputTuple, EvaluatorSlashedEvent.OutputTuple, EvaluatorSlashedEvent.OutputObject>;
        EvaluatorSlashed: TypedContractEvent<EvaluatorSlashedEvent.InputTuple, EvaluatorSlashedEvent.OutputTuple, EvaluatorSlashedEvent.OutputObject>;
        "MinEvaluatorStakeUpdated(uint256,uint256)": TypedContractEvent<MinEvaluatorStakeUpdatedEvent.InputTuple, MinEvaluatorStakeUpdatedEvent.OutputTuple, MinEvaluatorStakeUpdatedEvent.OutputObject>;
        MinEvaluatorStakeUpdated: TypedContractEvent<MinEvaluatorStakeUpdatedEvent.InputTuple, MinEvaluatorStakeUpdatedEvent.OutputTuple, MinEvaluatorStakeUpdatedEvent.OutputObject>;
        "OwnershipTransferred(address,address)": TypedContractEvent<OwnershipTransferredEvent.InputTuple, OwnershipTransferredEvent.OutputTuple, OwnershipTransferredEvent.OutputObject>;
        OwnershipTransferred: TypedContractEvent<OwnershipTransferredEvent.InputTuple, OwnershipTransferredEvent.OutputTuple, OwnershipTransferredEvent.OutputObject>;
        "Staked(address,uint256,uint256)": TypedContractEvent<StakedEvent.InputTuple, StakedEvent.OutputTuple, StakedEvent.OutputObject>;
        Staked: TypedContractEvent<StakedEvent.InputTuple, StakedEvent.OutputTuple, StakedEvent.OutputObject>;
        "Unstaked(address,uint256,uint256)": TypedContractEvent<UnstakedEvent.InputTuple, UnstakedEvent.OutputTuple, UnstakedEvent.OutputObject>;
        Unstaked: TypedContractEvent<UnstakedEvent.InputTuple, UnstakedEvent.OutputTuple, UnstakedEvent.OutputObject>;
        "WarmupPeriodUpdated(uint64)": TypedContractEvent<WarmupPeriodUpdatedEvent.InputTuple, WarmupPeriodUpdatedEvent.OutputTuple, WarmupPeriodUpdatedEvent.OutputObject>;
        WarmupPeriodUpdated: TypedContractEvent<WarmupPeriodUpdatedEvent.InputTuple, WarmupPeriodUpdatedEvent.OutputTuple, WarmupPeriodUpdatedEvent.OutputObject>;
    };
}
//# sourceMappingURL=EvaluatorRegistry.d.ts.map