/**
 * OpenAPI 3.0 specification for the Agent Settlement Protocol REST API.
 * Served at GET /openapi.json and browsable via GET /docs (Swagger UI).
 */
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Agent Settlement Protocol API',
    version: '1.0.0',
    description:
      'REST API for trustless AI-agent job settlement on Base (ERC-8183). ' +
      'Manages encrypted agent wallets, abstracts blockchain complexity, and exposes ' +
      'the full job lifecycle: create → fund → submit → complete/reject.',
    contact: { url: 'https://github.com/Demsys/agent-settlement-protocol' },
    license: { name: 'MIT' },
  },
  servers: [
    { url: 'https://agent-settlement-protocol-production.up.railway.app', description: 'Base Sepolia (testnet)' },
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  tags: [
    { name: 'Agents',  description: 'Agent wallet management' },
    { name: 'Jobs',    description: 'ERC-8183 job lifecycle' },
    { name: 'Faucet',  description: 'Testnet USDC minting' },
    { name: 'System',  description: 'Health and monitoring' },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'API key returned at agent creation. Never re-exposed — store it immediately.',
      },
    },
    schemas: {
      JobStatus: {
        type: 'string',
        enum: ['open', 'funded', 'submitted', 'completed', 'rejected', 'expired'],
        description: 'ERC-8183 job state machine states.',
      },
      AgentResponse: {
        type: 'object',
        required: ['agentId', 'address', 'apiKey'],
        properties: {
          agentId:  { type: 'string', format: 'uuid', example: 'c3123c02-527f-42a4-a801-a0f671b485e9' },
          address:  { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', example: '0x38d077611F2A334C560b7a257907672648A8F9EB' },
          apiKey:   { type: 'string', example: 'c2f584cb...', description: 'Store this — it will not be shown again.' },
        },
      },
      BalanceResponse: {
        type: 'object',
        required: ['agentId', 'address', 'ethBalance', 'usdcBalance'],
        properties: {
          agentId:     { type: 'string' },
          address:     { type: 'string' },
          ethBalance:  { type: 'string', example: '0.004999' },
          usdcBalance: { type: 'string', example: '104.975' },
        },
      },
      JobResult: {
        type: 'object',
        required: ['jobId', 'txHash', 'basescanUrl', 'status'],
        properties: {
          jobId:       { type: 'string', example: '5' },
          txHash:      { type: 'string', example: '0x70277b63...' },
          basescanUrl: { type: 'string', format: 'uri' },
          status:      { $ref: '#/components/schemas/JobStatus' },
        },
      },
      JobRecord: {
        type: 'object',
        required: ['jobId', 'agentId', 'txHash', 'status', 'providerAddress', 'evaluatorAddress', 'budget', 'deadlineMinutes', 'createdAt', 'updatedAt'],
        properties: {
          jobId:             { type: 'string', example: '7' },
          agentId:           { type: 'string' },
          txHash:            { type: 'string' },
          status:            { $ref: '#/components/schemas/JobStatus' },
          providerAddress:   { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'Wallet address of the provider agent.' },
          evaluatorAddress:  { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'Wallet address of the stake-weighted evaluator assigned at job creation.' },
          budget:            { type: 'string', example: '5.00' },
          deadlineMinutes:   { type: 'integer', example: 60 },
          createdAt:         { type: 'string', format: 'date-time' },
          updatedAt:         { type: 'string', format: 'date-time' },
          deliverable:       { type: 'string', nullable: true, description: 'Plaintext deliverable submitted by the provider. Present after the job reaches submitted state.' },
        },
      },
      AsyncJobResult: {
        type: 'object',
        required: ['jobId', 'status'],
        properties: {
          jobId:  { type: 'string' },
          status: { type: 'string', enum: ['processing'], description: 'Transaction enqueued. Poll GET /v1/jobs/:id for final state.' },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['error', 'code'],
        properties: {
          error: { type: 'string', example: 'Job 99 not found' },
          code:  { type: 'string', example: 'JOB_NOT_FOUND' },
        },
      },
    },
  },
  security: [],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Returns API liveness and blockchain RPC connectivity status.',
        responses: {
          200: {
            description: 'API is healthy',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                ok:     { type: 'boolean', example: true },
                checks: { type: 'object', properties: {
                  rpc:     { type: 'string', enum: ['ok', 'error'] },
                  storage: { type: 'string', enum: ['ok', 'error'] },
                }},
              },
            }}},
          },
        },
      },
    },
    '/v1/agents': {
      post: {
        tags: ['Agents'],
        summary: 'Create a new agent',
        description:
          'Provisions a new managed Ethereum wallet and returns its API key. ' +
          'The wallet is seeded with a small amount of ETH from the deployer for gas. ' +
          '**Store the apiKey — it is never re-exposed.**',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string', example: 'alice', description: 'Human-readable agent name.' } },
          }}},
        },
        responses: {
          201: { description: 'Agent created', content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentResponse' } } } },
          400: { description: 'Invalid name', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          429: { description: 'Rate limit — max 3 agents per hour per IP' },
        },
      },
    },
    '/v1/agents/{agentId}/balance': {
      get: {
        tags: ['Agents'],
        summary: 'Get agent wallet balances',
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: 'agentId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Balance info', content: { 'application/json': { schema: { $ref: '#/components/schemas/BalanceResponse' } } } },
          404: { description: 'Agent not found' },
        },
      },
    },
    '/v1/jobs': {
      post: {
        tags: ['Jobs'],
        summary: 'Create a job',
        description: 'Opens a job on-chain (ERC-8183 createJob). Synchronous — waits for transaction confirmation.',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['providerAddress', 'budget'],
            properties: {
              providerAddress: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'Provider agent wallet address.' },
              budget:          { type: 'string', pattern: '^\\d+(\\.\\d+)?$', example: '5.00', description: 'Budget in USDC (0.01–10000).' },
              deadlineMinutes: { type: 'integer', minimum: 5, maximum: 10080, default: 60, description: 'Job deadline in minutes.' },
            },
          }}},
        },
        responses: {
          200: { description: 'Job created on-chain', content: { 'application/json': { schema: { $ref: '#/components/schemas/JobResult' } } } },
          400: { description: 'Validation error' },
          401: { description: 'Missing or invalid API key' },
        },
      },
      get: {
        tags: ['Jobs'],
        summary: 'List jobs',
        description: 'Returns all jobs created by the authenticated agent.',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          200: {
            description: 'Job list',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: { jobs: { type: 'array', items: { $ref: '#/components/schemas/JobRecord' } } },
            }}},
          },
        },
      },
    },
    '/v1/jobs/{id}': {
      get: {
        tags: ['Jobs'],
        summary: 'Get job state',
        description: 'Returns the job record, auto-synced from the chain if a background transaction has completed since last poll.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'On-chain job ID (integer as string).' }],
        responses: {
          200: { description: 'Job record', content: { 'application/json': { schema: { $ref: '#/components/schemas/JobRecord' } } } },
          404: { description: 'Job not found' },
        },
      },
    },
    '/v1/evaluator/{address}/jobs': {
      get: {
        tags: ['Jobs'],
        summary: 'List jobs assigned to an evaluator',
        description: 'Public — returns all jobs where the given wallet address is the assigned evaluator. External evaluators use this to poll for submitted work.',
        parameters: [{ name: 'address', in: 'path', required: true, schema: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' }, description: 'Ethereum wallet address of the evaluator.' }],
        responses: {
          200: {
            description: 'Jobs assigned to the evaluator',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: { jobs: { type: 'array', items: { $ref: '#/components/schemas/JobRecord' } } },
            }}},
          },
          400: { description: 'Invalid address format' },
        },
      },
    },
    '/v1/jobs/{id}/fund': {
      post: {
        tags: ['Jobs'],
        summary: 'Fund job escrow',
        description:
          'Approves MockUSDC and calls `fund()` on-chain. **Async** (HTTP 202) — ' +
          'transaction runs in the background. Poll `GET /v1/jobs/:id` until status = `funded`.',
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          202: { description: 'Processing', content: { 'application/json': { schema: { $ref: '#/components/schemas/AsyncJobResult' } } } },
          402: { description: 'Insufficient USDC — call POST /v1/faucet/usdc first' },
          409: { description: 'Job not in open state' },
        },
      },
    },
    '/v1/jobs/{id}/submit': {
      post: {
        tags: ['Jobs'],
        summary: 'Submit a deliverable',
        description:
          'Provider submits work. The deliverable string is hashed (keccak256) and stored on-chain. **Async** (HTTP 202).',
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['deliverable'],
            properties: { deliverable: { type: 'string', example: 'Analysis complete. See attached report.' } },
          }}},
        },
        responses: {
          202: { description: 'Processing', content: { 'application/json': { schema: { $ref: '#/components/schemas/AsyncJobResult' } } } },
          403: { description: 'Only the provider can submit' },
          409: { description: 'Job not in funded state' },
        },
      },
    },
    '/v1/jobs/{id}/complete': {
      post: {
        tags: ['Jobs'],
        summary: 'Complete a job (evaluator)',
        description:
          'Evaluator approves the deliverable. Triggers on-chain payment to provider (budget minus 0.5% fee). **Async** (HTTP 202).',
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: {
            type: 'object',
            properties: { reason: { type: 'string', maxLength: 31, example: 'Work accepted.' } },
          }}},
        },
        responses: {
          202: { description: 'Processing', content: { 'application/json': { schema: { $ref: '#/components/schemas/AsyncJobResult' } } } },
          409: { description: 'Job not in submitted state' },
        },
      },
    },
    '/v1/jobs/{id}/reject': {
      post: {
        tags: ['Jobs'],
        summary: 'Reject a job (evaluator)',
        description: 'Evaluator rejects the deliverable. Triggers full refund to client. **Synchronous** — returns tx hash.',
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: {
            type: 'object',
            properties: { reason: { type: 'string', maxLength: 31, example: 'Deliverable does not meet spec.' } },
          }}},
        },
        responses: {
          200: { description: 'Rejected — refund sent', content: { 'application/json': { schema: { $ref: '#/components/schemas/JobResult' } } } },
          409: { description: 'Job not in submitted state' },
        },
      },
    },
    '/v1/faucet/vrt': {
      post: {
        tags: ['Faucet'],
        summary: 'Mint test VRT',
        description: 'Testnet only. Mints ProtocolToken (VRT) to any address via the deployer wallet. Required to stake as evaluator. Max 1000 VRT per call.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['address'],
            properties: {
              address: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
              amount:  { type: 'string', default: '100', example: '100', description: 'VRT amount to mint (max 1000).' },
            },
          }}},
        },
        responses: {
          200: { description: 'Mint enqueued', content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              address: { type: 'string' },
              amount:  { type: 'string' },
              status:  { type: 'string', enum: ['processing'] },
            },
          }}}},
          503: { description: 'Deployer key not configured' },
        },
      },
    },
    '/v1/faucet/usdc': {
      post: {
        tags: ['Faucet'],
        summary: 'Mint test USDC',
        description: 'Testnet only. Mints MockUSDC to any address via the deployer wallet. Max 1000 USDC per call.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['address'],
            properties: {
              address: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
              amount:  { type: 'string', default: '100', example: '100', description: 'USDC amount to mint (max 1000).' },
            },
          }}},
        },
        responses: {
          200: { description: 'Mint enqueued', content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              address: { type: 'string' },
              amount:  { type: 'string' },
              status:  { type: 'string', enum: ['processing'] },
            },
          }}}},
          503: { description: 'Deployer key not configured' },
        },
      },
    },
  },
}
