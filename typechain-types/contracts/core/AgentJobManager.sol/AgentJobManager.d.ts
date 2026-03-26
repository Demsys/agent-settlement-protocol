import type { BaseContract, BigNumberish, BytesLike, FunctionFragment, Result, Interface, EventFragment, AddressLike, ContractRunner, ContractMethod, Listener } from "ethers";
import type { TypedContractEvent, TypedDeferredTopicFilter, TypedEventLog, TypedLogDescription, TypedListener, TypedContractMethod } from "../../../common";
export declare namespace IAgentJobManager {
    type JobStruct = {
        client: AddressLike;
        provider: AddressLike;
        evaluator: AddressLike;
        token: AddressLike;
        budget: BigNumberish;
        deadline: BigNumberish;
        createdAt: BigNumberish;
        status: BigNumberish;
        deliverable: BytesLike;
        reason: BytesLike;
    };
    type JobStructOutput = [
        client: string,
        provider: string,
        evaluator: string,
        token: string,
        budget: bigint,
        deadline: bigint,
        createdAt: bigint,
        status: bigint,
        deliverable: string,
        reason: string
    ] & {
        client: string;
        provider: string;
        evaluator: string;
        token: string;
        budget: bigint;
        deadline: bigint;
        createdAt: bigint;
        status: bigint;
        deliverable: string;
        reason: string;
    };
}
export interface AgentJobManagerInterface extends Interface {
    getFunction(nameOrSignature: "MAX_FEE_RATE" | "MIN_DEADLINE_OFFSET" | "claimExpired" | "claimRefund" | "complete" | "createJob" | "evaluatorRegistry" | "extendDeadline" | "feeRate" | "feeRecipient" | "fund" | "getFeeRate" | "getJob" | "getPendingRefund" | "owner" | "reject" | "renounceOwnership" | "reopen" | "reputationBridge" | "setBudget" | "setFeeRate" | "setFeeRecipient" | "setReputationBridge" | "submit" | "transferOwnership"): FunctionFragment;
    getEvent(nameOrSignatureOrTopic: "BudgetSet" | "DeadlineExtended" | "JobCompleted" | "JobCreated" | "JobExpired" | "JobFunded" | "JobRejected" | "JobReopened" | "JobSubmitted" | "OwnershipTransferred" | "RefundClaimed" | "RefundPending" | "ReputationBridgeUpdated"): EventFragment;
    encodeFunctionData(functionFragment: "MAX_FEE_RATE", values?: undefined): string;
    encodeFunctionData(functionFragment: "MIN_DEADLINE_OFFSET", values?: undefined): string;
    encodeFunctionData(functionFragment: "claimExpired", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "claimRefund", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "complete", values: [BigNumberish, BytesLike]): string;
    encodeFunctionData(functionFragment: "createJob", values: [AddressLike, AddressLike, AddressLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "evaluatorRegistry", values?: undefined): string;
    encodeFunctionData(functionFragment: "extendDeadline", values: [BigNumberish, BigNumberish]): string;
    encodeFunctionData(functionFragment: "feeRate", values?: undefined): string;
    encodeFunctionData(functionFragment: "feeRecipient", values?: undefined): string;
    encodeFunctionData(functionFragment: "fund", values: [BigNumberish, BigNumberish]): string;
    encodeFunctionData(functionFragment: "getFeeRate", values?: undefined): string;
    encodeFunctionData(functionFragment: "getJob", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "getPendingRefund", values: [AddressLike, AddressLike]): string;
    encodeFunctionData(functionFragment: "owner", values?: undefined): string;
    encodeFunctionData(functionFragment: "reject", values: [BigNumberish, BytesLike]): string;
    encodeFunctionData(functionFragment: "renounceOwnership", values?: undefined): string;
    encodeFunctionData(functionFragment: "reopen", values: [BigNumberish, AddressLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "reputationBridge", values?: undefined): string;
    encodeFunctionData(functionFragment: "setBudget", values: [BigNumberish, BigNumberish]): string;
    encodeFunctionData(functionFragment: "setFeeRate", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "setFeeRecipient", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "setReputationBridge", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "submit", values: [BigNumberish, BytesLike]): string;
    encodeFunctionData(functionFragment: "transferOwnership", values: [AddressLike]): string;
    decodeFunctionResult(functionFragment: "MAX_FEE_RATE", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "MIN_DEADLINE_OFFSET", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "claimExpired", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "claimRefund", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "complete", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "createJob", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "evaluatorRegistry", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "extendDeadline", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "feeRate", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "feeRecipient", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "fund", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getFeeRate", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getJob", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getPendingRefund", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "owner", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "reject", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "renounceOwnership", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "reopen", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "reputationBridge", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "setBudget", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "setFeeRate", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "setFeeRecipient", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "setReputationBridge", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "submit", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "transferOwnership", data: BytesLike): Result;
}
export declare namespace BudgetSetEvent {
    type InputTuple = [jobId: BigNumberish, amount: BigNumberish];
    type OutputTuple = [jobId: bigint, amount: bigint];
    interface OutputObject {
        jobId: bigint;
        amount: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace DeadlineExtendedEvent {
    type InputTuple = [
        jobId: BigNumberish,
        oldDeadline: BigNumberish,
        newDeadline: BigNumberish
    ];
    type OutputTuple = [
        jobId: bigint,
        oldDeadline: bigint,
        newDeadline: bigint
    ];
    interface OutputObject {
        jobId: bigint;
        oldDeadline: bigint;
        newDeadline: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace JobCompletedEvent {
    type InputTuple = [
        jobId: BigNumberish,
        provider: AddressLike,
        payment: BigNumberish,
        fee: BigNumberish
    ];
    type OutputTuple = [
        jobId: bigint,
        provider: string,
        payment: bigint,
        fee: bigint
    ];
    interface OutputObject {
        jobId: bigint;
        provider: string;
        payment: bigint;
        fee: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace JobCreatedEvent {
    type InputTuple = [
        jobId: BigNumberish,
        client: AddressLike,
        provider: AddressLike,
        evaluator: AddressLike,
        token: AddressLike,
        deadline: BigNumberish
    ];
    type OutputTuple = [
        jobId: bigint,
        client: string,
        provider: string,
        evaluator: string,
        token: string,
        deadline: bigint
    ];
    interface OutputObject {
        jobId: bigint;
        client: string;
        provider: string;
        evaluator: string;
        token: string;
        deadline: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace JobExpiredEvent {
    type InputTuple = [jobId: BigNumberish, refundedTo: AddressLike];
    type OutputTuple = [jobId: bigint, refundedTo: string];
    interface OutputObject {
        jobId: bigint;
        refundedTo: string;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace JobFundedEvent {
    type InputTuple = [jobId: BigNumberish, amount: BigNumberish];
    type OutputTuple = [jobId: bigint, amount: bigint];
    interface OutputObject {
        jobId: bigint;
        amount: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace JobRejectedEvent {
    type InputTuple = [
        jobId: BigNumberish,
        refundedTo: AddressLike,
        reason: BytesLike
    ];
    type OutputTuple = [jobId: bigint, refundedTo: string, reason: string];
    interface OutputObject {
        jobId: bigint;
        refundedTo: string;
        reason: string;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace JobReopenedEvent {
    type InputTuple = [
        jobId: BigNumberish,
        client: AddressLike,
        newProvider: AddressLike,
        newDeadline: BigNumberish
    ];
    type OutputTuple = [
        jobId: bigint,
        client: string,
        newProvider: string,
        newDeadline: bigint
    ];
    interface OutputObject {
        jobId: bigint;
        client: string;
        newProvider: string;
        newDeadline: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace JobSubmittedEvent {
    type InputTuple = [jobId: BigNumberish, deliverable: BytesLike];
    type OutputTuple = [jobId: bigint, deliverable: string];
    interface OutputObject {
        jobId: bigint;
        deliverable: string;
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
export declare namespace RefundClaimedEvent {
    type InputTuple = [
        client: AddressLike,
        token: AddressLike,
        amount: BigNumberish
    ];
    type OutputTuple = [client: string, token: string, amount: bigint];
    interface OutputObject {
        client: string;
        token: string;
        amount: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace RefundPendingEvent {
    type InputTuple = [
        client: AddressLike,
        token: AddressLike,
        amount: BigNumberish
    ];
    type OutputTuple = [client: string, token: string, amount: bigint];
    interface OutputObject {
        client: string;
        token: string;
        amount: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace ReputationBridgeUpdatedEvent {
    type InputTuple = [newBridge: AddressLike];
    type OutputTuple = [newBridge: string];
    interface OutputObject {
        newBridge: string;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export interface AgentJobManager extends BaseContract {
    connect(runner?: ContractRunner | null): AgentJobManager;
    waitForDeployment(): Promise<this>;
    interface: AgentJobManagerInterface;
    queryFilter<TCEvent extends TypedContractEvent>(event: TCEvent, fromBlockOrBlockhash?: string | number | undefined, toBlock?: string | number | undefined): Promise<Array<TypedEventLog<TCEvent>>>;
    queryFilter<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, fromBlockOrBlockhash?: string | number | undefined, toBlock?: string | number | undefined): Promise<Array<TypedEventLog<TCEvent>>>;
    on<TCEvent extends TypedContractEvent>(event: TCEvent, listener: TypedListener<TCEvent>): Promise<this>;
    on<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, listener: TypedListener<TCEvent>): Promise<this>;
    once<TCEvent extends TypedContractEvent>(event: TCEvent, listener: TypedListener<TCEvent>): Promise<this>;
    once<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, listener: TypedListener<TCEvent>): Promise<this>;
    listeners<TCEvent extends TypedContractEvent>(event: TCEvent): Promise<Array<TypedListener<TCEvent>>>;
    listeners(eventName?: string): Promise<Array<Listener>>;
    removeAllListeners<TCEvent extends TypedContractEvent>(event?: TCEvent): Promise<this>;
    MAX_FEE_RATE: TypedContractMethod<[], [bigint], "view">;
    MIN_DEADLINE_OFFSET: TypedContractMethod<[], [bigint], "view">;
    claimExpired: TypedContractMethod<[
        jobId: BigNumberish
    ], [
        void
    ], "nonpayable">;
    claimRefund: TypedContractMethod<[token: AddressLike], [void], "nonpayable">;
    complete: TypedContractMethod<[
        jobId: BigNumberish,
        reason: BytesLike
    ], [
        void
    ], "nonpayable">;
    createJob: TypedContractMethod<[
        provider: AddressLike,
        evaluator: AddressLike,
        token: AddressLike,
        deadline: BigNumberish
    ], [
        bigint
    ], "nonpayable">;
    evaluatorRegistry: TypedContractMethod<[], [string], "view">;
    extendDeadline: TypedContractMethod<[
        jobId: BigNumberish,
        newDeadline: BigNumberish
    ], [
        void
    ], "nonpayable">;
    feeRate: TypedContractMethod<[], [bigint], "view">;
    feeRecipient: TypedContractMethod<[], [string], "view">;
    fund: TypedContractMethod<[
        jobId: BigNumberish,
        expectedBudget: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getFeeRate: TypedContractMethod<[], [bigint], "view">;
    getJob: TypedContractMethod<[
        jobId: BigNumberish
    ], [
        IAgentJobManager.JobStructOutput
    ], "view">;
    getPendingRefund: TypedContractMethod<[
        client: AddressLike,
        token: AddressLike
    ], [
        bigint
    ], "view">;
    owner: TypedContractMethod<[], [string], "view">;
    reject: TypedContractMethod<[
        jobId: BigNumberish,
        reason: BytesLike
    ], [
        void
    ], "nonpayable">;
    renounceOwnership: TypedContractMethod<[], [void], "nonpayable">;
    reopen: TypedContractMethod<[
        jobId: BigNumberish,
        newProvider: AddressLike,
        newDeadline: BigNumberish
    ], [
        void
    ], "nonpayable">;
    reputationBridge: TypedContractMethod<[], [string], "view">;
    setBudget: TypedContractMethod<[
        jobId: BigNumberish,
        amount: BigNumberish
    ], [
        void
    ], "nonpayable">;
    setFeeRate: TypedContractMethod<[
        newFeeRate: BigNumberish
    ], [
        void
    ], "nonpayable">;
    setFeeRecipient: TypedContractMethod<[
        newFeeRecipient: AddressLike
    ], [
        void
    ], "nonpayable">;
    setReputationBridge: TypedContractMethod<[
        _bridge: AddressLike
    ], [
        void
    ], "nonpayable">;
    submit: TypedContractMethod<[
        jobId: BigNumberish,
        deliverable: BytesLike
    ], [
        void
    ], "nonpayable">;
    transferOwnership: TypedContractMethod<[
        newOwner: AddressLike
    ], [
        void
    ], "nonpayable">;
    getFunction<T extends ContractMethod = ContractMethod>(key: string | FunctionFragment): T;
    getFunction(nameOrSignature: "MAX_FEE_RATE"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "MIN_DEADLINE_OFFSET"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "claimExpired"): TypedContractMethod<[jobId: BigNumberish], [void], "nonpayable">;
    getFunction(nameOrSignature: "claimRefund"): TypedContractMethod<[token: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "complete"): TypedContractMethod<[
        jobId: BigNumberish,
        reason: BytesLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "createJob"): TypedContractMethod<[
        provider: AddressLike,
        evaluator: AddressLike,
        token: AddressLike,
        deadline: BigNumberish
    ], [
        bigint
    ], "nonpayable">;
    getFunction(nameOrSignature: "evaluatorRegistry"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "extendDeadline"): TypedContractMethod<[
        jobId: BigNumberish,
        newDeadline: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "feeRate"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "feeRecipient"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "fund"): TypedContractMethod<[
        jobId: BigNumberish,
        expectedBudget: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "getFeeRate"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "getJob"): TypedContractMethod<[
        jobId: BigNumberish
    ], [
        IAgentJobManager.JobStructOutput
    ], "view">;
    getFunction(nameOrSignature: "getPendingRefund"): TypedContractMethod<[
        client: AddressLike,
        token: AddressLike
    ], [
        bigint
    ], "view">;
    getFunction(nameOrSignature: "owner"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "reject"): TypedContractMethod<[
        jobId: BigNumberish,
        reason: BytesLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "renounceOwnership"): TypedContractMethod<[], [void], "nonpayable">;
    getFunction(nameOrSignature: "reopen"): TypedContractMethod<[
        jobId: BigNumberish,
        newProvider: AddressLike,
        newDeadline: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "reputationBridge"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "setBudget"): TypedContractMethod<[
        jobId: BigNumberish,
        amount: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "setFeeRate"): TypedContractMethod<[newFeeRate: BigNumberish], [void], "nonpayable">;
    getFunction(nameOrSignature: "setFeeRecipient"): TypedContractMethod<[newFeeRecipient: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "setReputationBridge"): TypedContractMethod<[_bridge: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "submit"): TypedContractMethod<[
        jobId: BigNumberish,
        deliverable: BytesLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "transferOwnership"): TypedContractMethod<[newOwner: AddressLike], [void], "nonpayable">;
    getEvent(key: "BudgetSet"): TypedContractEvent<BudgetSetEvent.InputTuple, BudgetSetEvent.OutputTuple, BudgetSetEvent.OutputObject>;
    getEvent(key: "DeadlineExtended"): TypedContractEvent<DeadlineExtendedEvent.InputTuple, DeadlineExtendedEvent.OutputTuple, DeadlineExtendedEvent.OutputObject>;
    getEvent(key: "JobCompleted"): TypedContractEvent<JobCompletedEvent.InputTuple, JobCompletedEvent.OutputTuple, JobCompletedEvent.OutputObject>;
    getEvent(key: "JobCreated"): TypedContractEvent<JobCreatedEvent.InputTuple, JobCreatedEvent.OutputTuple, JobCreatedEvent.OutputObject>;
    getEvent(key: "JobExpired"): TypedContractEvent<JobExpiredEvent.InputTuple, JobExpiredEvent.OutputTuple, JobExpiredEvent.OutputObject>;
    getEvent(key: "JobFunded"): TypedContractEvent<JobFundedEvent.InputTuple, JobFundedEvent.OutputTuple, JobFundedEvent.OutputObject>;
    getEvent(key: "JobRejected"): TypedContractEvent<JobRejectedEvent.InputTuple, JobRejectedEvent.OutputTuple, JobRejectedEvent.OutputObject>;
    getEvent(key: "JobReopened"): TypedContractEvent<JobReopenedEvent.InputTuple, JobReopenedEvent.OutputTuple, JobReopenedEvent.OutputObject>;
    getEvent(key: "JobSubmitted"): TypedContractEvent<JobSubmittedEvent.InputTuple, JobSubmittedEvent.OutputTuple, JobSubmittedEvent.OutputObject>;
    getEvent(key: "OwnershipTransferred"): TypedContractEvent<OwnershipTransferredEvent.InputTuple, OwnershipTransferredEvent.OutputTuple, OwnershipTransferredEvent.OutputObject>;
    getEvent(key: "RefundClaimed"): TypedContractEvent<RefundClaimedEvent.InputTuple, RefundClaimedEvent.OutputTuple, RefundClaimedEvent.OutputObject>;
    getEvent(key: "RefundPending"): TypedContractEvent<RefundPendingEvent.InputTuple, RefundPendingEvent.OutputTuple, RefundPendingEvent.OutputObject>;
    getEvent(key: "ReputationBridgeUpdated"): TypedContractEvent<ReputationBridgeUpdatedEvent.InputTuple, ReputationBridgeUpdatedEvent.OutputTuple, ReputationBridgeUpdatedEvent.OutputObject>;
    filters: {
        "BudgetSet(uint256,uint128)": TypedContractEvent<BudgetSetEvent.InputTuple, BudgetSetEvent.OutputTuple, BudgetSetEvent.OutputObject>;
        BudgetSet: TypedContractEvent<BudgetSetEvent.InputTuple, BudgetSetEvent.OutputTuple, BudgetSetEvent.OutputObject>;
        "DeadlineExtended(uint256,uint64,uint64)": TypedContractEvent<DeadlineExtendedEvent.InputTuple, DeadlineExtendedEvent.OutputTuple, DeadlineExtendedEvent.OutputObject>;
        DeadlineExtended: TypedContractEvent<DeadlineExtendedEvent.InputTuple, DeadlineExtendedEvent.OutputTuple, DeadlineExtendedEvent.OutputObject>;
        "JobCompleted(uint256,address,uint256,uint256)": TypedContractEvent<JobCompletedEvent.InputTuple, JobCompletedEvent.OutputTuple, JobCompletedEvent.OutputObject>;
        JobCompleted: TypedContractEvent<JobCompletedEvent.InputTuple, JobCompletedEvent.OutputTuple, JobCompletedEvent.OutputObject>;
        "JobCreated(uint256,address,address,address,address,uint64)": TypedContractEvent<JobCreatedEvent.InputTuple, JobCreatedEvent.OutputTuple, JobCreatedEvent.OutputObject>;
        JobCreated: TypedContractEvent<JobCreatedEvent.InputTuple, JobCreatedEvent.OutputTuple, JobCreatedEvent.OutputObject>;
        "JobExpired(uint256,address)": TypedContractEvent<JobExpiredEvent.InputTuple, JobExpiredEvent.OutputTuple, JobExpiredEvent.OutputObject>;
        JobExpired: TypedContractEvent<JobExpiredEvent.InputTuple, JobExpiredEvent.OutputTuple, JobExpiredEvent.OutputObject>;
        "JobFunded(uint256,uint128)": TypedContractEvent<JobFundedEvent.InputTuple, JobFundedEvent.OutputTuple, JobFundedEvent.OutputObject>;
        JobFunded: TypedContractEvent<JobFundedEvent.InputTuple, JobFundedEvent.OutputTuple, JobFundedEvent.OutputObject>;
        "JobRejected(uint256,address,bytes32)": TypedContractEvent<JobRejectedEvent.InputTuple, JobRejectedEvent.OutputTuple, JobRejectedEvent.OutputObject>;
        JobRejected: TypedContractEvent<JobRejectedEvent.InputTuple, JobRejectedEvent.OutputTuple, JobRejectedEvent.OutputObject>;
        "JobReopened(uint256,address,address,uint64)": TypedContractEvent<JobReopenedEvent.InputTuple, JobReopenedEvent.OutputTuple, JobReopenedEvent.OutputObject>;
        JobReopened: TypedContractEvent<JobReopenedEvent.InputTuple, JobReopenedEvent.OutputTuple, JobReopenedEvent.OutputObject>;
        "JobSubmitted(uint256,bytes32)": TypedContractEvent<JobSubmittedEvent.InputTuple, JobSubmittedEvent.OutputTuple, JobSubmittedEvent.OutputObject>;
        JobSubmitted: TypedContractEvent<JobSubmittedEvent.InputTuple, JobSubmittedEvent.OutputTuple, JobSubmittedEvent.OutputObject>;
        "OwnershipTransferred(address,address)": TypedContractEvent<OwnershipTransferredEvent.InputTuple, OwnershipTransferredEvent.OutputTuple, OwnershipTransferredEvent.OutputObject>;
        OwnershipTransferred: TypedContractEvent<OwnershipTransferredEvent.InputTuple, OwnershipTransferredEvent.OutputTuple, OwnershipTransferredEvent.OutputObject>;
        "RefundClaimed(address,address,uint256)": TypedContractEvent<RefundClaimedEvent.InputTuple, RefundClaimedEvent.OutputTuple, RefundClaimedEvent.OutputObject>;
        RefundClaimed: TypedContractEvent<RefundClaimedEvent.InputTuple, RefundClaimedEvent.OutputTuple, RefundClaimedEvent.OutputObject>;
        "RefundPending(address,address,uint256)": TypedContractEvent<RefundPendingEvent.InputTuple, RefundPendingEvent.OutputTuple, RefundPendingEvent.OutputObject>;
        RefundPending: TypedContractEvent<RefundPendingEvent.InputTuple, RefundPendingEvent.OutputTuple, RefundPendingEvent.OutputObject>;
        "ReputationBridgeUpdated(address)": TypedContractEvent<ReputationBridgeUpdatedEvent.InputTuple, ReputationBridgeUpdatedEvent.OutputTuple, ReputationBridgeUpdatedEvent.OutputObject>;
        ReputationBridgeUpdated: TypedContractEvent<ReputationBridgeUpdatedEvent.InputTuple, ReputationBridgeUpdatedEvent.OutputTuple, ReputationBridgeUpdatedEvent.OutputObject>;
    };
}
//# sourceMappingURL=AgentJobManager.d.ts.map