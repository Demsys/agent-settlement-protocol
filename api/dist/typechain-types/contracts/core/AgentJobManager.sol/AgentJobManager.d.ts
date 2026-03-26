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
    getFunction(nameOrSignature: "GOVERNANCE_DELAY" | "MAX_FEE_RATE" | "MIN_BUDGET" | "MIN_DEADLINE_OFFSET" | "MIN_EVALUATION_WINDOW" | "allowToken" | "allowedTokens" | "cancelProposal" | "claimExpired" | "claimRefund" | "complete" | "createJob" | "disallowToken" | "evaluatorRegistry" | "executeFeeRate" | "executeFeeRecipient" | "executeReputationBridge" | "extendDeadline" | "feeRate" | "feeRecipient" | "fund" | "getFeeRate" | "getJob" | "getPendingRefund" | "owner" | "proposeFeeRate" | "proposeFeeRecipient" | "proposeReputationBridge" | "reject" | "renounceOwnership" | "reopen" | "reputationBridge" | "setBudget" | "submit" | "transferOwnership"): FunctionFragment;
    getEvent(nameOrSignatureOrTopic: "BudgetSet" | "DeadlineExtended" | "FeeRateProposed" | "FeeRateUpdated" | "FeeRecipientProposed" | "FeeRecipientUpdated" | "JobCompleted" | "JobCreated" | "JobExpired" | "JobFunded" | "JobRejected" | "JobReopened" | "JobSubmitted" | "OwnershipTransferred" | "ProposalCancelled" | "RefundClaimed" | "RefundPending" | "ReputationBridgeProposed" | "ReputationBridgeUpdated" | "TokenAllowed" | "TokenDisallowed"): EventFragment;
    encodeFunctionData(functionFragment: "GOVERNANCE_DELAY", values?: undefined): string;
    encodeFunctionData(functionFragment: "MAX_FEE_RATE", values?: undefined): string;
    encodeFunctionData(functionFragment: "MIN_BUDGET", values?: undefined): string;
    encodeFunctionData(functionFragment: "MIN_DEADLINE_OFFSET", values?: undefined): string;
    encodeFunctionData(functionFragment: "MIN_EVALUATION_WINDOW", values?: undefined): string;
    encodeFunctionData(functionFragment: "allowToken", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "allowedTokens", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "cancelProposal", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "claimExpired", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "claimRefund", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "complete", values: [BigNumberish, BytesLike]): string;
    encodeFunctionData(functionFragment: "createJob", values: [AddressLike, AddressLike, AddressLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "disallowToken", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "evaluatorRegistry", values?: undefined): string;
    encodeFunctionData(functionFragment: "executeFeeRate", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "executeFeeRecipient", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "executeReputationBridge", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "extendDeadline", values: [BigNumberish, BigNumberish]): string;
    encodeFunctionData(functionFragment: "feeRate", values?: undefined): string;
    encodeFunctionData(functionFragment: "feeRecipient", values?: undefined): string;
    encodeFunctionData(functionFragment: "fund", values: [BigNumberish, BigNumberish]): string;
    encodeFunctionData(functionFragment: "getFeeRate", values?: undefined): string;
    encodeFunctionData(functionFragment: "getJob", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "getPendingRefund", values: [AddressLike, AddressLike]): string;
    encodeFunctionData(functionFragment: "owner", values?: undefined): string;
    encodeFunctionData(functionFragment: "proposeFeeRate", values: [BigNumberish]): string;
    encodeFunctionData(functionFragment: "proposeFeeRecipient", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "proposeReputationBridge", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "reject", values: [BigNumberish, BytesLike]): string;
    encodeFunctionData(functionFragment: "renounceOwnership", values?: undefined): string;
    encodeFunctionData(functionFragment: "reopen", values: [BigNumberish, AddressLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "reputationBridge", values?: undefined): string;
    encodeFunctionData(functionFragment: "setBudget", values: [BigNumberish, BigNumberish]): string;
    encodeFunctionData(functionFragment: "submit", values: [BigNumberish, BytesLike]): string;
    encodeFunctionData(functionFragment: "transferOwnership", values: [AddressLike]): string;
    decodeFunctionResult(functionFragment: "GOVERNANCE_DELAY", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "MAX_FEE_RATE", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "MIN_BUDGET", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "MIN_DEADLINE_OFFSET", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "MIN_EVALUATION_WINDOW", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "allowToken", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "allowedTokens", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "cancelProposal", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "claimExpired", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "claimRefund", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "complete", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "createJob", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "disallowToken", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "evaluatorRegistry", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "executeFeeRate", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "executeFeeRecipient", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "executeReputationBridge", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "extendDeadline", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "feeRate", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "feeRecipient", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "fund", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getFeeRate", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getJob", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getPendingRefund", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "owner", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "proposeFeeRate", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "proposeFeeRecipient", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "proposeReputationBridge", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "reject", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "renounceOwnership", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "reopen", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "reputationBridge", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "setBudget", data: BytesLike): Result;
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
export declare namespace FeeRateProposedEvent {
    type InputTuple = [
        newFeeRate: BigNumberish,
        executableAt: BigNumberish
    ];
    type OutputTuple = [newFeeRate: bigint, executableAt: bigint];
    interface OutputObject {
        newFeeRate: bigint;
        executableAt: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace FeeRateUpdatedEvent {
    type InputTuple = [oldFeeRate: BigNumberish, newFeeRate: BigNumberish];
    type OutputTuple = [oldFeeRate: bigint, newFeeRate: bigint];
    interface OutputObject {
        oldFeeRate: bigint;
        newFeeRate: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace FeeRecipientProposedEvent {
    type InputTuple = [
        newFeeRecipient: AddressLike,
        executableAt: BigNumberish
    ];
    type OutputTuple = [newFeeRecipient: string, executableAt: bigint];
    interface OutputObject {
        newFeeRecipient: string;
        executableAt: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace FeeRecipientUpdatedEvent {
    type InputTuple = [
        oldFeeRecipient: AddressLike,
        newFeeRecipient: AddressLike
    ];
    type OutputTuple = [oldFeeRecipient: string, newFeeRecipient: string];
    interface OutputObject {
        oldFeeRecipient: string;
        newFeeRecipient: string;
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
export declare namespace ProposalCancelledEvent {
    type InputTuple = [key: BytesLike];
    type OutputTuple = [key: string];
    interface OutputObject {
        key: string;
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
export declare namespace ReputationBridgeProposedEvent {
    type InputTuple = [newBridge: AddressLike, executableAt: BigNumberish];
    type OutputTuple = [newBridge: string, executableAt: bigint];
    interface OutputObject {
        newBridge: string;
        executableAt: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace ReputationBridgeUpdatedEvent {
    type InputTuple = [oldBridge: AddressLike, newBridge: AddressLike];
    type OutputTuple = [oldBridge: string, newBridge: string];
    interface OutputObject {
        oldBridge: string;
        newBridge: string;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace TokenAllowedEvent {
    type InputTuple = [token: AddressLike];
    type OutputTuple = [token: string];
    interface OutputObject {
        token: string;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace TokenDisallowedEvent {
    type InputTuple = [token: AddressLike];
    type OutputTuple = [token: string];
    interface OutputObject {
        token: string;
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
    GOVERNANCE_DELAY: TypedContractMethod<[], [bigint], "view">;
    MAX_FEE_RATE: TypedContractMethod<[], [bigint], "view">;
    MIN_BUDGET: TypedContractMethod<[], [bigint], "view">;
    MIN_DEADLINE_OFFSET: TypedContractMethod<[], [bigint], "view">;
    MIN_EVALUATION_WINDOW: TypedContractMethod<[], [bigint], "view">;
    allowToken: TypedContractMethod<[token: AddressLike], [void], "nonpayable">;
    allowedTokens: TypedContractMethod<[arg0: AddressLike], [boolean], "view">;
    cancelProposal: TypedContractMethod<[key: BytesLike], [void], "nonpayable">;
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
    disallowToken: TypedContractMethod<[
        token: AddressLike
    ], [
        void
    ], "nonpayable">;
    evaluatorRegistry: TypedContractMethod<[], [string], "view">;
    executeFeeRate: TypedContractMethod<[
        newFeeRate: BigNumberish
    ], [
        void
    ], "nonpayable">;
    executeFeeRecipient: TypedContractMethod<[
        newFeeRecipient: AddressLike
    ], [
        void
    ], "nonpayable">;
    executeReputationBridge: TypedContractMethod<[
        _bridge: AddressLike
    ], [
        void
    ], "nonpayable">;
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
    proposeFeeRate: TypedContractMethod<[
        newFeeRate: BigNumberish
    ], [
        void
    ], "nonpayable">;
    proposeFeeRecipient: TypedContractMethod<[
        newFeeRecipient: AddressLike
    ], [
        void
    ], "nonpayable">;
    proposeReputationBridge: TypedContractMethod<[
        _bridge: AddressLike
    ], [
        void
    ], "nonpayable">;
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
    getFunction(nameOrSignature: "GOVERNANCE_DELAY"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "MAX_FEE_RATE"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "MIN_BUDGET"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "MIN_DEADLINE_OFFSET"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "MIN_EVALUATION_WINDOW"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "allowToken"): TypedContractMethod<[token: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "allowedTokens"): TypedContractMethod<[arg0: AddressLike], [boolean], "view">;
    getFunction(nameOrSignature: "cancelProposal"): TypedContractMethod<[key: BytesLike], [void], "nonpayable">;
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
    getFunction(nameOrSignature: "disallowToken"): TypedContractMethod<[token: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "evaluatorRegistry"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "executeFeeRate"): TypedContractMethod<[newFeeRate: BigNumberish], [void], "nonpayable">;
    getFunction(nameOrSignature: "executeFeeRecipient"): TypedContractMethod<[newFeeRecipient: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "executeReputationBridge"): TypedContractMethod<[_bridge: AddressLike], [void], "nonpayable">;
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
    getFunction(nameOrSignature: "proposeFeeRate"): TypedContractMethod<[newFeeRate: BigNumberish], [void], "nonpayable">;
    getFunction(nameOrSignature: "proposeFeeRecipient"): TypedContractMethod<[newFeeRecipient: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "proposeReputationBridge"): TypedContractMethod<[_bridge: AddressLike], [void], "nonpayable">;
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
    getFunction(nameOrSignature: "submit"): TypedContractMethod<[
        jobId: BigNumberish,
        deliverable: BytesLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "transferOwnership"): TypedContractMethod<[newOwner: AddressLike], [void], "nonpayable">;
    getEvent(key: "BudgetSet"): TypedContractEvent<BudgetSetEvent.InputTuple, BudgetSetEvent.OutputTuple, BudgetSetEvent.OutputObject>;
    getEvent(key: "DeadlineExtended"): TypedContractEvent<DeadlineExtendedEvent.InputTuple, DeadlineExtendedEvent.OutputTuple, DeadlineExtendedEvent.OutputObject>;
    getEvent(key: "FeeRateProposed"): TypedContractEvent<FeeRateProposedEvent.InputTuple, FeeRateProposedEvent.OutputTuple, FeeRateProposedEvent.OutputObject>;
    getEvent(key: "FeeRateUpdated"): TypedContractEvent<FeeRateUpdatedEvent.InputTuple, FeeRateUpdatedEvent.OutputTuple, FeeRateUpdatedEvent.OutputObject>;
    getEvent(key: "FeeRecipientProposed"): TypedContractEvent<FeeRecipientProposedEvent.InputTuple, FeeRecipientProposedEvent.OutputTuple, FeeRecipientProposedEvent.OutputObject>;
    getEvent(key: "FeeRecipientUpdated"): TypedContractEvent<FeeRecipientUpdatedEvent.InputTuple, FeeRecipientUpdatedEvent.OutputTuple, FeeRecipientUpdatedEvent.OutputObject>;
    getEvent(key: "JobCompleted"): TypedContractEvent<JobCompletedEvent.InputTuple, JobCompletedEvent.OutputTuple, JobCompletedEvent.OutputObject>;
    getEvent(key: "JobCreated"): TypedContractEvent<JobCreatedEvent.InputTuple, JobCreatedEvent.OutputTuple, JobCreatedEvent.OutputObject>;
    getEvent(key: "JobExpired"): TypedContractEvent<JobExpiredEvent.InputTuple, JobExpiredEvent.OutputTuple, JobExpiredEvent.OutputObject>;
    getEvent(key: "JobFunded"): TypedContractEvent<JobFundedEvent.InputTuple, JobFundedEvent.OutputTuple, JobFundedEvent.OutputObject>;
    getEvent(key: "JobRejected"): TypedContractEvent<JobRejectedEvent.InputTuple, JobRejectedEvent.OutputTuple, JobRejectedEvent.OutputObject>;
    getEvent(key: "JobReopened"): TypedContractEvent<JobReopenedEvent.InputTuple, JobReopenedEvent.OutputTuple, JobReopenedEvent.OutputObject>;
    getEvent(key: "JobSubmitted"): TypedContractEvent<JobSubmittedEvent.InputTuple, JobSubmittedEvent.OutputTuple, JobSubmittedEvent.OutputObject>;
    getEvent(key: "OwnershipTransferred"): TypedContractEvent<OwnershipTransferredEvent.InputTuple, OwnershipTransferredEvent.OutputTuple, OwnershipTransferredEvent.OutputObject>;
    getEvent(key: "ProposalCancelled"): TypedContractEvent<ProposalCancelledEvent.InputTuple, ProposalCancelledEvent.OutputTuple, ProposalCancelledEvent.OutputObject>;
    getEvent(key: "RefundClaimed"): TypedContractEvent<RefundClaimedEvent.InputTuple, RefundClaimedEvent.OutputTuple, RefundClaimedEvent.OutputObject>;
    getEvent(key: "RefundPending"): TypedContractEvent<RefundPendingEvent.InputTuple, RefundPendingEvent.OutputTuple, RefundPendingEvent.OutputObject>;
    getEvent(key: "ReputationBridgeProposed"): TypedContractEvent<ReputationBridgeProposedEvent.InputTuple, ReputationBridgeProposedEvent.OutputTuple, ReputationBridgeProposedEvent.OutputObject>;
    getEvent(key: "ReputationBridgeUpdated"): TypedContractEvent<ReputationBridgeUpdatedEvent.InputTuple, ReputationBridgeUpdatedEvent.OutputTuple, ReputationBridgeUpdatedEvent.OutputObject>;
    getEvent(key: "TokenAllowed"): TypedContractEvent<TokenAllowedEvent.InputTuple, TokenAllowedEvent.OutputTuple, TokenAllowedEvent.OutputObject>;
    getEvent(key: "TokenDisallowed"): TypedContractEvent<TokenDisallowedEvent.InputTuple, TokenDisallowedEvent.OutputTuple, TokenDisallowedEvent.OutputObject>;
    filters: {
        "BudgetSet(uint256,uint128)": TypedContractEvent<BudgetSetEvent.InputTuple, BudgetSetEvent.OutputTuple, BudgetSetEvent.OutputObject>;
        BudgetSet: TypedContractEvent<BudgetSetEvent.InputTuple, BudgetSetEvent.OutputTuple, BudgetSetEvent.OutputObject>;
        "DeadlineExtended(uint256,uint64,uint64)": TypedContractEvent<DeadlineExtendedEvent.InputTuple, DeadlineExtendedEvent.OutputTuple, DeadlineExtendedEvent.OutputObject>;
        DeadlineExtended: TypedContractEvent<DeadlineExtendedEvent.InputTuple, DeadlineExtendedEvent.OutputTuple, DeadlineExtendedEvent.OutputObject>;
        "FeeRateProposed(uint256,uint256)": TypedContractEvent<FeeRateProposedEvent.InputTuple, FeeRateProposedEvent.OutputTuple, FeeRateProposedEvent.OutputObject>;
        FeeRateProposed: TypedContractEvent<FeeRateProposedEvent.InputTuple, FeeRateProposedEvent.OutputTuple, FeeRateProposedEvent.OutputObject>;
        "FeeRateUpdated(uint256,uint256)": TypedContractEvent<FeeRateUpdatedEvent.InputTuple, FeeRateUpdatedEvent.OutputTuple, FeeRateUpdatedEvent.OutputObject>;
        FeeRateUpdated: TypedContractEvent<FeeRateUpdatedEvent.InputTuple, FeeRateUpdatedEvent.OutputTuple, FeeRateUpdatedEvent.OutputObject>;
        "FeeRecipientProposed(address,uint256)": TypedContractEvent<FeeRecipientProposedEvent.InputTuple, FeeRecipientProposedEvent.OutputTuple, FeeRecipientProposedEvent.OutputObject>;
        FeeRecipientProposed: TypedContractEvent<FeeRecipientProposedEvent.InputTuple, FeeRecipientProposedEvent.OutputTuple, FeeRecipientProposedEvent.OutputObject>;
        "FeeRecipientUpdated(address,address)": TypedContractEvent<FeeRecipientUpdatedEvent.InputTuple, FeeRecipientUpdatedEvent.OutputTuple, FeeRecipientUpdatedEvent.OutputObject>;
        FeeRecipientUpdated: TypedContractEvent<FeeRecipientUpdatedEvent.InputTuple, FeeRecipientUpdatedEvent.OutputTuple, FeeRecipientUpdatedEvent.OutputObject>;
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
        "ProposalCancelled(bytes32)": TypedContractEvent<ProposalCancelledEvent.InputTuple, ProposalCancelledEvent.OutputTuple, ProposalCancelledEvent.OutputObject>;
        ProposalCancelled: TypedContractEvent<ProposalCancelledEvent.InputTuple, ProposalCancelledEvent.OutputTuple, ProposalCancelledEvent.OutputObject>;
        "RefundClaimed(address,address,uint256)": TypedContractEvent<RefundClaimedEvent.InputTuple, RefundClaimedEvent.OutputTuple, RefundClaimedEvent.OutputObject>;
        RefundClaimed: TypedContractEvent<RefundClaimedEvent.InputTuple, RefundClaimedEvent.OutputTuple, RefundClaimedEvent.OutputObject>;
        "RefundPending(address,address,uint256)": TypedContractEvent<RefundPendingEvent.InputTuple, RefundPendingEvent.OutputTuple, RefundPendingEvent.OutputObject>;
        RefundPending: TypedContractEvent<RefundPendingEvent.InputTuple, RefundPendingEvent.OutputTuple, RefundPendingEvent.OutputObject>;
        "ReputationBridgeProposed(address,uint256)": TypedContractEvent<ReputationBridgeProposedEvent.InputTuple, ReputationBridgeProposedEvent.OutputTuple, ReputationBridgeProposedEvent.OutputObject>;
        ReputationBridgeProposed: TypedContractEvent<ReputationBridgeProposedEvent.InputTuple, ReputationBridgeProposedEvent.OutputTuple, ReputationBridgeProposedEvent.OutputObject>;
        "ReputationBridgeUpdated(address,address)": TypedContractEvent<ReputationBridgeUpdatedEvent.InputTuple, ReputationBridgeUpdatedEvent.OutputTuple, ReputationBridgeUpdatedEvent.OutputObject>;
        ReputationBridgeUpdated: TypedContractEvent<ReputationBridgeUpdatedEvent.InputTuple, ReputationBridgeUpdatedEvent.OutputTuple, ReputationBridgeUpdatedEvent.OutputObject>;
        "TokenAllowed(address)": TypedContractEvent<TokenAllowedEvent.InputTuple, TokenAllowedEvent.OutputTuple, TokenAllowedEvent.OutputObject>;
        TokenAllowed: TypedContractEvent<TokenAllowedEvent.InputTuple, TokenAllowedEvent.OutputTuple, TokenAllowedEvent.OutputObject>;
        "TokenDisallowed(address)": TypedContractEvent<TokenDisallowedEvent.InputTuple, TokenDisallowedEvent.OutputTuple, TokenDisallowedEvent.OutputObject>;
        TokenDisallowed: TypedContractEvent<TokenDisallowedEvent.InputTuple, TokenDisallowedEvent.OutputTuple, TokenDisallowedEvent.OutputObject>;
    };
}
//# sourceMappingURL=AgentJobManager.d.ts.map